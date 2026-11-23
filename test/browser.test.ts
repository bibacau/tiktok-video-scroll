// The agent's Edge is a normal browser process attached over CDP — not a Playwright-launched one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BROWSER = process.env.BROWSER_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(p => fs.existsSync(p));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-browser-'));
let m: any;

before(async () => {
  (await import('../src/paths.ts')).ensureDirs();
  m = { store: await import('../src/settings/store.ts'), edge: await import('../src/browser/edge.ts'), cdp: await import('../src/browser/cdp.ts') };
  const app = m.store.getAppSettings();
  // Headed when a display exists (headless Chrome always reports navigator.webdriver = true).
  app.browser = { ...app.browser, channel: 'custom', executablePath: BROWSER, headless: !process.env.DISPLAY };
  m.store.saveAppSettings(app);
});
after(async () => { for (const p of ['t-normal', 't-busy', 't-login']) await m?.edge.closeProfile(p).catch(() => {}); });

test('launches as a normal browser process (no Playwright launch flags) and attaches over CDP', { skip: !BROWSER && 'no browser' }, async () => {
  const b = new m.edge.BrowserManager(() => 't-normal');
  const page = await b.ensure();
  await page.goto('data:text/html,<h1>hi</h1>');
  const pids = await m.edge.profileProcesses(b.profileDir());
  assert.ok(pids.length > 0);
  const cmd = execFileSync('ps', ['-o', 'args=', '-p', String(Math.min(...pids))]).toString();
  assert.ok(!cmd.includes('--enable-automation'), 'no --enable-automation');
  assert.ok(cmd.includes('--remote-debugging-port=0'));
  // compositor capture works and returns a JPEG
  const jpg = await b.capture({ quality: 50 });
  assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
  // a second manager on the same profile reuses the running browser instead of a blank new window
  const again = new m.edge.BrowserManager(() => 't-normal');
  await again.ensure();
  assert.deepEqual((await m.edge.profileProcesses(b.profileDir())).sort(), pids.sort());
  await again.detach(); await b.close();
  assert.equal((await m.edge.profileProcesses(b.profileDir())).length, 0, 'closed completely');
});

test('profile held by another window → clear PROFILE_IN_USE error; "close it for me" frees only that profile', { skip: !BROWSER && 'no browser' }, async () => {
  const { spawn } = await import('node:child_process');
  const dir = m.edge.profileDirFor('t-busy'); fs.mkdirSync(dir, { recursive: true });
  const other = m.edge.profileDirFor('t-other'); fs.mkdirSync(other, { recursive: true });
  const extra = [process.getuid?.() === 0 ? '--no-sandbox' : '', process.env.DISPLAY ? '' : '--headless=new'].filter(Boolean);
  // the "user" opens the profile by hand (no debugging port), plus an unrelated browser profile
  spawn(BROWSER!, [`--user-data-dir=${dir}`, '--no-first-run', ...extra, 'about:blank'], { stdio: 'ignore', detached: true }).unref();
  spawn(BROWSER!, [`--user-data-dir=${other}`, '--no-first-run', ...extra, 'about:blank'], { stdio: 'ignore', detached: true }).unref();
  for (let i = 0; i < 30 && !(await m.edge.profileProcesses(dir)).length; i++) await new Promise(r => setTimeout(r, 200));
  assert.equal((await m.edge.profileState('t-busy')).state, 'busy');
  const b = new m.edge.BrowserManager(() => 't-busy');
  await assert.rejects(b.ensure(), (e: any) => e.code === 'PROFILE_IN_USE' && e.pids.length > 0 && /Close it for me/.test(e.message));
  const killed = await m.edge.closeProfile('t-busy');
  assert.ok(killed > 0);
  assert.equal((await m.edge.profileState('t-busy')).state, 'closed');
  assert.ok((await m.edge.profileProcesses(other)).length > 0, 'other profile untouched');
  await b.ensure();
  assert.equal((await m.edge.profileState('t-busy')).state, 'agent');
  await b.close();
  await m.edge.killProfileProcesses(other);
});

test('"Log in to TikTok" opens a normal window (webdriver false) and detects the login cookie', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  const http = await import('node:http');
  const reports: string[] = [];
  const srv = http.createServer((req, res) => {
    if (req.url!.startsWith('/report')) { reports.push(req.url!); res.end('ok'); return; }
    // the "login page": logging in sets a long-lived session cookie
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'sessionid=secret-value; Max-Age=86400; Path=/' });
    res.end(`<script>fetch('/report?wd=' + navigator.webdriver)</script><h1>logged in</h1>`);
  }).listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const port = (srv.address() as any).port;
  const app = m.store.getAppSettings();
  app.browser = { ...app.browser, baseUrl: `http://127.0.0.1:${port}`, loginPath: '/login', loginCookieDomain: '127.0.0.1' };
  m.store.saveAppSettings(app);
  const { logins } = await import('../src/browser/login.ts');
  assert.equal(logins.check('t-login').loggedIn, false);
  const st = await logins.open('t-login');
  assert.equal(st.waiting, true);
  for (let i = 0; i < 50 && !reports.length; i++) await new Promise(r => setTimeout(r, 200));
  if (process.env.DISPLAY) assert.deepEqual(reports, ['/report?wd=false'], 'login window is not marked as automated');
  assert.equal((await m.edge.profileState('t-login')).state, 'busy', 'no debugging port on the login window');
  // Detected while the window is still open (the browser writes cookies to disk at least every 30 s).
  for (let i = 0; i < 100 && !logins.status('t-login').loggedIn; i++) await new Promise(r => setTimeout(r, 500));
  assert.equal(logins.status('t-login').window, 'open');
  // the user closes the window → watching stops
  const pids = await m.edge.profileProcesses(m.edge.profileDirFor('t-login'));
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  for (let i = 0; i < 40 && logins.status('t-login').waiting; i++) await new Promise(r => setTimeout(r, 500));
  const done = logins.status('t-login');
  assert.equal(done.loggedIn, true);
  assert.deepEqual(done.cookies, ['sessionid']);
  srv.close();
});
