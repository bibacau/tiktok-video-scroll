import { createHash } from 'node:crypto';
import { getDb } from '../db.js';
import { getDayPresets, getPreset } from '../settings/store.js';
import { hhmmToMin, minToHhmm, rand, zoned } from '../time.js';

export interface PlanEntry { start: string; end: string; minutes: number; status: 'pending' | 'running' | 'done' | 'missed' | 'stopped'; sessionId?: number }
export interface DayPlan { day: string; presetId: string; presetName: string; enabled: boolean; requestedMinutes: number; plannedMinutes: number; entries: PlanEntry[]; warnings: string[] }

/** Lay out the day's sessions inside the allowed windows, with breaks and optional jitter. */
export function buildPlan(day: string, weekday: string, preset: { id: string; name: string; data: any }, fromMinute = 0): DayPlan {
  const sc = preset.data.schedule;
  const windows = (sc.windows[weekday] ?? []).map((w: any) => ({ s: hhmmToMin(w.start), e: hhmmToMin(w.end) }))
    .filter((w: any) => w.e > fromMinute).map((w: any) => ({ s: Math.max(w.s, fromMinute), e: w.e })).sort((a: any, b: any) => a.s - b.s);
  const warnings: string[] = [];
  const entries: PlanEntry[] = [];
  const len = sc.dailyMinutes / sc.sessions;
  const j = sc.jitter ? sc.jitterMinutes : 0;
  let wi = 0, cursor = windows[0] ? windows[0].s + rand(0, j) : 0;
  for (let i = 0; i < sc.sessions && wi < windows.length; i++) {
    const thisLen = Math.max(1, len + (j ? rand(-j / 3, j / 3) : 0));
    while (wi < windows.length) {
      const w = windows[wi];
      if (cursor < w.s) cursor = w.s;
      if (cursor + Math.min(thisLen, 3) <= w.e) break;
      wi++;
    }
    if (wi >= windows.length) break;
    const w = windows[wi];
    const end = Math.min(w.e, cursor + thisLen);
    entries.push({ start: minToHhmm(cursor), end: minToHhmm(end), minutes: Math.round(end - cursor), status: 'pending' });
    cursor = end + Math.max(0, sc.breakMinutes + (j ? rand(-j, j) : 0));
  }
  const planned = entries.reduce((a, e) => a + e.minutes, 0);
  if (!windows.length) warnings.push('No allowed time window left today.');
  else if (planned < sc.dailyMinutes - 2) warnings.push(`Only ${planned} of ${sc.dailyMinutes} minutes fit in today's windows (with breaks).`);
  if (sc.dailyMinutes > 240) warnings.push('More than 4 hours a day raises the risk of TikTok restricting the account.');
  return { day, presetId: preset.id, presetName: preset.name, enabled: sc.enabled, requestedMinutes: sc.dailyMinutes, plannedMinutes: planned, entries, warnings };
}

const signature = (preset: { id: string; data: any }) => createHash('sha1').update(preset.id + JSON.stringify(preset.data.schedule)).digest('hex');

/** Today's plan, rebuilt when the preset or its schedule changed (past sessions are kept). */
export function todaysPlan(): DayPlan {
  const z = zoned();
  const preset = getPreset(getDayPresets()[z.weekday])!;
  const sig = signature(preset);
  const db = getDb();
  const row = db.prepare('SELECT * FROM day_plans WHERE day = ?').get(z.day) as any;
  if (row && row.signature === sig) {
    const plan = JSON.parse(row.plan) as DayPlan;
    plan.enabled = preset.data.schedule.enabled;
    return plan;
  }
  const old: DayPlan | null = row ? JSON.parse(row.plan) : null;
  const kept = (old?.entries ?? []).filter(e => e.status !== 'pending');
  const doneMinutes = kept.reduce((a, e) => a + (e.status === 'done' || e.status === 'stopped' ? e.minutes : 0), 0);
  const plan = buildPlan(z.day, z.weekday, { ...preset, data: { ...preset.data, schedule: { ...preset.data.schedule, dailyMinutes: Math.max(1, preset.data.schedule.dailyMinutes - doneMinutes), sessions: Math.max(1, preset.data.schedule.sessions - kept.length) } } }, z.minutes + 1);
  if (kept.length && doneMinutes >= preset.data.schedule.dailyMinutes) plan.entries = [];
  plan.entries = [...kept, ...plan.entries];
  plan.requestedMinutes = preset.data.schedule.dailyMinutes;
  plan.plannedMinutes = plan.entries.reduce((a, e) => a + e.minutes, 0);
  savePlan(plan, sig);
  return plan;
}

export function savePlan(plan: DayPlan, sig?: string) {
  const db = getDb();
  const s = sig ?? (db.prepare('SELECT signature FROM day_plans WHERE day = ?').get(plan.day) as any)?.signature ?? '';
  db.prepare('INSERT INTO day_plans (day, preset_id, signature, plan) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET preset_id = excluded.preset_id, signature = excluded.signature, plan = excluded.plan')
    .run(plan.day, plan.presetId, s, JSON.stringify(plan));
}

export function regeneratePlan() {
  getDb().prepare('UPDATE day_plans SET signature = ? WHERE day = ?').run('force', zoned().day);
  return todaysPlan();
}

export function watchedSecondsToday() {
  return (getDb().prepare('SELECT COALESCE(SUM(watched_seconds), 0) s FROM sessions WHERE day = ?').get(zoned().day) as any).s as number;
}
