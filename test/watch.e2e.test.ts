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
  app.browser = { ...app.browser, channel: 'custom', executablePath: BROWSER, headless: true, muteAudio: true, baseUrl: tt.url, windowWidth: 1100, windowHeight: 800, hangTimeoutSeconds: 20 };
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
  assert.equal(JSON.parse(saved[0].data).frames.mode, 'text', 'frame mode recorded (no vision helper → text only)');
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
  const { killProfileProcesses } = await import('../src/browser/edge.ts');
  await killProfileProcesses(c.browser.profileDir()); // simulate an Edge crash
  await waitFor(() => c.browser.restarts >= 1 && c.status.counts.videos > before && c.status.state === 'running', 90_000, 'recover after crash');
  c.stop();
  await waitFor(() => c.status.state === 'idle', 30_000, 'stop');
  const s = m.db.prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT 1').get();
  assert.equal(s.status, 'stopped');
  const alerts = m.db.prepare("SELECT * FROM events WHERE level = 'alert'").all();
  assert.ok(alerts.some((a: any) => /Captcha|Verification/i.test(a.message)));
});

test('engagement: likes/favourites within caps on good videos; comments wait for approval, then post', { skip: !BROWSER && 'no browser', timeout: 240_000 }, async () => {
  const { engaged, commentsPosted } = await import('./fixture/fake-sites.ts');
  tt.close();
  tt = await startFakeTikTok(0, { captchaAfter: 0 });
  const app = m.store.getAppSettings(); app.browser.baseUrl = tt.url; m.store.saveAppSettings(app);
  const p = m.store.listPresets()[0];
  p.data.engagement.like = { enabled: true, dailyCap: 50, sessionCap: 2, minScore: 80 };
  p.data.engagement.favourite = { enabled: true, dailyCap: 50, sessionCap: 5, minScore: 80 };
  p.data.engagement.follow = { enabled: false, dailyCap: 5, sessionCap: 2, minScore: 90 };
  p.data.engagement.comment = { ...p.data.engagement.comment, enabled: true, dailyCap: 1, minScore: 85 };
  p.data.watch.behaviour.rewatch = true;
  m.store.updatePreset(p.id, { data: p.data });
  engaged.length = 0;
  const c = m.controller;
  await c.start({ minutes: 0.7 });
  await waitFor(() => c.status.state === 'idle', 150_000, 'session end');
  const likes = engaged.filter(e => e.kind === 'like');
  assert.equal(likes.length, 2, 'per-session like cap respected');
  assert.ok(engaged.some(e => e.kind === 'favourite'));
  assert.ok(!engaged.some(e => e.kind === 'follow'), 'follow disabled → never');
  const recipeIds = ['7400000000000000001', '7400000000000000004', '7400000000000000006', '7400000000000000008'];
  assert.ok(likes.every(l => recipeIds.includes(l.id)), 'only liked videos the AI scored highly');
  const pending = m.db.prepare("SELECT * FROM engagements WHERE kind = 'comment'").all();
  assert.equal(pending.length, 1, 'daily comment cap');
  assert.equal(pending[0].status, 'pending', 'not posted without approval');
  assert.equal(commentsPosted.length, 0);
  // You approve it (and edit it) → posted between sessions
  m.db.prepare("UPDATE engagements SET status = 'approved', text = ? WHERE id = ?").run('Nampak sedap, nak cuba!', pending[0].id);
  const n = await c.postApprovedComments();
  assert.equal(n, 1);
  assert.deepEqual(commentsPosted.map(x => x.text), ['Nampak sedap, nak cuba!']);
  assert.equal(m.db.prepare('SELECT status FROM engagements WHERE id = ?').get(pending[0].id).status, 'posted');
});

test('AI-chosen search: types the query into the search bar character by character, logged, daily limit', { skip: !BROWSER && 'no browser', timeout: 240_000 }, async () => {
  const { searchesSeen } = await import('./fixture/fake-sites.ts');
  const p = m.store.listPresets()[0];
  p.data.engagement.like.enabled = false; p.data.engagement.favourite.enabled = false; p.data.engagement.comment.enabled = false;
  p.data.watch.sources.aiSearch = { enabled: true, dailyLimit: 1, allowTopics: ['kuih', 'resepi'], blockList: ['dance'] };
  m.store.updatePreset(p.id, { data: p.data });
  const c = m.controller;
  await c.start({ minutes: 0.6 });
  await waitFor(() => c.status.search?.query === 'resepi kuih raya mudah', 120_000, 'AI search shown on Status');
  await waitFor(() => c.status.state === 'idle', 150_000, 'session end');
  assert.equal(searchesSeen.length, 1, 'one search (daily limit 1)');
  assert.equal(searchesSeen[0].q, 'resepi kuih raya mudah');
  assert.equal(searchesSeen[0].keys, 'resepi kuih raya mudah'.length, 'typed key by key, not pasted');
  const rows = m.db.prepare('SELECT * FROM searches').all();
  assert.equal(rows.filter((r: any) => r.status === 'done').length, 1);
  assert.equal(rows[0].method, 'typed');
  assert.match(rows[0].reason, /drifting/);
});

test('AI search falls back to the search link only when no search box exists', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  const { searchesSeen } = await import('./fixture/fake-sites.ts');
  tt.close();
  tt = await startFakeTikTok(0, { noSearchBox: true });
  const app = m.store.getAppSettings(); app.browser.baseUrl = tt.url; m.store.saveAppSettings(app);
  const c = m.controller;
  await c.tiktok.open({ kind: 'foryou' });
  const r = await c.tiktok.searchTyped('kuih bahulu');
  assert.equal(r.method, 'url');
  assert.equal(searchesSeen.at(-1)!.q, 'kuih bahulu');
  await c.browser.close();
});

test('share saved videos: every save sent once to @bibacau via Share → Send to (typed search), duplicates skipped', { skip: !BROWSER && 'no browser', timeout: 240_000 }, async () => {
  const { sharesSeen, shareOpts } = await import('./fixture/fake-sites.ts');
  shareOpts.recipients = ['kawan1', 'bibacau', 'kawan2']; shareOpts.notMutual = false;
  tt.close();
  tt = await startFakeTikTok(0, {});
  const app = m.store.getAppSettings(); app.browser.baseUrl = tt.url; m.store.saveAppSettings(app);
  const p = m.store.listPresets()[0];
  p.data.watch.sources.aiSearch.enabled = false;
  p.data.watch.behaviour.rewatch = true; // the same videos come round again → must not be shared twice
  p.data.save.share = { enabled: true, to: 'bibacau', mode: 'every', minScore: 85, dailyCap: 50, requireApproval: false, telegram: 'off' };
  m.store.updatePreset(p.id, { data: p.data });
  sharesSeen.length = 0;
  m.db.exec('DELETE FROM shares');
  const c = m.controller;
  await c.start({ minutes: 1.2 });
  await waitFor(() => c.status.state === 'idle', 200_000, 'session end');
  assert.ok(sharesSeen.length >= 2, `shared ${sharesSeen.length}`);
  assert.ok(sharesSeen.every(s => s.to === 'bibacau'));
  const ids = sharesSeen.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'never the same video twice');
  const recipeIds = ['7400000000000000001', '7400000000000000004', '7400000000000000006', '7400000000000000008'];
  assert.ok(ids.every(id => recipeIds.includes(id)), 'only saved videos');
  const savedTwice = m.db.prepare("SELECT video_key, COUNT(*) n FROM videos WHERE saved = 1 AND session_id = (SELECT MAX(id) FROM sessions) GROUP BY video_key HAVING n > 1").all();
  assert.ok(savedTwice.length > 0, 'test really re-saved a video');
  const rows = m.db.prepare("SELECT * FROM shares WHERE status = 'done'").all();
  assert.equal(rows.length, ids.length);
  assert.ok(rows.every((r: any) => r.recipient === 'bibacau' && r.video_url.includes('/video/')));
});

test('recipient missing → clear explanation, sharing paused, Telegram fallback; after following each other, Retry sends', { skip: !BROWSER && 'no browser', timeout: 240_000 }, async () => {
  const http = await import('node:http');
  const tg: string[] = [];
  const tgs = http.createServer(async (req, res) => { let b = ''; for await (const x of req) b += x; tg.push(JSON.parse(b).text); res.end('{"ok":true}'); }).listen(0, '127.0.0.1');
  await new Promise(r => tgs.once('listening', r));
  process.env.TELEGRAM_API = `http://127.0.0.1:${(tgs.address() as any).port}`;
  const { sharesSeen, shareOpts } = await import('./fixture/fake-sites.ts');
  shareOpts.recipients = ['kawan1', 'kawan2']; // main account not reachable
  tt.close(); tt = await startFakeTikTok(0, {});
  const app = m.store.getAppSettings();
  app.browser.baseUrl = tt.url;
  app.notifications = { ...app.notifications, telegramBotToken: '123:abc', telegramChatId: '42' };
  m.store.saveAppSettings(app);
  const p = m.store.listPresets()[0];
  p.data.save.share = { ...p.data.save.share, to: 'mainacct', telegram: 'on_failure' };
  m.store.updatePreset(p.id, { data: p.data });
  sharesSeen.length = 0;
  const c = m.controller;
  await c.start({ minutes: 0.8 });
  await waitFor(() => c.status.state === 'idle', 200_000, 'session end');
  assert.equal(c.status.alert?.kind, 'share_blocked');
  assert.match(c.status.alert.message, /@mainacct.*follow/s);
  assert.equal(sharesSeen.length, 0);
  const rows = m.db.prepare("SELECT * FROM shares WHERE recipient = 'mainacct'").all();
  assert.equal(rows.filter((r: any) => r.error && /follow/.test(r.error) && r.status === 'blocked').length >= 1, true);
  assert.ok(tg.length >= 1 && tg.every(t => /tiktok|\/video\//.test(t)), 'links sent to Telegram instead');
  // You make the accounts follow each other → Retry
  shareOpts.recipients = ['kawan1', 'mainacct'];
  const res = await fetch(`http://127.0.0.1:0`).catch(() => null); void res;
  const { retryBlocked } = await import('../src/watch/share.ts');
  assert.ok(retryBlocked() >= 1);
  c.dismissAlert();
  const n = await c.shareQueuedNow();
  assert.ok(n >= 1, `retried ${n}`);
  assert.ok(sharesSeen.every(s => s.to === 'mainacct') && sharesSeen.length === n);
  assert.equal(new Set(sharesSeen.map(s => s.id)).size, sharesSeen.length, 'retry never sends a video twice');
  const perVideo = m.db.prepare("SELECT video_key, COUNT(*) n FROM shares WHERE recipient = 'mainacct' AND status = 'done' GROUP BY video_key HAVING n > 1").all();
  assert.equal(perVideo.length, 0, 'each video sent at most once');
  assert.equal(await c.shareQueuedNow(), 0, 'nothing left to send');
  tgs.close();
});

test('not allowed to message → explained, not retried', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  const { shareOpts } = await import('./fixture/fake-sites.ts');
  const { shareOnPage } = await import('../src/watch/share.ts');
  shareOpts.recipients = ['bibacau']; shareOpts.notMutual = true;
  const page = await m.controller.browser.ensure();
  await page.goto(`${tt.url}/@makcikcooks/video/7400000000000000001`);
  await new Promise(r => setTimeout(r, 1500));
  const r = await shareOnPage(page, 'bibacau');
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'blocked');
  assert.match(r.message!, /won't let the watcher account message @bibacau.*follow each other/s);
  shareOpts.notMutual = false;
  await m.controller.browser.close();
});

test('share with "require my approval": waits in the list, sends only after approval; picks mode queues once', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  const { sharesSeen, shareOpts } = await import('./fixture/fake-sites.ts');
  const share = await import('../src/watch/share.ts');
  shareOpts.recipients = ['bibacau']; shareOpts.notMutual = false;
  tt.close(); tt = await startFakeTikTok(0, {});
  const app = m.store.getAppSettings(); app.browser.baseUrl = tt.url; m.store.saveAppSettings(app);
  m.db.exec('DELETE FROM shares'); sharesSeen.length = 0;
  const cfg = { enabled: true, to: 'bibacau', mode: 'every', minScore: 85, dailyCap: 50, requireApproval: true, telegram: 'off' };
  const t = { videoKey: '7400000000000000006', url: `${tt.url}/@rotiman/video/7400000000000000006`, author: 'rotiman' };
  assert.equal(await share.planShare(null, cfg, t, null, 90, false), 'pending');
  assert.equal(await share.planShare(null, cfg, t, null, 90, false), 'skipped', 'no second share for the same video (logged as a skip)');
  assert.equal(sharesSeen.length, 0, 'nothing sent before approval');
  const row = m.db.prepare("SELECT * FROM shares WHERE status = 'pending'").get();
  share.approveShare(row.id);
  const p = m.store.listPresets()[0]; p.data.save.share = { ...cfg, requireApproval: false }; m.store.updatePreset(p.id, { data: p.data });
  assert.equal(await m.controller.shareQueuedNow(), 1);
  assert.deepEqual(sharesSeen, [{ id: '7400000000000000006', to: 'bibacau' }]);
  // picks mode: queue today's picks once (already-sent one is skipped)
  const picks = [{ video_key: '7400000000000000006', url: t.url }, { video_key: '7400000000000000008', url: `${tt.url}/@laksalady/video/7400000000000000008` }];
  assert.equal(share.queuePicks({ ...cfg, mode: 'picks', requireApproval: false }, picks), 1);
  assert.equal(share.queuePicks({ ...cfg, mode: 'picks', requireApproval: false }, picks), 0, 'once');
  assert.equal(await m.controller.shareQueuedNow(), 1);
  assert.equal(sharesSeen.length, 2);
  await m.controller.browser.close();
});
