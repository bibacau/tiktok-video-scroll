// Sharing on the real-feed shapes: no link in the feed, link only in the player wrapper, a video that
// auto-advanced; every skip is logged; session numbers update live and after a crash.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureClips, startFakeTikTok, startMockLlm, sharesSeen, shareOpts } from './fixture/fake-sites.ts';

const BROWSER = process.env.BROWSER_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(p => fs.existsSync(p));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-share-'));
let tt: Awaited<ReturnType<typeof startFakeTikTok>>, llm: Awaited<ReturnType<typeof startMockLlm>>, m: any;
const RECIPES = ['7400000000000000001', '7400000000000000004', '7400000000000000006', '7400000000000000008'];
const waitFor = async (fn: () => boolean, ms: number, label: string) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 250)); }
  throw new Error(`Timed out waiting for ${label}`);
};
async function site(opts: Parameters<typeof startFakeTikTok>[1]) {
  tt?.close();
  tt = await startFakeTikTok(0, opts);
  const app = m.store.getAppSettings(); app.browser.baseUrl = tt.url; m.store.saveAppSettings(app);
}
async function session(minutes: number) {
  const c = m.controller;
  await c.start({ minutes });
  await waitFor(() => c.status.state === 'idle', 200_000, 'session end');
  await new Promise(r => setTimeout(r, 500));
  for (let i = 0; i < 60 && m.db.prepare("SELECT 1 FROM shares WHERE status IN ('queued', 'approved', 'sending')").get(); i++) await new Promise(r => setTimeout(r, 1000));
}
const setShare = (patch: Record<string, unknown>) => {
  const p = m.store.listPresets()[0];
  p.data.save.share = { enabled: true, to: 'bibacau', mode: 'every', minScore: 85, dailyCap: 50, requireApproval: false, telegram: 'off', ...patch };
  m.store.updatePreset(p.id, { data: p.data });
};

before(async () => {
  ensureClips();
  llm = await startMockLlm();
  (await import('../src/paths.ts')).ensureDirs();
  m = {
    store: await import('../src/settings/store.ts'), controller: (await import('../src/runtime/controller.ts')).controller,
    recover: (await import('../src/runtime/controller.ts')).recoverSessions,
    db: (await import('../src/db.ts')).getDb(), share: await import('../src/watch/share.ts'),
  };
  tt = await startFakeTikTok(0, {});
  const app = m.store.getAppSettings();
  app.browser = { ...app.browser, channel: 'custom', executablePath: BROWSER, headless: true, muteAudio: true, baseUrl: tt.url, windowWidth: 1100, windowHeight: 800, hangTimeoutSeconds: 20 };
  app.llm = { ...app.llm, baseUrl: llm.url, apiKey: 'sk-test-123456789', retries: 0 };
  app.budget = { ...app.budget, dailyCapRM: 0, monthlyCapRM: 0 };
  m.store.saveAppSettings(app);
  const p = m.store.listPresets()[0];
  p.data.watch.behaviour = { ...p.data.watch.behaviour, glanceSeconds: 1, glanceFrames: 2, framesPerVideo: 3, maxSecondsPerVideo: 3, delayMin: 0.1, delayMax: 0.3, rewatch: true };
  m.store.updatePreset(p.id, { data: p.data });
  shareOpts.recipients = ['kawan1', 'bibacau']; shareOpts.notMutual = false;
});
after(async () => { await m?.controller.shutdown(); tt?.close(); llm?.close(); });

test('the video link is read from the player wrapper id when the feed has no /video/ link', { skip: !BROWSER && 'no browser' }, async () => {
  await site({ feedIds: 'wrapper' });
  const c = m.controller;
  await c.tiktok.open({ kind: 'foryou' });
  const ins = await c.tiktok.waitForVideo();
  assert.match(ins.video.url, /\/@makcikcooks\/video\/7400000000000000001$/);
  assert.equal(ins.video.key, '7400000000000000001');
  await c.browser.close();
});

test('no link anywhere in the feed: still shared (link taken from the share panel\'s "Copy link")', { skip: !BROWSER && 'no browser', timeout: 240_000 }, async () => {
  await site({ feedIds: 'none' });
  setShare({});
  m.db.exec('DELETE FROM shares'); sharesSeen.length = 0;
  await session(0.8);
  assert.ok(sharesSeen.length >= 2, `shared ${sharesSeen.length}`);
  assert.ok(sharesSeen.every(s => s.to === 'bibacau' && RECIPES.includes(s.id)));
  assert.equal(new Set(sharesSeen.map(s => s.id)).size, sharesSeen.length, 'never twice');
  const done = m.db.prepare("SELECT * FROM shares WHERE status = 'done'").all();
  assert.equal(done.length, sharesSeen.length);
  assert.ok(done.every((r: any) => /\/video\/74000000000000000\d\d$/.test(r.video_url)), 'link recovered via Copy link');
  const dup = m.db.prepare("SELECT * FROM shares WHERE status = 'skipped'").all();
  assert.ok(dup.every((r: any) => /skipped: duplicate/.test(r.error)), 'repeat saves are logged as duplicates, not silent');
});

test('a video that auto-advanced during the second look is queued and sent from its own page', { skip: !BROWSER && 'no browser', timeout: 240_000 }, async () => {
  await site({ feedIds: 'wrapper', autoAdvanceMs: 2200 });
  m.db.exec('DELETE FROM shares'); sharesSeen.length = 0;
  await session(0.8);
  const rows = m.db.prepare('SELECT * FROM shares').all();
  const queuedThenDone = rows.filter((r: any) => r.status === 'done');
  assert.ok(queuedThenDone.length >= 1, JSON.stringify(rows.map((r: any) => [r.status, r.error])));
  assert.ok(sharesSeen.length >= 1 && sharesSeen.every(s => RECIPES.includes(s.id)));
  assert.equal(new Set(sharesSeen.map(s => s.id)).size, sharesSeen.length);
  assert.ok(!rows.some((r: any) => ['queued', 'sending'].includes(r.status)), 'nothing left waiting');
  const events = m.db.prepare("SELECT message FROM events WHERE type = 'share' AND message LIKE 'Queued%'").all();
  assert.ok(events.length >= 1, 'at least one share had to be queued because the video moved on');
});

test('every skip is written to History → Shares with its reason', async () => {
  m.db.exec('DELETE FROM shares');
  const t = (k: string) => ({ videoKey: k, url: `${tt.url}/@x/video/${k}`, author: 'x' });
  const base = { enabled: true, to: 'bibacau', mode: 'every', minScore: 85, dailyCap: 50, requireApproval: false, telegram: 'off' };
  assert.equal(await m.share.planShare(null, { ...base, enabled: false }, t('1'), null, 99, true), 'skipped');
  assert.equal(await m.share.planShare(null, { ...base, mode: 'picks' }, t('2'), null, 99, true), 'skipped');
  assert.equal(await m.share.planShare(null, { ...base, mode: 'score' }, t('3'), null, 60, true), 'skipped');
  assert.equal(await m.share.planShare(null, { ...base, to: '' }, t('4'), null, 99, true), 'skipped');
  assert.equal(await m.share.planShare(null, base, { videoKey: '5', url: null }, null, 99, false), 'failed');
  assert.equal(await m.share.planShare(null, base, t('6'), null, 99, false), 'queued');
  assert.equal(await m.share.planShare(null, base, t('6'), null, 99, false), 'skipped');
  assert.equal(await m.share.planShare(null, { ...base, dailyCap: 1 }, t('7'), null, 99, true), 'skipped');
  const why = m.db.prepare('SELECT video_key, status, error FROM shares ORDER BY id').all().map((r: any) => `${r.video_key}:${r.status}:${r.error}`);
  const expect = [/1:skipped:skipped: sharing is off/, /2:skipped:.*Today's picks/, /3:skipped:.*score 60 is below 85/, /4:skipped:.*no username/,
    /5:failed:No video link/, /6:queued:.*left the screen/, /6:skipped:skipped: duplicate/, /7:skipped:.*daily cap/];
  expect.forEach((re, i) => assert.match(why[i], re));
  // Retry on a failed / skipped share
  const skipped = m.db.prepare("SELECT id FROM shares WHERE video_key = '3'").get();
  m.share.retryShare(skipped.id);
  assert.equal(m.db.prepare('SELECT status FROM shares WHERE id = ?').get(skipped.id).status, 'queued');
  const noLink = m.db.prepare("SELECT id FROM shares WHERE video_key = '5'").get();
  assert.throws(() => m.share.retryShare(noLink.id), /No link/);
  m.db.exec('DELETE FROM shares');
});

test('"Test share now" reports every step; a failing step saves a screenshot and the panel text', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  await site({});
  const page = await m.controller.browser.ensure();
  const ok = await m.share.testShare(page, { to: 'bibacau' }, `${tt.url}/@rotiman/video/7400000000000000006`);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.steps.map((s: any) => s.step), ['share button found', 'panel opened', '"Send to" found', 'recipient found', 'Send clicked', 'confirmed']);
  assert.match(ok.steps[3].detail, /typed into the panel search/);
  const bad = await m.share.testShare(page, { to: 'nobody_here' }, `${tt.url}/@rotiman/video/7400000000000000006`);
  assert.equal(bad.ok, false);
  assert.equal(bad.steps.at(-1).step, 'recipient found');
  assert.ok(bad.screenshot && fs.existsSync(path.join(process.env.DATA_DIR!, 'media', path.basename(bad.screenshot))));
  assert.match(bad.panelText, /Send|Share to/);
  await m.controller.browser.close();
});

test('History → Sessions numbers update while the session runs, and after a crash', { skip: !BROWSER && 'no browser', timeout: 200_000 }, async () => {
  await site({});
  setShare({ enabled: false });
  const c = m.controller;
  await c.start({ minutes: 0.6 });
  const id = c.status.sessionId;
  await waitFor(() => (m.db.prepare('SELECT videos FROM sessions WHERE id = ?').get(id)?.videos ?? 0) >= 2 && c.status.state === 'running', 120_000, 'live session row');
  const live = m.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  assert.equal(live.status, 'running');
  assert.ok(live.videos >= 2 && live.watched_seconds > 0, JSON.stringify(live));
  await waitFor(() => c.status.state === 'idle', 120_000, 'end');
  // crash: a session left "running" with recorded videos → closed with real counts on startup
  const at = new Date(Date.now() - 120_000).toISOString();
  const sid = Number(m.db.prepare("INSERT INTO sessions (preset_id, preset_name, day, trigger, started_at, planned_seconds, status) VALUES ('x', 'x', '2026-11-24', 'manual', ?, 600, 'running')").run(at).lastInsertRowid);
  for (let i = 0; i < 5; i++) m.db.prepare("INSERT INTO videos (session_id, day, at, video_key, decision, saved) VALUES (?, '2026-11-24', ?, ?, 'watch', ?)").run(sid, new Date(Date.now() - 60_000 + i * 1000).toISOString(), `k${i}`, i < 2 ? 1 : 0);
  assert.ok(m.recover() >= 1);
  const s = m.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid);
  assert.equal(s.status, 'interrupted');
  assert.equal(s.videos, 5); assert.equal(s.saved, 2);
  assert.ok(s.watched_seconds >= 60 && s.watched_seconds <= 600);
});
