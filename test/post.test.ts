// Phase 3: approval queue, posting modes, AI-generated label (locked on), analytics → planning.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeStudio } from './fixture/fake-studio.ts';
import { testAssets } from './fixture/fake-sites.ts';

const BROWSER = process.env.BROWSER_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(p => fs.existsSync(p));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-post-'));
process.env.DATA_DIR = tmp;
let studio: Awaited<ReturnType<typeof startFakeStudio>>, m: any, accountId: string, presetId: string;

const waitFor = async (fn: () => boolean, ms: number, label: string) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 300)); }
  throw new Error(`Timed out waiting for ${label}`);
};
/** A finished video in the Studio (status ready), as Phase 2 would leave it. */
function readyVideo(title: string) {
  const db = m.db, at = new Date().toISOString();
  const id = Number(db.prepare(`INSERT INTO creations (day, preset_id, status, stage, title, caption, hashtags, script, created_at, updated_at) VALUES (?, ?, 'ready', 'Ready for review', ?, ?, ?, ?, ?, ?)`)
    .run(at.slice(0, 10), presetId, title, `${title} 🍛 Anda suka?`, JSON.stringify(['fyp', 'malaysia']), JSON.stringify({ title, hook: `Hook of ${title}`, scenes: [] }), at, at).lastInsertRowid);
  const dir = path.join(tmp, 'renders', String(id)); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(testAssets().stock, path.join(dir, 'final.mp4'));
  db.prepare('UPDATE creations SET video_path = ? WHERE id = ?').run(path.join(dir, 'final.mp4'), id);
  return id;
}
const setPost = (patch: Record<string, unknown>) => { const p = m.store.getPreset(presetId); Object.assign(p.data.post, patch); m.store.updatePreset(presetId, { data: p.data }); };

before(async () => {
  studio = await startFakeStudio();
  (await import('../src/paths.ts')).ensureDirs();
  m = {
    store: await import('../src/settings/store.ts'), db: (await import('../src/db.ts')).getDb(),
    accounts: await import('../src/post/accounts.ts'), poster: await import('../src/post/poster.ts'),
    analytics: await import('../src/post/analytics.ts'), pipeline: await import('../src/create/pipeline.ts'),
  };
  const app = m.store.getAppSettings();
  app.browser = { ...app.browser, channel: 'custom', executablePath: BROWSER, headless: true, baseUrl: studio.url };
  m.store.saveAppSettings(app);
  presetId = m.store.listPresets()[0].id;
  accountId = m.accounts.addAccount('Food channel', '@foodie').id;
  setPost({ account: accountId, scheduleWith: 'app', times: ['09:00', '13:00', '21:00'], maxPerDay: 2 });
});
after(async () => { m?.poster.poster.stop(); studio?.close(); await (await import('../src/browser/edge.ts')).closeProfile(`acct-${accountId}`).catch(() => {}); });

const status = (id: number) => m.pipeline.getCreation(id).status;

test('approve → post now: uploads with caption + hashtags and the AI-generated label ON', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  const id = readyVideo('Nasi lemak 3 langkah');
  m.poster.poster.approve(id, { when: 'now' });
  await waitFor(() => ['posted', 'post_failed'].includes(status(id)), 90_000, 'post');
  const c = m.pipeline.getCreation(id);
  assert.equal(c.status, 'posted', c.post_error);
  assert.equal(studio.posts.length, 1);
  assert.equal(studio.posts[0].ai, true, 'AI-generated label on');
  assert.match(studio.posts[0].caption, /Nasi lemak 3 langkah 🍛 Anda suka\? #fyp #malaysia/);
  assert.equal(studio.posts[0].privacy, 'Everyone');
  assert.equal(c.post_id, studio.posts[0].id, 'post found in the content list by caption');
  assert.match(c.post_url, /\/video\/\d+/);
});

test('AI label cannot be confirmed → NOT posted', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  studio.opts.aiBroken = true;
  const id = readyVideo('Roti canai myths');
  m.poster.poster.approve(id, { when: 'now' });
  await waitFor(() => ['posted', 'post_failed'].includes(status(id)), 90_000, 'post attempt');
  const c = m.pipeline.getCreation(id);
  assert.equal(c.status, 'post_failed');
  assert.match(c.post_error, /AI-generated/);
  assert.equal(studio.posts.length, 1, 'nothing new reached TikTok');
  studio.opts.aiBroken = false;
  m.poster.poster.unschedule(id); // back to approval
  assert.equal(status(id), 'ready');
});

test('private audience is set and verified', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  setPost({ privacy: 'private' });
  const id = readyVideo('Only me test');
  m.poster.poster.approve(id, { when: 'now' });
  await waitFor(() => ['posted', 'post_failed'].includes(status(id)), 90_000, 'post');
  assert.equal(status(id), 'posted', m.pipeline.getCreation(id).post_error);
  assert.equal(studio.posts.at(-1)!.privacy, 'Only you');
  setPost({ privacy: 'public' });
});

test("TikTok's own scheduler: if it can't be set, the upload is cancelled (never posts immediately)", { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  setPost({ scheduleWith: 'tiktok' });
  const id = readyVideo('Scheduled one');
  const before = studio.posts.length;
  m.poster.poster.approve(id, { when: new Date(Date.now() + 3 * 3600_000).toISOString() });
  await waitFor(() => ['scheduled_tiktok', 'post_failed'].includes(status(id)), 90_000, 'schedule attempt');
  const c = m.pipeline.getCreation(id);
  assert.equal(c.status, 'post_failed');
  assert.match(c.post_error, /schedule/i);
  assert.equal(studio.posts.length, before, 'nothing published');
  setPost({ scheduleWith: 'app' });
  m.poster.poster.unschedule(id);
});

test('slots: next free time, max per day, app-scheduled posts go out when due', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  const post = m.store.getPreset(presetId).data.post;
  const a = m.poster.nextSlot(post, accountId);
  assert.ok(a && a.getTime() > Date.now());
  const id = readyVideo('Slot test');
  m.poster.poster.approve(id, { when: 'slot' });
  const c = m.pipeline.getCreation(id);
  assert.equal(c.status, 'scheduled');
  assert.equal(new Date(c.post_at).getTime(), a.getTime());
  const b = m.poster.nextSlot(post, accountId);
  assert.ok(b.getTime() > a.getTime(), 'slot taken');
  // make it due → the poster publishes it
  m.db.prepare('UPDATE creations SET post_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id);
  await m.poster.poster.tick();
  await waitFor(() => ['posted', 'post_failed'].includes(status(id)), 90_000, 'due post');
  assert.equal(status(id), 'posted', m.pipeline.getCreation(id).post_error);
});

test('auto mode approves finished videos by itself; approval mode does not', { skip: !BROWSER && 'no browser' }, async () => {
  setPost({ mode: 'approval' });
  const a = readyVideo('Waits for me');
  await m.poster.poster.tick();
  assert.equal(status(a), 'ready');
  setPost({ mode: 'auto' });
  await m.poster.poster.tick();
  assert.equal(status(a), 'scheduled');
  setPost({ mode: 'approval' });
  // a scheduled video can't be rebuilt or deleted by accident
  assert.throws(() => m.pipeline.creator.rebuild(a, 'render'), /approval queue first/);
});

test('logged-out account: posting stops and asks you to log in (never logs in by itself)', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  studio.opts.loggedOut = true;
  const id = readyVideo('Logged out');
  m.poster.poster.approve(id, { when: 'now' });
  await waitFor(() => ['posted', 'post_failed'].includes(status(id)), 90_000, 'attempt');
  assert.equal(status(id), 'post_failed');
  assert.match(m.pipeline.getCreation(id).post_error, /not logged in/);
  studio.opts.loggedOut = false;
});

test('analytics: reads TikTok Studio, links our videos, feeds planning', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  const rows = await m.analytics.refreshAnalytics(accountId);
  assert.ok(rows.length >= 3);
  const ours = rows.find((r: any) => r.title === 'Nasi lemak 3 langkah');
  assert.ok(ours && ours.views > 0 && ours.hook === 'Hook of Nasi lemak 3 langkah');
  const summary = m.analytics.performanceSummary(accountId, 14);
  assert.match(summary, /Nasi lemak 3 langkah.*views/);
  assert.ok(m.analytics.analyticsAt(accountId));
});
