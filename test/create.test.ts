// Phase 2: video creation end to end with ffmpeg, against fake AI / voice / stock / image services.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockLlm, startMediaMocks, testAssets } from './fixture/fake-sites.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-create-'));
process.env.DATA_DIR = tmp;
process.env.TEST_MEDIA_HOSTS = '127.0.0.1';
let llm: Awaited<ReturnType<typeof startMockLlm>>, media: Awaited<ReturnType<typeof startMediaMocks>>, m: any;

const waitFor = async (fn: () => boolean, ms: number, label: string) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 300)); }
  throw new Error(`Timed out waiting for ${label}`);
};
const waitDone = (id: number) => waitFor(() => ['ready', 'failed'].includes(m.pipeline.getCreation(id).status) && !m.pipeline.creator.current, 240_000, `creation #${id}`);

before(async () => {
  llm = await startMockLlm();
  media = await startMediaMocks();
  process.env.PEXELS_API = media.url;
  (await import('../src/paths.ts')).ensureDirs();
  m = {
    store: await import('../src/settings/store.ts'),
    pipeline: await import('../src/create/pipeline.ts'),
    files: await import('../src/files.ts'),
    ff: await import('../src/create/ffmpeg.ts'),
    visuals: await import('../src/create/visuals.ts'),
    db: (await import('../src/db.ts')).getDb(),
  };
  const app = m.store.getAppSettings();
  app.llm = { ...app.llm, baseUrl: llm.url, apiKey: 'sk-test-123456789', retries: 0 };
  app.tools = { ...app.tools, edgeTtsUrl: media.ws, preset: 'ultrafast' };
  app.media = { ...app.media, pexelsKey: 'pexels-test-key', imageBaseUrl: `${media.url}/v1`, imageKey: 'img-test-key', imageModel: 'gpt-image-1-mini', imagePriceUsd: 0.02 };
  app.budget = { ...app.budget, dailyCapRM: 0, monthlyCapRM: 0 };
  m.store.saveAppSettings(app);
  const a = testAssets();
  m.files.saveUpload('music', 'my-track.mp3', fs.readFileSync(a.music));
  m.files.saveUpload('logos', 'logo.png', fs.readFileSync(a.logo));
  const p = m.store.listPresets()[0];
  const c = p.data.create;
  c.basics = { ...c.basics, resolution: '720', aspect: '9:16' };
  c.visuals = { ...c.visuals, source: 'mixed', logo: 'logo.png' };
  c.music = { ...c.music, enabled: true, file: '', volume: 0.2, duck: true };
  c.script = { ...c.script, bannedWords: ['sedap'] };
  c.caption = { ...c.caption, hashtagCount: 5, alwaysTags: ['fyp', 'malaysia'] };
  m.store.updatePreset(p.id, { data: p.data });
});
after(() => { llm?.close(); media?.close(); });

test('creates a full video: plan → script → Edge voice → stock + AI images → music, logo, subtitles', async () => {
  const [c0] = m.pipeline.creator.createVideos({ count: 1 });
  await waitDone(c0.id);
  const c = m.pipeline.getCreation(c0.id);
  assert.equal(c.status, 'ready', c.error);
  // script & safety
  assert.equal(c.script.scenes.length, 4);
  assert.ok(!JSON.stringify(c.script).toLowerCase().includes('sedap'), 'banned word removed by rewrite');
  assert.equal(llm.stats.byKind.script, 2, 'script rewritten once because of a banned word');
  // caption rules
  assert.deepEqual(c.hashtags.slice(0, 2), ['fyp', 'malaysia']);
  assert.equal(c.hashtags.length, 5);
  assert.ok(!c.caption.includes('#'));
  // voice: Edge protocol with word timings
  assert.equal(media.stats.edgeRequests, 4);
  assert.equal(media.stats.edgeBadAuth, 0);
  assert.equal(media.stats.lastVoice, 'ms-MY-YasminNeural');
  assert.ok(c.assets.scenes.every((s: any) => s.voice?.words?.length > 0), 'word timings captured');
  // visuals: mixed = stock for even scenes, AI images for odd
  assert.deepEqual(c.assets.scenes.map((s: any) => s.visual.kind), ['video', 'image', 'video', 'image']);
  assert.ok(c.assets.credits.some((x: string) => x.includes('Pexels')));
  // output file
  const file = path.join(tmp, 'renders', String(c.id), 'final.mp4');
  assert.ok(fs.existsSync(file));
  const streams = await m.ff.probeStreams(file);
  const v = streams.find((s: any) => s.codec_type === 'video');
  assert.equal(v.width, 720); assert.equal(v.height, 1280);
  assert.ok(streams.some((s: any) => s.codec_type === 'audio'));
  const total = c.assets.durations.reduce((a: number, b: number) => a + b, 0);
  assert.ok(Math.abs(c.duration - total) < 0.5, `duration ${c.duration} ≈ ${total}`);
  assert.ok(fs.existsSync(path.join(tmp, 'renders', String(c.id), 'thumb.jpg')));
  // costs tagged to this creation (LLM + 2 AI images)
  const imgCost = m.db.prepare("SELECT COUNT(*) n FROM usage WHERE ref = ? AND provider = 'image'").get(`creation:${c.id}`);
  assert.equal(imgCost.n, 2);
  assert.ok(c.cost_rm > 0);
});

test('regenerate voice only (switch to text-only) keeps visuals; edit script then re-render', async () => {
  const id = m.pipeline.listCreations()[0].id;
  const before = m.pipeline.getCreation(id);
  const p = m.store.listPresets()[0];
  p.data.create.voice.provider = 'none';
  m.store.updatePreset(p.id, { data: p.data });
  const imagesBefore = media.stats.images, pexelsBefore = media.stats.pexels;
  m.pipeline.creator.rebuild(id, 'voice');
  await waitDone(id);
  const after1 = m.pipeline.getCreation(id);
  assert.equal(after1.status, 'ready', after1.error);
  assert.ok(after1.assets.scenes.every((s: any) => s.voice === null), 'no voice');
  assert.equal(media.stats.images, imagesBefore, 'visuals not regenerated');
  assert.equal(media.stats.pexels, pexelsBefore);
  assert.notEqual(after1.updated_at, before.updated_at);

  const script = { ...after1.script, scenes: after1.script.scenes.slice(0, 2) };
  m.pipeline.creator.saveScript(id, script);
  m.pipeline.creator.rebuild(id, 'render');
  await waitDone(id);
  const after2 = m.pipeline.getCreation(id);
  assert.equal(after2.status, 'ready', after2.error);
  assert.equal(after2.assets.scenes.length, 2);
  assert.equal(after2.assets.durations.length, 2);
});

test('slides only, no voice, no music, no logo still renders', async () => {
  const p = m.store.listPresets()[0];
  Object.assign(p.data.create.visuals, { source: 'slides', logo: '' });
  p.data.create.music.enabled = false;
  p.data.create.subtitles.style = 'outline';
  m.store.updatePreset(p.id, { data: p.data });
  const [c0] = m.pipeline.creator.createVideos({ count: 1, topic: 'roti canai' });
  await waitDone(c0.id);
  const c = m.pipeline.getCreation(c0.id);
  assert.equal(c.status, 'ready', c.error);
  assert.ok(c.assets.scenes.every((s: any) => s.visual.kind === 'slide'));
});

test('safety: never downloads TikTok videos, even if a stock API returns one', async () => {
  const create = m.store.listPresets()[0].data.create;
  create.visuals.source = 'stock';
  const v = await m.visuals.sceneVisual({ voiceover: 'x', keywords: 'tiktok trend' }, 0, create, 4);
  assert.equal(v.kind, 'slide');
  assert.match(v.error, /never re-use other people's TikTok videos/);
});
