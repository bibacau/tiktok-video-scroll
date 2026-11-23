// Scene visuals: text slides, licensed stock footage, AI images, AI video. Pluggable by source.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getAppSettings } from '../settings/store.ts';
import { recordCost, assertBudget } from '../llm/budget.ts';
import { getPrompt, render as renderPrompt } from '../settings/prompts.ts';
import { log } from '../log.ts';
import { paths } from '../paths.ts';

export interface Scene { voiceover: string; on_screen?: string; keywords?: string; image_prompt?: string }
export interface Visual { kind: 'slide' | 'video' | 'image'; file?: string; source: string; credit?: string; error?: string }

// ------------------------------------------------------------------ fixed safety rules
// Stock/AI video may only come from licensed stock libraries or the AI provider's own storage.
// TikTok (and its CDNs) are always refused: we never download other people's TikTok videos.
const NEVER = /(^|\.)(tiktok\.com|tiktokcdn\.com|tiktokv\.com|tiktokcdn-us\.com|byteoversea\.com|ibytedtos\.com|musical\.ly|ttwstatic\.com|douyin\.com)$/i;
const VIDEO_HOSTS = /(^|\.)(pexels\.com|pixabay\.com|replicate\.delivery|replicate\.com)$/i;
const IMAGE_SAFETY = 'Fictional scene only: do not depict real, famous or identifiable people, do not imitate a real person\'s likeness, no brand logos, no text or watermarks.';

function checkHost(url: string, kind: 'video' | 'image') {
  const u = new URL(url);
  const extra = (process.env.TEST_MEDIA_HOSTS ?? '').split(',').filter(Boolean);
  if (NEVER.test(u.hostname)) throw new Error(`Refusing to download from ${u.hostname}: never re-use other people's TikTok videos`);
  if (kind === 'video' && !VIDEO_HOSTS.test(u.hostname) && !extra.includes(u.hostname)) throw new Error(`Refusing video download from ${u.hostname}: only licensed stock (Pexels/Pixabay) or AI provider storage is allowed`);
  if (u.protocol !== 'https:' && !extra.includes(u.hostname)) throw new Error('Only https downloads are allowed');
}

async function download(url: string, kind: 'video' | 'image', ext: string, headers: Record<string, string> = {}): Promise<string> {
  checkHost(url, kind);
  const dir = path.join(paths.media, 'cache'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${createHash('sha1').update(url).digest('hex').slice(0, 20)}.${ext}`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  checkHost(res.url || url, kind);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 300 * 1024 * 1024) throw new Error('Downloaded file too large');
  fs.writeFileSync(file, buf);
  return file;
}

const orientation = (aspect: string) => aspect === '16:9' ? 'landscape' : aspect === '1:1' ? 'square' : 'portrait';
const pick = (list: any[], n = 5): any => list[Math.floor(Math.random() * Math.min(n, list.length))];

// ------------------------------------------------------------------ stock footage
async function pexels(query: string, aspect: string, minSeconds: number): Promise<Visual> {
  const key = getAppSettings().media.pexelsKey;
  if (!key) throw new Error('No Pexels API key (Settings → Media providers)');
  const base = process.env.PEXELS_API ?? 'https://api.pexels.com';
  const res = await fetch(`${base}/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation(aspect)}&per_page=15`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels: HTTP ${res.status}`);
  const data: any = await res.json();
  const vids = (data.videos ?? []).filter((v: any) => (v.duration ?? 99) >= Math.min(minSeconds, 4));
  const v = pick(vids.length ? vids : data.videos ?? []);
  if (!v) throw new Error(`No Pexels video for "${query}"`);
  const files = (v.video_files ?? []).filter((f: any) => f.file_type === 'video/mp4' && f.link).sort((a: any, b: any) => Math.abs((a.height ?? 0) - 1920) - Math.abs((b.height ?? 0) - 1920));
  if (!files[0]) throw new Error('Pexels result has no mp4');
  return { kind: 'video', file: await download(files[0].link, 'video', 'mp4'), source: 'pexels', credit: `Video by ${v.user?.name ?? 'unknown'} on Pexels` };
}
async function pixabay(query: string, _aspect: string): Promise<Visual> {
  const key = getAppSettings().media.pixabayKey;
  if (!key) throw new Error('No Pixabay API key (Settings → Media providers)');
  const base = process.env.PIXABAY_API ?? 'https://pixabay.com';
  const res = await fetch(`${base}/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&per_page=15&safesearch=true`);
  if (!res.ok) throw new Error(`Pixabay: HTTP ${res.status}`);
  const data: any = await res.json();
  const v = pick(data.hits ?? []);
  if (!v) throw new Error(`No Pixabay video for "${query}"`);
  const url = v.videos?.large?.url || v.videos?.medium?.url || v.videos?.small?.url;
  return { kind: 'video', file: await download(url, 'video', 'mp4'), source: 'pixabay', credit: `Video by ${v.user ?? 'unknown'} on Pixabay` };
}

// ------------------------------------------------------------------ Replicate (AI images / video)
async function replicate(model: string, input: Record<string, unknown>): Promise<string> {
  const token = getAppSettings().media.replicateToken;
  if (!token) throw new Error('No Replicate token (Settings → Media providers)');
  const base = process.env.REPLICATE_API ?? 'https://api.replicate.com';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait=60' };
  let res = await fetch(`${base}/v1/models/${model}/predictions`, { method: 'POST', headers, body: JSON.stringify({ input }) });
  let pred: any = await res.json();
  if (!res.ok) throw new Error(`Replicate: ${pred?.detail ?? res.status}`);
  const end = Date.now() + 15 * 60_000;
  while (!['succeeded', 'failed', 'canceled'].includes(pred.status) && Date.now() < end) {
    await new Promise(r => setTimeout(r, 3000));
    res = await fetch(pred.urls.get, { headers }); pred = await res.json();
  }
  if (pred.status !== 'succeeded') throw new Error(`Replicate: ${pred.error ?? pred.status}`);
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (typeof out !== 'string') throw new Error('Replicate returned no file');
  return out;
}

function imagePrompt(scene: Scene, style: string) {
  return `${renderPrompt(getPrompt('create_image'), { scene: scene.image_prompt || scene.on_screen || scene.voiceover, style })}\n${IMAGE_SAFETY}`;
}

async function aiImage(scene: Scene, style: string, aspect: string): Promise<Visual> {
  const m = getAppSettings().media;
  assertBudget();
  const prompt = imagePrompt(scene, style);
  let file: string;
  if (m.imageProvider === 'replicate') {
    const url = await replicate(m.imageModel, { prompt, aspect_ratio: aspect });
    file = await download(url, 'image', 'png');
  } else {
    if (!m.imageKey && !/localhost|127\.0\.0\.1/.test(m.imageBaseUrl)) throw new Error('No images API key (Settings → Media providers)');
    const body: any = { model: m.imageModel, prompt, n: 1, size: m.imageSize };
    if (/^gpt-image/.test(m.imageModel)) body.quality = m.imageQuality;
    else if (/^dall-e/.test(m.imageModel)) body.response_format = 'b64_json';
    const res = await fetch(`${m.imageBaseUrl.replace(/\/+$/, '')}/images/generations`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${m.imageKey || 'local'}` }, body: JSON.stringify(body) });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Image API: ${data?.error?.message ?? res.status}`);
    const d = data.data?.[0];
    const dir = path.join(paths.media, 'cache'); fs.mkdirSync(dir, { recursive: true });
    if (d?.b64_json) { file = path.join(dir, `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`); fs.writeFileSync(file, Buffer.from(d.b64_json, 'base64')); }
    else if (d?.url) file = await download(d.url, 'image', 'png');
    else throw new Error('Image API returned no image');
  }
  recordCost('image', m.imageModel, 'image', m.imagePriceUsd, { units: 1 });
  return { kind: 'image', file, source: `ai-image:${m.imageModel}` };
}

async function aiVideo(scene: Scene, style: string, aspect: string, seconds: number): Promise<Visual> {
  const m = getAppSettings().media;
  if (!m.videoModel) throw new Error('No AI video model set (Settings → Media providers)');
  assertBudget();
  const prompt = imagePrompt(scene, style);
  const input = JSON.parse(JSON.stringify(m.videoInput ?? { prompt: '{{prompt}}' }), (_k, v) =>
    typeof v === 'string' ? (v === '{{seconds}}' ? Math.round(seconds) : v.replace('{{prompt}}', prompt).replace('{{aspect}}', aspect).replace('{{seconds}}', String(Math.round(seconds)))) : v);
  const url = await replicate(m.videoModel, input);
  recordCost('video', m.videoModel, 'ai-video', m.videoPriceUsd, { units: 1 });
  return { kind: 'video', file: await download(url, 'video', 'mp4'), source: `ai-video:${m.videoModel}` };
}

/** Get the visual for one scene. Falls back to a text slide on any failure. */
export async function sceneVisual(scene: Scene, index: number, create: any, seconds: number): Promise<Visual> {
  const v = create.visuals, aspect = create.basics.aspect;
  const query = (scene.keywords || scene.on_screen || scene.voiceover).split(/\s+/).slice(0, 6).join(' ');
  const stock = () => v.stockProvider === 'pixabay' ? pixabay(query, aspect) : pexels(query, aspect, seconds);
  const plan: Record<string, () => Promise<Visual>> = {
    slides: async () => ({ kind: 'slide', source: 'slide' }),
    stock,
    ai_image: () => aiImage(scene, v.imageStyle, aspect),
    ai_video: () => aiVideo(scene, v.imageStyle, aspect, seconds).catch(e => { log('warn', 'create', `AI video failed (${e.message}) — trying an AI image`); return aiImage(scene, v.imageStyle, aspect); }),
    mixed: () => index % 2 === 0 ? stock() : aiImage(scene, v.imageStyle, aspect),
  };
  try { return await (plan[v.source] ?? plan.slides)(); } catch (e: any) {
    if (e?.code === 'BUDGET_EXCEEDED') throw e;
    log('warn', 'create', `Scene ${index + 1}: ${e.message} — using a text slide instead`);
    return { kind: 'slide', source: 'slide', error: e.message };
  }
}
