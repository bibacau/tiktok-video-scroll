// Vision helper path: DeepSeek-like text-only model + a separate vision model (fake server).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockLlm } from './fixture/fake-sites.ts';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-vision-'));
let llm: Awaited<ReturnType<typeof startMockLlm>>, m: any;
const img = { mime: 'image/jpeg', base64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==' };

function configure(vision: Record<string, unknown>) {
  const app = m.store.getAppSettings();
  app.llm = { ...app.llm, baseUrl: llm.url, apiKey: 'sk-test-123456789', retries: 0 };
  app.vision = { ...app.vision, ...vision };
  m.store.saveAppSettings(app);
}

before(async () => {
  llm = await startMockLlm();
  (await import('../src/paths.ts')).ensureDirs();
  m = {
    store: await import('../src/settings/store.ts'),
    client: await import('../src/llm/client.ts'),
    vt: await import('../src/llm/vision-test.ts'),
    db: (await import('../src/db.ts')).getDb(),
  };
});
after(() => llm?.close());

test('vision helper describes frames, DeepSeek decides from the text', async () => {
  // Ollama-style: local address, no API key
  configure({ enabled: true, provider: 'ollama', baseUrl: llm.url, model: 'mock-vision', apiKey: '' });
  const r = await m.client.chatJson({ step: 'watch', system: 'Decide if this video is worth it. Caption: nasi lemak recipe', images: [img, img] });
  assert.equal(r.mode, 'vision');
  assert.equal(r.visionModel, 'mock-vision');
  assert.match(r.visionNote, /nasi lemak/);
  assert.equal(llm.stats.visionCalls, 1);
  assert.equal(llm.stats.imageRejects, 0, 'main model never received images');
  assert.match(llm.stats.lastUserText, /RESEPI MUDAH/, 'description passed on to the main model');
  assert.equal(llm.stats.lastVisionAuth, 'Bearer local', 'no key needed for a local server');
  const row = m.db.prepare("SELECT * FROM usage WHERE provider = 'vision'").get();
  assert.equal(row.model, 'mock-vision');
  assert.equal(row.prompt_tokens, 900);
});

test('Test vision button: sends a sample frame, returns the description', async () => {
  configure({ enabled: false, provider: 'custom', baseUrl: llm.url, model: 'mock-vision', apiKey: 'sk-vision-key-12345' });
  const r = await m.vt.testVision();
  assert.equal(r.ok, true);
  assert.match(r.description, /I see 1 image/);
  assert.match(r.source, /test card/);
  assert.equal(r.enabled, false);
  assert.equal(llm.stats.lastVisionAuth, 'Bearer sk-vision-key-12345');
});

test('vision off → text-only fallback; broken vision model → still decides', async () => {
  configure({ enabled: false });
  const off = await m.client.chatJson({ step: 'watch', system: 'Decide if this video is worth it.', images: [img] });
  assert.equal(off.mode, 'text');
  assert.equal(llm.stats.imageRejects, 1);
  configure({ enabled: true, model: 'missing-vision' });
  const broken = await m.client.chatJson({ step: 'watch', system: 'Decide if this video is worth it.', images: [img] });
  assert.equal(broken.mode, 'text');
});

test('preset fills and default prices exist for every vision preset', async () => {
  const { appSchema, VISION_PROVIDERS, DEFAULT_PRICING } = await import('../src/settings/schema.ts');
  const fills = (appSchema as any).fields.vision.fields.provider.fills;
  for (const p of VISION_PROVIDERS.filter(p => p.baseUrl)) {
    assert.equal(fills[p.value].model, p.model);
    assert.ok(DEFAULT_PRICING.some(r => r.provider === 'vision' && r.model === p.model), `price for ${p.model}`);
  }
});
