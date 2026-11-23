import fs from 'node:fs';
import path from 'node:path';
import { TikTok, type Source, type SourceKind, type VideoInfo, type Inspection } from '../browser/tiktok.ts';
import { HungError } from '../browser/edge.ts';
import { getDb, nowIso } from '../db.ts';
import { log } from '../log.ts';
import { chatJson } from '../llm/client.ts';
import { BudgetExceeded } from '../llm/budget.ts';
import { getMemory, getAppSettings } from '../settings/store.ts';
import { getPrompt, render } from '../settings/prompts.ts';
import { paths } from '../paths.ts';
import { rand, sleep, zoned } from '../time.ts';
import { storyboard, type Frame } from './storyboard/index.ts';
import { interestsForPrompt, updateInterests } from './memory.ts';

export class GuardHit extends Error { kind: string; constructor(kind: string, detail: string) { super(detail); this.kind = kind; } }
export class SessionOver extends Error {}

/** What the session loop needs from the controller. */
export interface SessionHost {
  signal: AbortSignal;
  tiktok: TikTok;
  preset: { id: string; name: string; data: any };
  sessionId: number;
  /** Resolves when not paused; throws if stopped. */
  gate(): Promise<void>;
  /** Seconds of active (non-paused) time left. <= 0 ends the session. */
  remaining(): number;
  update(patch: Record<string, unknown>): void;
  /** Called on captcha/login. Resolves after the user clears it and presses Resume. */
  needsUser(kind: string, detail: string): Promise<void>;
  restartBrowser(reason: string): Promise<void>;
}

interface Counters { videos: number; watched: number; skipped: number; saved: number }

const isBrowserGone = (e: any) => e instanceof HungError || /Target (page, context or browser )?(has been )?closed|browser has been closed|Browser closed|Navigation failed because page crashed|crashed|ECONNREFUSED|Session closed|has been disconnected/i.test(String(e?.message));

function pickSource(watch: any): Source {
  const src = watch.sources;
  const lists: Record<SourceKind, string[]> = { foryou: [''], search: src.keywords, hashtag: src.hashtags, creator: src.creators };
  const options = (Object.keys(lists) as SourceKind[]).filter(k => (src.mix[k] ?? 0) > 0 && lists[k].length > 0);
  if (!options.length) return { kind: 'foryou' };
  const total = options.reduce((a, k) => a + src.mix[k], 0);
  let r = Math.random() * total;
  for (const k of options) { r -= src.mix[k]; if (r <= 0) { const l = lists[k]; return { kind: k, value: l[Math.floor(Math.random() * l.length)] || undefined }; } }
  return { kind: 'foryou' };
}
const sourceLabel = (s: Source) => s.kind === 'foryou' ? 'For You' : s.kind === 'search' ? `Search "${s.value}"` : s.kind === 'hashtag' ? `#${s.value}` : `@${s.value}`;

function prefilter(v: VideoInfo, watch: any): string | null {
  const f = watch.filters;
  if (f.skipLive && v.isLive) return 'live stream';
  if (f.skipAds && v.isAd) return 'ad / sponsored';
  if (v.duration && v.duration > 0 && v.duration < f.minLength) return `shorter than ${f.minLength}s`;
  if (v.duration && v.duration > f.maxLength) return `longer than ${f.maxLength}s`;
  const text = `${v.desc} ${v.hashtags.join(' ')} ${v.author}`.toLowerCase();
  const bad = f.excludeKeywords.find((k: string) => text.includes(k.toLowerCase()));
  if (bad) return `excluded keyword "${bad}"`;
  if (f.includeKeywords.length && !f.includeKeywords.some((k: string) => text.includes(k.toLowerCase()))) return 'no include keyword in caption';
  if (!watch.behaviour.rewatch && v.key && getDb().prepare("SELECT 1 FROM videos WHERE video_key = ? AND decision != 'filtered' LIMIT 1").get(v.key)) return 'already seen';
  return null;
}

const videoText = (v: VideoInfo, source: Source) => [
  `Source: ${sourceLabel(source)}`, `Creator: @${v.author || 'unknown'}`, `Caption: ${v.desc || '(none)'}`,
  `Hashtags: ${v.hashtags.map(h => '#' + h).join(' ') || '(none)'}`, `Sound: ${v.music || 'unknown'}`,
  `Length: ${v.duration ? Math.round(v.duration) + 's' : 'unknown'}`,
  `Stats: likes ${v.stats.likes || '?'}, comments ${v.stats.comments || '?'}, shares ${v.stats.shares || '?'}, saves ${v.stats.saves || '?'}`,
  `Page flags: ad=${v.isAd}, live=${v.isLive}`,
].join('\n');

export async function runSession(host: SessionHost): Promise<Counters> {
  const watch = host.preset.data.watch;
  const save = host.preset.data.save;
  const c: Counters = { videos: 0, watched: 0, skipped: 0, saved: 0 };
  const { signal, tiktok } = host;
  const delay = () => sleep(rand(watch.behaviour.delayMin, Math.max(watch.behaviour.delayMin, watch.behaviour.delayMax)) * 1000, signal);

  let source: Source | null = null, leftOnSource = 0, failures = 0, noProgress = 0;

  const checkGuard = async (ins: Inspection) => {
    if (ins.guard) {
      await tiktok.setPlaying(false);
      await host.needsUser(ins.guard.kind, ins.guard.detail);
      await tiktok.setPlaying(true);
      return true;
    }
    return false;
  };

  while (true) {
    await host.gate();
    if (host.remaining() <= 0) break;
    try {
      if (!source || leftOnSource <= 0) {
        source = pickSource(watch);
        leftOnSource = watch.sources.videosPerSource;
        host.update({ source: sourceLabel(source), thinking: `Opening ${sourceLabel(source)}…`, current: null });
        log('info', 'watch', `Opening ${sourceLabel(source)}`);
        const ins = await tiktok.open(source, signal);
        if (await checkGuard(ins)) continue;
      }
      const ins = await tiktok.waitForVideo(signal);
      if (await checkGuard(ins)) continue;
      if (!ins.video) {
        noProgress++;
        host.update({ thinking: 'No video found on the page, moving on…' });
        if (noProgress >= 3) { source = null; noProgress = 0; } else await tiktok.next(signal);
        continue;
      }
      noProgress = 0;
      await handleVideo(host, ins.video, source, c, delay, checkGuard);
      leftOnSource--;
      failures = 0;
      await host.gate();
      if (host.remaining() <= 0) break;
      host.update({ thinking: 'Scrolling to the next video…' });
      if (!(await tiktok.next(signal))) { log('warn', 'watch', 'Could not move to the next video — reopening source'); source = null; }
    } catch (e: any) {
      if (signal.aborted || e instanceof SessionOver) break;
      if (e instanceof BudgetExceeded) throw e;
      if (e instanceof GuardHit) continue;
      failures++;
      if (isBrowserGone(e)) {
        await host.restartBrowser(e.message);
        source = null;
        continue;
      }
      log('warn', 'watch', `Problem on this video: ${e.message}`);
      if (failures >= 5) throw new Error(`Too many errors in a row (last: ${e.message})`);
      source = failures >= 2 ? null : source;
      await sleep(3000, signal).catch(() => {});
    }
  }
  return c;
}

async function handleVideo(host: SessionHost, v: VideoInfo, source: Source, c: Counters, delay: () => Promise<void>,
  checkGuard: (i: Inspection) => Promise<boolean>) {
  const { tiktok, signal } = host;
  const watch = host.preset.data.watch, save = host.preset.data.save, b = watch.behaviour;
  const started = Date.now();
  c.videos++;
  const current: Record<string, any> = { key: v.key, url: v.url, author: v.author, desc: v.desc.slice(0, 300), duration: v.duration, phase: 'glancing' };
  host.update({ current, counts: { ...c } });

  const reason = prefilter(v, watch);
  if (reason) {
    c.skipped++;
    host.update({ thinking: `Skipped without AI: ${reason}`, current: { ...current, phase: 'skipping' }, counts: { ...c } });
    record(host, v, source, { decision: 'filtered', reason: `Filter: ${reason}`, watched: (Date.now() - started) / 1000 });
    await delay();
    return;
  }

  // ---- glance: sample a few frames ----
  const frames: Frame[] = [];
  const sample = async (count: number, seconds: number) => {
    const step = (seconds * 1000) / Math.max(1, count);
    for (let i = 0; i < count; i++) {
      await host.gate();
      await sleep(step, signal);
      const ins = await tiktok.inspect();
      if (await checkGuard(ins)) throw new GuardHit('guard', 'paused for user');
      if (!ins.video || ins.video.key !== v.key) return false; // video changed under us
      try { frames.push({ jpeg: await tiktok.frame(ins.video.rect), time: ins.video.currentTime }); } catch (e: any) { if (e instanceof HungError) throw e; }
      if (host.remaining() <= 0) return false;
    }
    return true;
  };
  await sample(Math.min(b.glanceFrames, b.framesPerVideo), b.glanceSeconds);

  const mem = getMemory();
  const sb = frames.length ? storyboard(frames) : null;
  host.update({ thinking: 'Deciding: watch or skip?', current: { ...current, phase: 'deciding' } });
  const decideVars = {
    persona: mem.persona, interests: interestsForPrompt(), instructions: watch.instructions, strictness: b.strictness,
    languages: watch.filters.languages.join(', ') || 'any', video: videoText(v, source),
    frames_note: sb ? `Frames: ${sb.note}` : 'No frames could be captured.',
  };
  const decided = await chatJson({
    step: 'watch', signal, system: render(getPrompt('watch_decide'), decideVars),
    images: sb ? [{ mime: 'image/jpeg', base64: sb.jpeg.toString('base64') }] : [],
  });
  const decision = decided.json ?? {};
  const frameInfo = { mode: decided.mode, visionModel: decided.visionModel, description: decided.visionNote, frames: frames.length };
  current.frames = frameInfo;
  const interest = Math.max(0, Math.min(100, Number(decision.interest) || 0));
  const threshold = b.strictness * 10;
  let action: 'watch' | 'skip' = decision.action === 'watch' && interest >= threshold - 10 ? 'watch' : 'skip';
  if ((watch.filters.skipAds && decision.is_ad === true) || (watch.filters.skipLive && decision.is_live === true)) action = 'skip';
  host.update({ thinking: `${action === 'watch' ? '👀 Watching' : '⏭ Skipping'} (interest ${interest}): ${decision.reason ?? ''}`, current: { ...current, phase: action === 'watch' ? 'watching' : 'skipping' } });

  if (action === 'skip') {
    c.skipped++;
    updateInterests(decision.topics, (Date.now() - started) / 1000 / Math.max(1, v.duration ?? 30), 'skip');
    record(host, v, source, { decision: 'skip', interest, reason: decision.reason, watched: (Date.now() - started) / 1000, data: { decide: decision, frames: frameInfo } });
    host.update({ counts: { ...c } });
    await delay();
    return;
  }

  // ---- watch longer, sampling the remaining frames ----
  c.watched++;
  const cap = Math.min(b.maxSecondsPerVideo, v.duration && v.duration > 0 ? v.duration : b.maxSecondsPerVideo);
  const target = Math.max(b.glanceSeconds + 2, cap * (0.4 + 0.6 * interest / 100));
  const remainingSeconds = Math.max(1, target - (Date.now() - started) / 1000);
  const moreFrames = Math.max(0, b.framesPerVideo - frames.length);
  if (moreFrames > 0) await sample(moreFrames, remainingSeconds);
  else await sleep(remainingSeconds * 1000, signal);
  const watched = (Date.now() - started) / 1000;
  const ratio = watched / Math.max(1, v.duration ?? cap);

  let analysis: any = null;
  if (b.analyzeWatched) {
    host.update({ thinking: 'Second look: what is worth saving?', current: { ...current, phase: 'analyzing' } });
    const sb2 = frames.length ? storyboard(frames) : null;
    const analyzed = await chatJson({
      step: 'analyze', signal,
      system: render(getPrompt('watch_analyze'), {
        persona: mem.persona, instructions: watch.instructions, fields: save.fields.join(', '), video: videoText(v, source),
        first_decision: `${decision.reason ?? ''} (interest ${interest})`, frames_note: sb2 ? `Frames: ${sb2.note}` : 'No frames captured.',
      }),
      images: sb2 ? [{ mime: 'image/jpeg', base64: sb2.jpeg.toString('base64') }] : [],
    });
    analysis = analyzed.json ?? {};
    Object.assign(frameInfo, { mode: analyzed.mode, visionModel: analyzed.visionModel ?? frameInfo.visionModel, description: analyzed.visionNote ?? frameInfo.description, frames: frames.length });
  }
  const score = analysis ? Math.max(0, Math.min(100, Number(analysis.score) || 0)) : interest;
  const doSave = score >= save.saveThreshold && (analysis ? analysis.save !== false : true);
  if (doSave) c.saved++;
  updateInterests(analysis?.topics ?? decision.topics, ratio, 'watch');
  const rowId = record(host, v, source, { decision: 'watch', interest, score, reason: analysis?.reason ?? decision.reason, watched, saved: doSave, data: { decide: decision, analysis, frames: frameInfo } });
  if (doSave && frames.length) {
    try { fs.writeFileSync(path.join(paths.media, `video-${rowId}.jpg`), storyboard(frames).jpeg); } catch { /* not critical */ }
  }
  host.update({ counts: { ...c }, thinking: doSave ? `💾 Saved (score ${score}): ${analysis?.topic ?? decision.reason ?? ''}` : `Watched, not saved (score ${score})` });
  await delay();
}

function record(host: SessionHost, v: VideoInfo, source: Source, r: { decision: string; interest?: number; score?: number; reason?: string; watched: number; saved?: boolean; data?: any }) {
  const fields: string[] = host.preset.data.save.fields;
  const a = r.data?.analysis ?? {};
  const saved: Record<string, unknown> = {};
  const pick: Record<string, () => unknown> = {
    link: () => v.url, author: () => v.author, caption: () => v.desc, hashtags: () => v.hashtags, topic: () => a.topic,
    hook: () => a.hook, format: () => a.format, reason: () => r.reason, audio: () => a.audio || v.music, stats: () => v.stats, summary: () => a.summary,
  };
  for (const f of fields) if (pick[f]) saved[f] = pick[f]();
  const z = zoned();
  const res = getDb().prepare(`INSERT INTO videos (session_id, day, at, video_key, url, author, caption, source, decision, interest, score, reason, watched_seconds, duration, saved, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    host.sessionId, z.day, nowIso(), v.key, v.url, v.author, v.desc.slice(0, 2200), sourceLabel(source), r.decision,
    r.interest ?? null, r.score ?? null, (r.reason ?? '').slice(0, 1000), Math.round(r.watched * 10) / 10, v.duration, r.saved ? 1 : 0,
    JSON.stringify({ fields: saved, ...r.data }));
  return Number(res.lastInsertRowid);
}
