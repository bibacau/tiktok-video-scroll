// Video creation jobs: plan → script → voice → visuals → render. Any step can be re-run on its own.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { getDb, nowIso } from '../db.ts';
import { paths } from '../paths.ts';
import { log } from '../log.ts';
import { getPreset, getDayPresets, listPresets } from '../settings/store.ts';
import { usageContext, costForRef } from '../llm/budget.ts';
import { zoned } from '../time.ts';
import { planIdeas, writeScript, finalizeCaption, type Idea, type Script } from './script.ts';
import { ttsProviders, type Speech } from './tts.ts';
import { sceneVisual, type Visual } from './visuals.ts';
import { renderVideo } from './render.ts';

export type Step = 'script' | 'voice' | 'visuals' | 'render';
const STEPS: Step[] = ['script', 'voice', 'visuals', 'render'];
interface SceneAsset { voice: Speech | null; voiceKey: string | null; visual: Visual | null }
interface Assets { scenes: SceneAsset[]; credits: string[]; durations?: number[] }

export function rowToCreation(r: any) {
  if (!r) return null;
  const j = (s: string | null, d: any) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
  const ver = encodeURIComponent(r.updated_at);
  return {
    ...r, idea: j(r.idea, null), script: j(r.script, null), assets: j(r.assets, { scenes: [], credits: [] }), hashtags: j(r.hashtags, []),
    video_url: r.video_path ? `/renders/${r.id}/final.mp4?v=${ver}` : null, thumb_url: r.thumb_path ? `/renders/${r.id}/thumb.jpg?v=${ver}` : null,
    cost_rm: costForRef(`creation:${r.id}`),
  };
}
export const getCreation = (id: number) => rowToCreation(getDb().prepare('SELECT * FROM creations WHERE id = ?').get(id));
export const listCreations = (limit = 50) => (getDb().prepare('SELECT * FROM creations ORDER BY id DESC LIMIT ?').all(limit) as any[]).map(rowToCreation);
const dirFor = (id: number) => path.join(paths.renders, String(id));

class Creator extends EventEmitter {
  private queue: Array<{ label: string; run: () => Promise<void> }> = [];
  private busy = false;
  current: string | null = null;

  private update(id: number, patch: Record<string, unknown>) {
    const keys = Object.keys(patch);
    const vals = keys.map(k => { const v = patch[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v as any; });
    getDb().prepare(`UPDATE creations SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, nowIso(), id);
    this.emit('update', getCreation(id));
  }

  private enqueue(label: string, run: () => Promise<void>) {
    this.queue.push({ label, run });
    void this.pump();
  }
  private async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const job = this.queue.shift()!;
      this.current = job.label; this.emit('queue', this.state());
      try { await job.run(); } catch (e: any) { log('error', 'create', `${job.label}: ${e.message}`); }
    }
    this.current = null; this.busy = false; this.emit('queue', this.state());
  }
  state() { return { current: this.current, queued: this.queue.map(q => q.label) }; }

  /** Plan `count` ideas and build a video for each. */
  createVideos(opts: { presetId?: string; count?: number; topic?: string }) {
    const z = zoned();
    const preset = getPreset(opts.presetId || getDayPresets()[z.weekday]) ?? listPresets()[0];
    const create = preset.data.create;
    const count = Math.max(1, Math.min(20, opts.count ?? 1));
    const at = nowIso();
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      const r = getDb().prepare(`INSERT INTO creations (day, preset_id, status, stage, title, created_at, updated_at) VALUES (?, ?, 'queued', 'Waiting to plan', ?, ?, ?)`)
        .run(z.day, preset.id, opts.topic ? opts.topic.slice(0, 120) : 'New video', at, at);
      ids.push(Number(r.lastInsertRowid));
    }
    ids.forEach(id => this.emit('update', getCreation(id)));
    this.enqueue(`Plan ${count} video(s)`, async () => {
      ids.forEach(id => this.update(id, { status: 'planning', stage: 'Planning ideas…' }));
      let ideas: Idea[];
      try { ideas = await usageContext.run({ ref: `creation:${ids[0]}` }, () => planIdeas(z.day, create, count, opts.topic)); } catch (e: any) {
        ids.forEach(id => this.update(id, { status: 'failed', stage: 'Planning failed', error: e.message }));
        throw e;
      }
      ids.forEach((id, i) => {
        const idea = ideas[i] ?? ideas[i % ideas.length];
        this.update(id, { idea, title: idea.title, status: 'queued', stage: 'Waiting to write the script' });
        this.enqueue(`Build #${id}`, () => this.build(id, 'script'));
      });
    });
    log('info', 'create', `Queued ${count} new video(s) with preset "${preset.name}"`);
    return ids.map(getCreation);
  }

  /** Re-run from a step (script / voice / visuals / render). */
  rebuild(id: number, from: Step) {
    const c = getCreation(id);
    if (!c) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    if (from === 'script' && !c.idea) throw Object.assign(new Error('This video has no idea yet'), { statusCode: 400 });
    if (from !== 'script' && !c.script) throw Object.assign(new Error('Write the script first'), { statusCode: 400 });
    this.update(id, { status: 'queued', stage: `Waiting to redo ${from}`, error: null });
    this.enqueue(`Redo ${from} #${id}`, () => this.build(id, from));
    return getCreation(id);
  }

  /** User edited the script in the dashboard. */
  saveScript(id: number, script: Script) {
    const c = getCreation(id);
    if (!c) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    const preset = getPreset(c.preset_id) ?? listPresets()[0];
    const clean: Script = {
      title: String(script.title ?? c.script?.title ?? '').slice(0, 120), hook: String(script.hook ?? ''),
      scenes: (script.scenes ?? []).map(s => ({ voiceover: String(s.voiceover ?? ''), on_screen: String(s.on_screen ?? ''), keywords: String(s.keywords ?? ''), image_prompt: String(s.image_prompt ?? '') })).filter(s => s.voiceover || s.on_screen),
      caption: String(script.caption ?? ''), hashtags: Array.isArray(script.hashtags) ? script.hashtags.map(String) : [],
    };
    const cap = finalizeCaption(clean, preset.data.create.caption);
    this.update(id, { script: clean, title: clean.title, caption: cap.caption, hashtags: cap.hashtags, stage: 'Script edited — press Re-render to apply' });
    return getCreation(id);
  }

  delete(id: number) {
    getDb().prepare('DELETE FROM creations WHERE id = ?').run(id);
    fs.rmSync(dirFor(id), { recursive: true, force: true });
    this.emit('deleted', id);
  }

  private async build(id: number, from: Step) {
    await usageContext.run({ ref: `creation:${id}` }, async () => {
      const c = getCreation(id);
      if (!c) return;
      const preset = getPreset(c.preset_id) ?? listPresets()[0];
      const create = preset.data.create;
      const dir = dirFor(id); fs.mkdirSync(dir, { recursive: true });
      const todo = STEPS.slice(STEPS.indexOf(from));
      let script: Script = c.script;
      const assets: Assets = c.assets?.scenes ? c.assets : { scenes: [], credits: [] };
      try {
        if (todo.includes('script')) {
          this.update(id, { status: 'scripting', stage: 'Writing the script…' });
          script = await writeScript(c.idea, create, c.day);
          const cap = finalizeCaption(script, create.caption);
          assets.scenes = [];
          this.update(id, { script, title: script.title, caption: cap.caption, hashtags: cap.hashtags, assets });
        }
        // voices: redo when asked, or for scenes whose text/voice settings changed
        const vs = create.voice;
        const provider = vs.provider === 'none' ? null : ttsProviders[vs.provider];
        if (vs.provider !== 'none' && !provider) throw new Error(`Unknown voice provider ${vs.provider}`);
        this.update(id, { status: 'voicing', stage: provider ? 'Recording the voice…' : 'No voice (text only)' });
        for (let i = 0; i < script.scenes.length; i++) {
          const s = script.scenes[i];
          const key = provider ? JSON.stringify([vs.provider, vs.voice, vs.rate, vs.pitch, vs.volume, s.voiceover]) : null;
          const cur = assets.scenes[i] ?? { voice: null, voiceKey: null, visual: null };
          const stale = from === 'script' || from === 'voice' || cur.voiceKey !== key || (cur.voice && !fs.existsSync(cur.voice.file));
          if (stale) {
            if (provider && s.voiceover.trim()) {
              this.update(id, { stage: `Recording the voice (${i + 1}/${script.scenes.length})…` });
              cur.voice = await provider.synth(s.voiceover, vs, path.join(dir, `voice-${i}-${Date.now() % 100000}`));
            } else cur.voice = null;
            cur.voiceKey = key;
          }
          assets.scenes[i] = cur;
        }
        assets.scenes.length = script.scenes.length;
        // visuals: redo when asked, or fetch missing ones
        this.update(id, { status: 'visuals', stage: 'Getting visuals…', assets });
        for (let i = 0; i < script.scenes.length; i++) {
          const cur = assets.scenes[i];
          if (from === 'script' || from === 'visuals' || !cur.visual || (cur.visual.file && !fs.existsSync(cur.visual.file))) {
            this.update(id, { stage: `Getting visuals (${i + 1}/${script.scenes.length})…` });
            cur.visual = await sceneVisual(script.scenes[i], i, create, cur.voice?.duration ?? create.script.sceneSeconds);
          }
        }
        assets.credits = [...new Set(assets.scenes.map(s => s.visual?.credit).filter(Boolean) as string[])];
        this.update(id, { status: 'rendering', stage: 'Rendering the video…', assets });
        const out = await renderVideo(script.scenes, assets.scenes.map(s => ({ voice: s.voice, visual: s.visual! })), create, dir);
        assets.durations = out.durations;
        this.update(id, { status: 'ready', stage: 'Ready for review', video_path: out.file, thumb_path: out.thumb, duration: out.duration, assets, error: null });
        log('info', 'create', `Video #${id} "${script.title}" is ready (${out.duration.toFixed(1)}s)`);
      } catch (e: any) {
        this.update(id, { status: 'failed', stage: 'Failed', error: e.message, assets });
        throw e;
      }
    });
  }

  /** Called after today's picks: make the day's videos if auto-create is on. */
  autoCreate(preset: { id: string; data: any }) {
    const b = preset.data.create.basics;
    if (!b.autoCreate) return;
    const day = zoned().day;
    const made = (getDb().prepare('SELECT COUNT(*) n FROM creations WHERE day = ? AND preset_id = ?').get(day, preset.id) as any).n;
    const left = b.videosPerDay - made;
    if (left > 0) this.createVideos({ presetId: preset.id, count: left });
  }
}

export const creator = new Creator();
