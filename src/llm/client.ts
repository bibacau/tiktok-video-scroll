import { getAppSettings } from '../settings/store.ts';
import { kvGet, kvSet } from '../db.ts';
import { log } from '../log.ts';
import { assertBudget, recordTokens } from './budget.ts';
import { sleep } from '../time.ts';
import { getPrompt } from '../settings/prompts.ts';

export type Step = 'watch' | 'analyze' | 'picks' | 'plan' | 'script';
export interface Image { mime: string; base64: string }

export interface ChatRequest {
  step: Step;
  system: string;
  user?: string;
  images?: Image[];
  signal?: AbortSignal;
}
/** How the frames reached the decision: sent as images, described by the vision helper, or not at all. */
export type FrameMode = 'images' | 'vision' | 'text' | 'none';
export interface ChatResult<T = any> { json: T; text: string; model: string; usedImages: boolean; visionNote?: string; mode: FrameMode; visionModel?: string }

class HttpError extends Error { status: number; body: string; constructor(status: number, body: string) { super(`HTTP ${status}: ${body.slice(0, 300)}`); this.status = status; this.body = body; } }

async function post(baseUrl: string, apiKey: string, body: unknown, timeoutSeconds: number, signal?: AbortSignal) {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(baseUrl);
  if (!apiKey && !local) throw new Error(`No API key set for ${new URL(baseUrl).host}. Add it in the dashboard.`);
  if (!apiKey) apiKey = 'local';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('AI request timed out')), timeoutSeconds * 1000);
  const onAbort = () => ctrl.abort(signal!.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text);
    return JSON.parse(text);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}

async function withRetries<T>(fn: () => Promise<T>, retries: number, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e: any) {
      const retriable = !(e instanceof HttpError) || e.status === 429 || e.status >= 500;
      if (signal?.aborted || !retriable || attempt >= retries) throw e;
      await sleep(1500 * 2 ** attempt, signal);
    }
  }
}

/** Pull the first JSON object out of a model reply (tolerates ```json fences and chatter). */
export function extractJson(text: string): any {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error('AI reply had no JSON');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
  }
  throw new Error('AI reply JSON was incomplete');
}

const looksLikeNoImageSupport = (e: unknown) => e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 402 && e.status !== 429
  && /image|vision|multimodal|content.*type|unknown variant|image_url|deserializ/i.test(e.body);

/** Optional separate vision model: turns frames into a text description. */
export async function describeFrames(images: Image[], signal?: AbortSignal, force = false): Promise<{ text: string; model: string } | null> {
  const s = getAppSettings(), v = s.vision;
  if ((!v.enabled && !force) || !v.baseUrl || !v.model) return null;
  assertBudget();
  const data = await withRetries(() => post(v.baseUrl, v.apiKey, {
    model: v.model, temperature: 0.2, max_tokens: v.maxTokens,
    messages: [{ role: 'user', content: [{ type: 'text', text: getPrompt('vision_describe') }, ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}`, detail: v.detail } }))] }],
  }, s.llm.timeoutSeconds, signal), s.llm.retries, signal);
  recordTokens('vision', v.model, 'vision', data.usage);
  const text = String(data.choices?.[0]?.message?.content ?? '').trim();
  return text ? { text, model: v.model } : null;
}

/** Chat call that must return JSON. Handles model choice per step, reasoning, images, budget and retries. */
export async function chatJson<T = any>(req: ChatRequest): Promise<ChatResult<T>> {
  const s = getAppSettings();
  const stepCfg = s.steps[req.step];
  const model: string = stepCfg.reasoning ? s.llm.reasoningModel : stepCfg.model;
  const noImages = kvGet<Record<string, boolean>>('modelsWithoutImages', {});
  let visionNote: string | undefined, visionModel: string | undefined;
  let images = req.images ?? [];
  const hadImages = images.length > 0;

  if (images.length) {
    const described = await describeFrames(images, req.signal).catch(e => {
      if (e instanceof Error && (e as any).code === 'BUDGET_EXCEEDED') throw e;
      log('warn', 'vision', `Vision helper failed: ${e.message}`); return null;
    });
    if (described) { visionNote = described.text; visionModel = described.model; images = []; }
  }
  const wantImages = images.length > 0 && (s.llm.imageMode === 'on' || (s.llm.imageMode === 'auto' && !noImages[model]));

  const build = (withImages: boolean) => {
    const userText = [req.user ?? 'Reply now with the JSON object only.', visionNote ? `\n\nFrame description from vision helper:\n${visionNote}` : '',
      !withImages && images.length ? '\n\n(Frames could not be shown to you; judge from the page text only.)' : ''].join('');
    const content = withImages ? [{ type: 'text', text: userText }, ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } }))] : userText;
    const body: any = { model, messages: [{ role: 'system', content: req.system }, { role: 'user', content }], max_tokens: stepCfg.maxTokens, stream: false };
    if (!stepCfg.reasoning) { body.temperature = stepCfg.temperature; body.response_format = { type: 'json_object' }; }
    return body;
  };

  const call = async (withImages: boolean) => {
    assertBudget();
    const data = await withRetries(() => post(s.llm.baseUrl, s.llm.apiKey, build(withImages), s.llm.timeoutSeconds, req.signal), s.llm.retries, req.signal);
    recordTokens('deepseek', model, req.step, data.usage);
    const text = String(data.choices?.[0]?.message?.content ?? '');
    return { text, json: extractJson(text) as T };
  };

  if (wantImages) {
    try { return { ...(await call(true)), model, usedImages: true, visionNote, mode: 'images' }; } catch (e) {
      if (s.llm.imageMode === 'auto' && looksLikeNoImageSupport(e)) {
        kvSet('modelsWithoutImages', { ...noImages, [model]: true });
        log('warn', 'llm', `Model ${model} does not accept images — switching to text-only decisions for it. Enable the vision helper in Settings for frame understanding.`);
      } else throw e;
    }
  }
  return { ...(await call(false)), model, usedImages: false, visionNote, visionModel, mode: visionNote ? 'vision' : hadImages ? 'text' : 'none' };
}

export async function listModels(): Promise<string[]> {
  const s = getAppSettings();
  if (!s.llm.apiKey) throw new Error('No API key set');
  const res = await fetch(`${s.llm.baseUrl.replace(/\/+$/, '')}/models`, { headers: { authorization: `Bearer ${s.llm.apiKey}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any = await res.json();
  return (data.data ?? []).map((m: any) => m.id).filter(Boolean);
}

export function resetImageCapability() { kvSet('modelsWithoutImages', {}); }
