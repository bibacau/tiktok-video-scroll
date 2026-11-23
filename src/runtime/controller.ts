import { EventEmitter } from 'node:events';
import { BrowserManager } from '../browser/edge.ts';
import { TikTok } from '../browser/tiktok.ts';
import { getDb, nowIso } from '../db.ts';
import { log } from '../log.ts';
import { BudgetExceeded, logBudgetStop, spentRM } from '../llm/budget.ts';
import { getAppSettings, getDayPresets, getPreset } from '../settings/store.ts';
import { hhmmToMin, zoned, sleep } from '../time.ts';
import { runSession, SessionOver, type SessionHost } from '../watch/session.ts';
import { generatePicks } from '../watch/picks.ts';
import { creator } from '../create/pipeline.ts';
import { savePlan, todaysPlan, watchedSecondsToday, type PlanEntry } from '../schedule/planner.ts';

export type State = 'idle' | 'starting' | 'running' | 'paused' | 'needs_user' | 'stopping';

export interface Status {
  state: State; trigger: 'manual' | 'schedule' | null; sessionId: number | null;
  presetId: string | null; presetName: string | null;
  startedAt: string | null; plannedSeconds: number; activeSeconds: number; endsAt: string | null;
  source: string | null; current: any; thinking: string; counts: { videos: number; watched: number; skipped: number; saved: number };
  alert: { kind: string; message: string; at: string; profile?: string } | null;
  browserOpen: boolean; restarts: number;
}

const blank = (): Status => ({
  state: 'idle', trigger: null, sessionId: null, presetId: null, presetName: null, startedAt: null, plannedSeconds: 0, activeSeconds: 0, endsAt: null,
  source: null, current: null, thinking: '', counts: { videos: 0, watched: 0, skipped: 0, saved: 0 }, alert: null, browserOpen: false, restarts: 0,
});

class Controller extends EventEmitter {
  status: Status = blank();
  browser = new BrowserManager();
  tiktok = new TikTok(this.browser);
  private abort: AbortController | null = null;
  private pauseWaiters: Array<() => void> = [];
  private activeMs = 0; private activeSince: number | null = null;
  private hardEnd: number | null = null; // scheduled sessions end at the window/plan end
  private planEntry: PlanEntry | null = null;
  private screenshotTimer: NodeJS.Timeout | null = null;
  private schedTimer: NodeJS.Timeout | null = null;
  viewers = 0;
  lastScreenshot: { at: string; base64: string } | null = null;

  private set(patch: Partial<Status>) {
    Object.assign(this.status, patch);
    this.status.browserOpen = this.browser.isOpen();
    this.status.activeSeconds = Math.round(this.active() / 1000);
    this.status.restarts = this.browser.restarts;
    this.emit('status', this.status);
  }
  private active() { return this.activeMs + (this.activeSince ? Date.now() - this.activeSince : 0); }
  snapshot() { this.set({}); return { ...this.status, browserProfile: this.browser.profile(), today: { watchedSeconds: watchedSecondsToday(), spentRM: spentRM('day') } }; }

  // --------------------------------------------------------------- commands
  async start(opts: { minutes?: number; presetId?: string; trigger?: 'manual' | 'schedule'; until?: number; entry?: PlanEntry } = {}) {
    if (this.status.state !== 'idle') throw Object.assign(new Error(`Already ${this.status.state}`), { statusCode: 409 });
    const z = zoned();
    const preset = getPreset(opts.presetId ?? getDayPresets()[z.weekday]);
    if (!preset) throw Object.assign(new Error('Preset not found'), { statusCode: 404 });
    const minutes = opts.minutes ?? preset.data.schedule.manualMinutes;
    const trigger = opts.trigger ?? 'manual';
    const r = getDb().prepare(`INSERT INTO sessions (preset_id, preset_name, day, trigger, started_at, planned_seconds, status) VALUES (?, ?, ?, ?, ?, ?, 'running')`)
      .run(preset.id, preset.name, z.day, trigger, nowIso(), Math.round(minutes * 60));
    const sessionId = Number(r.lastInsertRowid);
    this.abort = new AbortController();
    this.activeMs = 0; this.activeSince = Date.now(); this.hardEnd = opts.until ?? null; this.planEntry = opts.entry ?? null;
    this.browser.restarts = 0;
    this.status = { ...blank(), state: 'starting', trigger, sessionId, presetId: preset.id, presetName: preset.name, startedAt: nowIso(), plannedSeconds: Math.round(minutes * 60), thinking: 'Opening the browser…' };
    this.set({ endsAt: new Date(Date.now() + minutes * 60_000).toISOString() });
    log('info', 'session', `Session #${sessionId} started (${trigger}, ${minutes} min, preset "${preset.name}")`);
    this.startScreenshots();
    void this.run(sessionId, preset, minutes * 60_000);
    return this.snapshot();
  }

  private async run(sessionId: number, preset: any, plannedMs: number) {
    const signal = this.abort!.signal;
    let status = 'done', note: string | null = null;
    let counts = this.status.counts;
    const host: SessionHost = {
      signal, tiktok: this.tiktok, preset, sessionId,
      gate: () => this.gate(),
      remaining: () => {
        const left = (plannedMs - this.active()) / 1000;
        return this.hardEnd ? Math.min(left, (this.hardEnd - Date.now()) / 1000) : left;
      },
      update: patch => this.set(patch as Partial<Status>),
      needsUser: (kind, detail) => this.needsUser(kind, detail),
      restartBrowser: async reason => {
        const max = getAppSettings().browser.maxRestarts;
        if (this.browser.restarts >= max) throw new Error(`Browser keeps failing (${this.browser.restarts} restarts): ${reason}`);
        this.set({ thinking: `Browser problem — restarting (${reason})` });
        await this.browser.restart(reason);
      },
    };
    try {
      await this.browser.ensure();
      this.set({ state: 'running', thinking: 'Starting…' });
      counts = await runSession(host);
      if (signal.aborted) status = 'stopped';
    } catch (e: any) {
      if (signal.aborted || e instanceof SessionOver) status = 'stopped';
      else if (e?.code === 'PROFILE_IN_USE') { status = 'blocked'; note = e.message; log('alert', 'browser', e.message); this.set({ alert: { kind: 'profile_busy', message: e.message, at: nowIso(), profile: e.profile } }); }
      else if (e instanceof BudgetExceeded) { status = 'budget'; note = e.message; logBudgetStop(e); this.set({ alert: { kind: 'budget', message: e.message, at: nowIso() } }); }
      else { status = 'error'; note = e.message; log('error', 'session', `Session #${sessionId} failed: ${e.message}`); this.set({ alert: { kind: 'error', message: e.message, at: nowIso() } }); }
    }
    counts = this.status.counts;
    if (this.activeSince) { this.activeMs += Date.now() - this.activeSince; this.activeSince = null; }
    getDb().prepare('UPDATE sessions SET ended_at = ?, watched_seconds = ?, videos = ?, saved = ?, status = ?, note = ? WHERE id = ?')
      .run(nowIso(), Math.round(this.activeMs / 1000), counts.videos, counts.saved, status, note, sessionId);
    log('info', 'session', `Session #${sessionId} ended: ${status} — ${counts.videos} videos, ${counts.watched} watched, ${counts.saved} saved`);
    await this.tiktok.setPlaying(false);
    if (this.planEntry) { const plan = todaysPlan(); const e = plan.entries.find(x => x.sessionId === sessionId); if (e) { e.status = status === 'done' ? 'done' : 'stopped'; savePlan(plan); } }
    const alert = this.status.alert;
    this.status = { ...blank(), alert, thinking: `Last session: ${counts.videos} videos, ${counts.saved} saved` };
    this.abort = null; this.planEntry = null;
    this.set({});
    this.afterSession(preset).catch(e => log('warn', 'picks', `Could not build picks: ${e.message}`));
  }

  private async afterSession(preset: any) {
    if (!preset.data.save.autoPicks) return;
    const plan = todaysPlan();
    const more = plan.enabled && plan.entries.some(e => e.status === 'pending');
    if (!more) {
      await generatePicks(zoned().day, preset);
      creator.autoCreate(preset);
    }
  }

  pause() {
    if (!['running', 'starting'].includes(this.status.state)) throw Object.assign(new Error('Nothing to pause'), { statusCode: 409 });
    if (this.activeSince) { this.activeMs += Date.now() - this.activeSince; this.activeSince = null; }
    this.set({ state: 'paused', thinking: 'Paused' });
    void this.tiktok.setPlaying(false);
    log('info', 'session', 'Paused');
    return this.snapshot();
  }

  resume() {
    if (!['paused', 'needs_user'].includes(this.status.state)) throw Object.assign(new Error('Not paused'), { statusCode: 409 });
    this.activeSince = Date.now();
    this.set({ state: 'running', alert: null, thinking: 'Resuming…' });
    void this.tiktok.setPlaying(true);
    const w = this.pauseWaiters; this.pauseWaiters = [];
    w.forEach(fn => fn());
    log('info', 'session', 'Resumed');
    return this.snapshot();
  }

  stop() {
    if (this.status.state === 'idle') return this.snapshot();
    this.set({ state: 'stopping', thinking: 'Stopping…' });
    this.abort?.abort(new SessionOver('stopped'));
    const w = this.pauseWaiters; this.pauseWaiters = []; w.forEach(fn => fn());
    return this.snapshot();
  }

  private async gate() {
    const signal = this.abort?.signal;
    if (signal?.aborted) throw new SessionOver('stopped');
    const max = getAppSettings().browser.maxRestarts;
    if (this.browser.restarts > max) throw new Error(`Browser crashed or hung too often (${this.browser.restarts} restarts, limit ${max})`);
    if (this.status.restarts !== this.browser.restarts) this.set({});
    while (this.status.state === 'paused' || this.status.state === 'needs_user') {
      await new Promise<void>(r => this.pauseWaiters.push(r));
      if (signal?.aborted) throw new SessionOver('stopped');
    }
  }

  /** Fixed safety rule: captcha / login / verification → pause and alert. Never solve or bypass. */
  private async needsUser(kind: string, detail: string) {
    if (this.activeSince) { this.activeMs += Date.now() - this.activeSince; this.activeSince = null; }
    const message = `${detail}. Please handle it yourself in the browser window, then press Resume.`;
    this.set({ state: 'needs_user', alert: { kind, message, at: nowIso() }, thinking: `Waiting for you: ${detail}` });
    log('alert', 'guard', message);
    this.emit('alert', { kind, message });
    // Wait for Resume; if the screen is still there, keep waiting.
    while (true) {
      await this.gate();
      const ins = await this.tiktok.inspect().catch(() => null);
      if (!ins?.guard) return;
      if (this.activeSince) { this.activeMs += Date.now() - this.activeSince; this.activeSince = null; }
      this.set({ state: 'needs_user', alert: { kind, message: `Still showing: ${ins.guard.detail}. Handle it in the browser, then press Resume.`, at: nowIso() } });
    }
  }

  async openBrowser(url?: string) {
    let page;
    try { page = await this.browser.ensure(); } catch (e: any) {
      if (e?.code === 'PROFILE_IN_USE') this.set({ alert: { kind: 'profile_busy', message: e.message, at: nowIso(), profile: e.profile } });
      throw e;
    }
    if (url) await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    else if (page.url() === 'about:blank') await page.goto(getAppSettings().browser.baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    this.set({});
  }
  async closeBrowser() {
    if (this.status.state !== 'idle') throw Object.assign(new Error('Stop the session first'), { statusCode: 409 });
    await this.browser.close();
    this.set({});
  }
  dismissAlert() { this.set({ alert: null }); }

  // ------------------------------------------------------- live screenshots
  /** Live view: only while a session is active AND someone is looking. Never while idle. */
  private startScreenshots() {
    if (this.screenshotTimer) return;
    const tick = async () => {
      const active = ['running', 'starting', 'paused', 'needs_user'].includes(this.status.state);
      if (!active) { this.screenshotTimer = null; return; }
      if (this.viewers > 0 && this.browser.isOpen()) await this.snapshotNow();
      this.screenshotTimer = setTimeout(tick, getAppSettings().browser.screenshotSeconds * 1000);
    };
    this.screenshotTimer = setTimeout(tick, 1000);
  }

  /** One screenshot on request (also used by the live view). */
  async snapshotNow() {
    const shot = await this.browser.screenshot();
    if (shot) { this.lastScreenshot = { at: nowIso(), base64: shot.toString('base64') }; this.emit('screenshot', this.lastScreenshot); }
    return this.lastScreenshot;
  }

  // ------------------------------------------------------------- scheduler
  startScheduler() {
    const tick = async () => {
      try { await this.schedulerTick(); } catch (e: any) { log('warn', 'scheduler', e.message); }
      this.schedTimer = setTimeout(tick, 15_000);
    };
    this.schedTimer = setTimeout(tick, 3000);
  }
  private async schedulerTick() {
    const plan = todaysPlan();
    const z = zoned();
    let changed = false;
    for (const e of plan.entries) if (e.status === 'pending' && hhmmToMin(e.end) <= z.minutes) { e.status = 'missed'; changed = true; }
    if (changed) savePlan(plan);
    if (!plan.enabled || this.status.state !== 'idle') return;
    const entry = plan.entries.find(e => e.status === 'pending' && hhmmToMin(e.start) <= z.minutes && z.minutes < hhmmToMin(e.end));
    if (!entry) return;
    const preset = getPreset(plan.presetId);
    if (!preset) return;
    const leftToday = preset.data.schedule.dailyMinutes * 60 - watchedSecondsToday();
    if (leftToday < 60) { entry.status = 'missed'; savePlan(plan); log('info', 'scheduler', 'Daily watch time already used up'); return; }
    const until = Date.now() + (hhmmToMin(entry.end) - z.minutes) * 60_000 - z.seconds * 1000;
    const minutes = Math.min(entry.minutes, leftToday / 60, (until - Date.now()) / 60_000);
    entry.status = 'running';
    const snap = await this.start({ minutes, presetId: preset.id, trigger: 'schedule', until, entry });
    entry.sessionId = snap.sessionId ?? undefined;
    savePlan(plan);
  }

  async shutdown() {
    if (this.schedTimer) clearTimeout(this.schedTimer);
    this.stop();
    for (let i = 0; i < 20 && this.status.state !== 'idle'; i++) await sleep(250);
    await this.browser.close();
  }
}

export const controller = new Controller();
