import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getDb, kvGet, kvSet, nowIso } from '../db.js';
import { paths } from '../paths.js';
import { registerSecret } from '../log.js';
import { coerce, defaults, getPath, secretPaths, setPath, warnings, DAYS, type Day } from './dsl.js';
import { appSchema, presetSchema } from './schema.js';
import { listPrompts, setPrompt } from './prompts.js';

export interface Preset { id: string; name: string; data: any; created_at: string; updated_at: string }

// ---------------- secrets (data/secrets.json, never in DB, never exported) ----------------
function readSecrets(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(paths.secrets, 'utf8')); } catch { return {}; }
}
function writeSecrets(v: Record<string, string>) {
  const tmp = `${paths.secrets}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, paths.secrets);
}
export function loadSecretsIntoRedactor() { for (const v of Object.values(readSecrets())) registerSecret(v); }

const SECRET_PATHS = secretPaths(appSchema);
const mask = (v: string) => v ? { set: true, hint: v.length > 8 ? `${v.slice(0, 3)}…${v.slice(-4)}` : '••••' } : { set: false, hint: '' };

// ---------------- app settings ----------------
/** Full settings including secret values — server-side use only. */
export function getAppSettings(): any {
  const value = coerce(appSchema, kvGet('app', {}));
  const secrets = readSecrets();
  for (const p of SECRET_PATHS) setPath(value, p, secrets[p] ?? '');
  return value;
}
/** Settings safe to send to the browser: secrets replaced by {set, hint}. */
export function getAppSettingsPublic(): any {
  const value = getAppSettings();
  for (const p of SECRET_PATHS) setPath(value, p, mask(getPath(value, p) ?? ''));
  return value;
}
export function saveAppSettings(input: any) {
  const secrets = readSecrets();
  for (const p of SECRET_PATHS) {
    const incoming = getPath(input, p);
    // string = new value ('' clears); object {set,hint} or undefined = keep current
    if (typeof incoming === 'string') { if (incoming) { secrets[p] = incoming; registerSecret(incoming); } else delete secrets[p]; }
    if (input && typeof input === 'object') setPath(input, p, '');
  }
  writeSecrets(secrets);
  const value = coerce(appSchema, input);
  for (const p of SECRET_PATHS) setPath(value, p, '');
  kvSet('app', value);
  return { settings: getAppSettingsPublic(), warnings: warnings(appSchema, value) };
}

// ---------------- presets ----------------
const rowToPreset = (r: any): Preset => ({ ...r, data: coerce(presetSchema, JSON.parse(r.data)) });

export function listPresets(): Preset[] {
  ensureDefaultPreset();
  return (getDb().prepare('SELECT * FROM presets ORDER BY created_at').all() as any[]).map(rowToPreset);
}
export function getPreset(id: string): Preset | null {
  const r = getDb().prepare('SELECT * FROM presets WHERE id = ?').get(id);
  return r ? rowToPreset(r) : null;
}
export function createPreset(name: string, data: unknown = {}): Preset {
  const id = randomUUID().slice(0, 8), at = nowIso();
  const value = coerce(presetSchema, data);
  getDb().prepare('INSERT INTO presets (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name.slice(0, 80) || 'Preset', JSON.stringify(value), at, at);
  return getPreset(id)!;
}
export function updatePreset(id: string, patch: { name?: string; data?: unknown }) {
  const cur = getPreset(id);
  if (!cur) throw Object.assign(new Error('Preset not found'), { statusCode: 404 });
  const name = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim().slice(0, 80) : cur.name;
  const data = patch.data !== undefined ? coerce(presetSchema, patch.data) : cur.data;
  getDb().prepare('UPDATE presets SET name = ?, data = ?, updated_at = ? WHERE id = ?').run(name, JSON.stringify(data), nowIso(), id);
  return { preset: getPreset(id)!, warnings: warnings(presetSchema, data) };
}
export function deletePreset(id: string) {
  if (listPresets().length <= 1) throw Object.assign(new Error('Keep at least one preset'), { statusCode: 400 });
  getDb().prepare('DELETE FROM presets WHERE id = ?').run(id);
  const days = getDayPresets(), first = listPresets()[0].id;
  for (const d of DAYS) if (days[d] === id) days[d] = first;
  kvSet('dayPresets', days);
}
function ensureDefaultPreset() {
  const n = (getDb().prepare('SELECT COUNT(*) AS n FROM presets').get() as any).n;
  if (n === 0) {
    const p = createPreset('Default', defaults(presetSchema));
    kvSet('dayPresets', Object.fromEntries(DAYS.map(d => [d, p.id])));
  }
}

// ---------------- which preset runs on which weekday ----------------
export function getDayPresets(): Record<Day, string> {
  const presets = listPresets(), ids = new Set(presets.map(p => p.id));
  const stored = kvGet<Record<string, string>>('dayPresets', {});
  return Object.fromEntries(DAYS.map(d => [d, ids.has(stored[d]) ? stored[d] : presets[0].id])) as Record<Day, string>;
}
export function setDayPresets(input: Record<string, string>) {
  const ids = new Set(listPresets().map(p => p.id)), cur = getDayPresets();
  for (const d of DAYS) if (ids.has(input?.[d])) cur[d] = input[d];
  kvSet('dayPresets', cur);
  return cur;
}

// ---------------- persona & interest memory ----------------
export interface Interest { topic: string; score: number; seen: number; updated: string }
export interface Memory { persona: string; interests: Interest[] }
const DEFAULT_PERSONA = 'I am a research assistant for a Malaysian TikTok creator. I look for ideas the creator could turn into original videos. I am curious, practical and pay attention to what makes people stop scrolling.';
export function getMemory(): Memory {
  const m = kvGet<Partial<Memory>>('memory', {});
  return { persona: typeof m.persona === 'string' ? m.persona : DEFAULT_PERSONA, interests: Array.isArray(m.interests) ? m.interests : [] };
}
export function saveMemory(m: Partial<Memory>) {
  const cur = getMemory();
  const interests = Array.isArray(m.interests) ? m.interests.filter(i => i && typeof i.topic === 'string')
    .map(i => ({ topic: String(i.topic).slice(0, 80), score: Math.max(-100, Math.min(100, Number(i.score) || 0)), seen: Math.max(0, Number(i.seen) || 0), updated: i.updated || nowIso() })) : cur.interests;
  kvSet('memory', { persona: typeof m.persona === 'string' ? m.persona.slice(0, 20000) : cur.persona, interests });
  return getMemory();
}
export function clearMemory(what: 'interests' | 'persona' | 'all') {
  const cur = getMemory();
  kvSet('memory', { persona: what === 'interests' ? cur.persona : DEFAULT_PERSONA, interests: what === 'persona' ? cur.interests : [] });
  return getMemory();
}

// ---------------- import / export (never includes secrets) ----------------
export function exportAll(includeMemory = true) {
  return {
    format: 'tiktok-research-agent/settings', version: 1, exportedAt: nowIso(),
    app: (() => { const a = coerce(appSchema, kvGet('app', {})); for (const p of SECRET_PATHS) setPath(a, p, ''); return a; })(),
    presets: listPresets().map(p => ({ id: p.id, name: p.name, data: p.data })),
    dayPresets: getDayPresets(),
    prompts: Object.fromEntries(listPrompts().filter(p => p.custom).map(p => [p.key, p.text])),
    ...(includeMemory ? { memory: getMemory() } : {}),
  };
}
export function importAll(doc: any) {
  if (!doc || doc.format !== 'tiktok-research-agent/settings') throw Object.assign(new Error('Not a settings export file'), { statusCode: 400 });
  const db = getDb();
  if (doc.app) { const keep = getAppSettings(); const merged = coerce(appSchema, doc.app); for (const p of SECRET_PATHS) setPath(merged, p, getPath(keep, p) || undefined); saveAppSettings(merged); }
  if (Array.isArray(doc.presets) && doc.presets.length) {
    db.exec('DELETE FROM presets');
    const at = nowIso();
    for (const p of doc.presets) db.prepare('INSERT INTO presets (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(String(p.id || randomUUID().slice(0, 8)).slice(0, 40), String(p.name || 'Preset').slice(0, 80), JSON.stringify(coerce(presetSchema, p.data)), at, at);
  }
  if (doc.dayPresets) setDayPresets(doc.dayPresets);
  if (doc.prompts && typeof doc.prompts === 'object') for (const [k, v] of Object.entries(doc.prompts)) if (typeof v === 'string') setPrompt(k, v);
  if (doc.memory) saveMemory(doc.memory);
  return { ok: true };
}
