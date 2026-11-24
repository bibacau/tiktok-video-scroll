// An existing data folder from an older version loads with every value intact and is migrated in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-migrate-'));
process.env.DATA_DIR = DATA;

// Schema as written by the Phase 2 version (no accounts/metrics/engagements/shares tables,
// no posting columns on creations, no usage.ref).
const OLD_SCHEMA = `
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE prompts (key TEXT PRIMARY KEY, text TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, preset_id TEXT, preset_name TEXT, day TEXT NOT NULL, trigger TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, planned_seconds INTEGER, watched_seconds INTEGER DEFAULT 0, videos INTEGER DEFAULT 0, saved INTEGER DEFAULT 0, status TEXT NOT NULL, note TEXT);
CREATE TABLE videos (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, day TEXT NOT NULL, at TEXT NOT NULL, video_key TEXT NOT NULL, url TEXT, author TEXT, caption TEXT, source TEXT, decision TEXT NOT NULL, interest INTEGER, score INTEGER, reason TEXT, watched_seconds REAL, duration REAL, saved INTEGER DEFAULT 0, data TEXT);
CREATE TABLE picks (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, rank INTEGER NOT NULL, video_id INTEGER NOT NULL, why TEXT, created_at TEXT NOT NULL);
CREATE TABLE usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, day TEXT NOT NULL, month TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, step TEXT, prompt_tokens INTEGER DEFAULT 0, cached_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0, units REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_rm REAL DEFAULT 0);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, type TEXT NOT NULL, message TEXT NOT NULL, data TEXT);
CREATE TABLE creations (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, preset_id TEXT, status TEXT NOT NULL, stage TEXT, title TEXT, idea TEXT, script TEXT, assets TEXT, caption TEXT, hashtags TEXT, video_path TEXT, thumb_path TEXT, duration REAL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE day_plans (day TEXT PRIMARY KEY, preset_id TEXT, signature TEXT, plan TEXT NOT NULL);`;

test('old data folder: database, settings, API keys and Edge profiles survive the update', async () => {
  const dbFile = path.join(DATA, 'app.sqlite');
  const old = new DatabaseSync(dbFile);
  old.exec(OLD_SCHEMA);
  const at = '2026-11-20T10:00:00.000Z';
  old.prepare('INSERT INTO presets VALUES (?, ?, ?, ?, ?)').run('food01', 'Food research', JSON.stringify({
    watch: { instructions: 'My own watch instructions', sources: { keywords: ['nasi lemak', 'laksa'] }, behaviour: { strictness: 8 } },
    schedule: { enabled: true, dailyMinutes: 77, windows: { mon: [{ start: '08:00', end: '11:00' }] } },
    save: { picksCount: 9, pickCriteria: 'My criteria' },
    create: { instructions: 'My video instructions', basics: { lengthSeconds: 33 } },
  }), at, at);
  old.prepare('INSERT INTO kv VALUES (?, ?)').run('app', JSON.stringify({ general: { currencyRate: 4.5 }, llm: { baseUrl: 'https://my.proxy/v1', apiKey: '' }, budget: { dailyCapRM: 9 } }));
  old.prepare('INSERT INTO kv VALUES (?, ?)').run('dayPresets', JSON.stringify({ mon: 'food01' }));
  old.prepare('INSERT INTO kv VALUES (?, ?)').run('memory', JSON.stringify({ persona: 'My persona', interests: [{ topic: 'laksa', score: 42, seen: 3, updated: at }] }));
  old.prepare('INSERT INTO prompts VALUES (?, ?, ?)').run('watch_decide', 'MY EDITED PROMPT', at);
  old.prepare("INSERT INTO usage (at, day, month, provider, model, step, cost_rm) VALUES (?, '2026-11-20', '2026-11', 'deepseek', 'deepseek-chat', 'watch', 1.25)").run(at);
  old.prepare("INSERT INTO creations (day, preset_id, status, title, caption, created_at, updated_at) VALUES ('2026-11-20', 'food01', 'ready', 'Old video', 'cap', ?, ?)").run(at, at);
  old.prepare("INSERT INTO videos (day, at, video_key, decision, saved, url) VALUES ('2026-11-20', ?, '123', 'watch', 1, 'https://www.tiktok.com/@a/video/123')").run(at);
  old.close();
  const secrets = JSON.stringify({ 'llm.apiKey': 'sk-old-secret-key-123456' }, null, 2);
  fs.writeFileSync(path.join(DATA, 'secrets.json'), secrets);
  const profile = path.join(DATA, 'edge-profiles', 'watcher', 'Default'); fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'Cookies'), 'login-cookie-db');
  const inode = fs.statSync(dbFile).ino;

  // load with the current code
  (await import('../src/paths.ts')).ensureDirs();
  const store = await import('../src/settings/store.ts');
  const db = (await import('../src/db.ts')).getDb();
  const { getPrompt } = await import('../src/settings/prompts.ts');

  const p = store.getPreset('food01')!;
  assert.equal(p.name, 'Food research');
  assert.equal(p.data.watch.instructions, 'My own watch instructions');
  assert.deepEqual(p.data.watch.sources.keywords, ['nasi lemak', 'laksa']);
  assert.equal(p.data.watch.behaviour.strictness, 8);
  assert.equal(p.data.schedule.dailyMinutes, 77);
  assert.deepEqual(p.data.schedule.windows.mon, [{ start: '08:00', end: '11:00' }]);
  assert.equal(p.data.save.picksCount, 9);
  assert.equal(p.data.create.instructions, 'My video instructions');
  assert.equal(p.data.create.basics.lengthSeconds, 33);
  assert.equal(p.data.post.mode, 'approval', 'new sections get safe defaults');
  assert.equal(store.listPresets().length, 1, 'no Default preset added on top');
  const app = store.getAppSettings();
  assert.equal(app.general.currencyRate, 4.5);
  assert.equal(app.llm.baseUrl, 'https://my.proxy/v1');
  assert.equal(app.llm.apiKey, 'sk-old-secret-key-123456');
  assert.equal(app.budget.dailyCapRM, 9);
  assert.equal(store.getDayPresets().mon, 'food01');
  assert.equal(store.getMemory().persona, 'My persona');
  assert.equal(getPrompt('watch_decide'), 'MY EDITED PROMPT');
  // migrated in place
  assert.equal(fs.statSync(dbFile).ino, inode, 'same database file');
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c => c.name);
  assert.ok(cols('creations').includes('post_at') && cols('usage').includes('ref'));
  for (const t of ['accounts', 'metrics', 'engagements']) assert.ok(cols(t).length, `${t} table added`);
  assert.equal((db.prepare('SELECT title FROM creations').get() as any).title, 'Old video');
  assert.equal((db.prepare('SELECT cost_rm FROM usage').get() as any).cost_rm, 1.25);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM videos').get() as any).n, 1);
  assert.equal(fs.readFileSync(path.join(DATA, 'secrets.json'), 'utf8'), secrets, 'secrets.json untouched');
  assert.equal(fs.readFileSync(path.join(profile, 'Cookies'), 'utf8'), 'login-cookie-db', 'Edge profile untouched');
  // the new per-section saves work on the old data
  const r = store.patchPresetSection('food01', 'schedule', { ...p.data.schedule, sessions: 5 }, '0');
  assert.equal(r.preset.data.schedule.sessions, 5);
  assert.equal(store.getPreset('food01')!.data.watch.instructions, 'My own watch instructions');
});
