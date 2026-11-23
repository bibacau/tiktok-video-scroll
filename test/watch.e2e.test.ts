// End-to-end: real browser + fake tiktok.com + fake DeepSeek. Needs ffmpeg and a Chromium/Edge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureClips, startFakeTikTok, startMockLlm } from './fixture/fake-sites.ts';

const BROWSER = process.env.BROWSER_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(p => fs.existsSync(p));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-'));
process.env.DATA_DIR = tmp;

let tt: Awaited<ReturnType<typeof startFakeTikTok>>, llm: Awaited<ReturnType<typeof startMockLlm>>;
let m: any;
const waitFor = async (fn: () => boolean, ms: number, label: string) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 250)); }
  throw new Error(`Timed out waiting for ${label}`);
};

before(async () => {
  ensureClips();
  tt = await startFakeTikTok(0, { captchaAfter: 0 });
  llm = await startMockLlm();
  const paths = await import('../src/paths.ts');
  paths.ensureDirs();
  m = {
    store: await import('../src/settings/store.ts'),
    controller: (await import('../src/runtime/controller.ts')).controller,
    db: (await import('../src/db.ts')).getDb(),
    picks: await import('../src/watch/picks.ts'),
  };
  const app = m.store.getAppSettings();
  app.browser = { ...app.browser, channel: 'custom', executablePath: BROWSER, headless: true, baseUrl: tt.url, windowWidth: 1100, windowHeight: 800, hangTimeoutSeconds: 20 };
  app.llm = { ...app.llm, baseUrl: llm.url, apiKey: 'sk-test-123456789', retries: 0 };
  app.budget = { ...app.budget, dailyCapRM: 0, monthlyCapRM: 0 };
  m.store.saveAppSettings(app);
  const p = m.store.listPresets()[0];
  p.data.watch.behaviour = { ...p.data.watch.behaviour, glanceSeconds: 1, glanceFrames: 2, framesPerVideo: 3, maxSecondsPerVideo: 3, delayMin: 0.1, delayMax: 0.3, strictness: 6 };
  p.data.save.picksCount = 3;
  m.store.updatePreset(p.id, { data: p.data });
});

after(async () => { await m?.controller.shutdown(); tt?.close(); llm?.close(); });

test('watch session: filters, AI decisions, image fallback, saving, memory, picks, budget ledger', { skip: !BROWSER && 'no browser' }, async () => {
  const c = m.controller;
  await c.start({ minutes: 0.8 });
  await waitFor(() => c.status.state === 'idle', 150_000, 'session end');
  const session = m.db.prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT 1').get();
  assert.equal(session.status, 'done', `session note: ${session.note}`);
  const videos = m.db.prepare('SELECT * FROM videos WHERE session_id = ?').all(session.id);
  const by = (d: string) => videos.filter((v: any) => v.decision === d);
  console.log('decisions:', videos.map((v: any) => `${v.author}:${v.decision}${v.saved ? '+saved' : ''} (${v.reason})`).join(' | '));
  assert.ok(videos.length >= 5, `saw ${videos.length} videos`);
  assert.ok(by('filtered').some((v: any) => /ad \/ sponsored/.test(v.reason)), 'ad filtered without AI');
  assert.ok(by('filtered').some((v: any) => /live stream/.test(v.reason)), 'live filtered without AI');
  assert.ok(by('skip').some((v: any) => v.author === 'dancequeen'), 'off-topic skipped by AI');
  const saved = videos.filter((v: any) => v.saved);
  assert.ok(saved.length >= 1, 'saved at least one recipe');
  const fields = JSON.parse(saved[0].data).fields;
  assert.equal(fields.hook, 'Shows the finished dish in the first second');
  assert.ok(fields.link?.includes('/video/'), 'link saved');
  assert.ok(fs.existsSync(path.join(tmp, 'media', `video-${saved[0].id}.jpg`)), 'storyboard thumbnail saved');
  assert.equal(llm.stats.imageRejects, 1, 'images tried once, then text-only');
  const mem = m.store.getMemory();
  assert.ok(mem.interests.find((i: any) => i.topic === 'malaysian recipes')?.score > 0, 'interest learned');
  const usage = m.db.prepare('SELECT COUNT(*) n, SUM(cost_rm) rm FROM usage').get();
  assert.ok(usage.n >= 3 && usage.rm > 0, 'costs recorded');
  await waitFor(() => m.picks.getPicks(session.day).picks.length > 0, 10_000, 'auto picks');
});

test('captcha → pause + alert, never touched; resume after user clears it', { skip: !BROWSER && 'no browser' }, async () => {
  tt.close();
  tt = await startFakeTikTok(0, { captchaAfter: 2 });
  const app = m.store.getAppSettings(); app.browser.baseUrl = tt.url; m.store.saveAppSettings(app);
  const p = m.store.listPresets()[0]; p.data.watch.behaviour.rewatch = true; m.store.updatePreset(p.id, { data: p.data });
  const c = m.controller;
  await c.start({ minutes: 2 });
  await waitFor(() => c.status.state === 'needs_user', 90_000, 'captcha pause');
  assert.equal(c.status.alert.kind, 'captcha');
  const activeAtPause = c.status.activeSeconds;
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(c.status.state, 'needs_user', 'stays paused');
  // Resume while captcha still there → stays paused
  c.resume();
  await waitFor(() => c.status.state === 'needs_user', 10_000, 're-pause while captcha visible');
  // "User" solves it
  await c.browser.page.evaluate(() => document.getElementById('captcha-verify-container')?.remove());
  c.resume();
  await waitFor(() => c.status.state === 'running' && c.status.counts.videos >= 3, 60_000, 'continue after resume');
  assert.ok(c.status.activeSeconds >= activeAtPause);

  // Watchdog: browser dies unexpectedly → restart and keep going
  const before = c.status.counts.videos;
  await c.browser.ctx.close();
  await waitFor(() => c.browser.restarts >= 1 && c.status.counts.videos > before && c.status.state === 'running', 90_000, 'recover after crash');
  c.stop();
  await waitFor(() => c.status.state === 'idle', 30_000, 'stop');
  const s = m.db.prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT 1').get();
  assert.equal(s.status, 'stopped');
  const alerts = m.db.prepare("SELECT * FROM events WHERE level = 'alert'").all();
  assert.ok(alerts.some((a: any) => /Captcha|Verification/i.test(a.message)));
});
