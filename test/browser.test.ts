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
