import { DatabaseSync } from 'node:sqlite';
import { paths } from './paths.ts';

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prompts (key TEXT PRIMARY KEY, text TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, preset_id TEXT, preset_name TEXT, day TEXT NOT NULL,
  trigger TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, planned_seconds INTEGER,
  watched_seconds INTEGER DEFAULT 0, videos INTEGER DEFAULT 0, saved INTEGER DEFAULT 0,
  status TEXT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, day TEXT NOT NULL, at TEXT NOT NULL,
  video_key TEXT NOT NULL, url TEXT, author TEXT, caption TEXT, source TEXT,
  decision TEXT NOT NULL, interest INTEGER, score INTEGER, reason TEXT,
  watched_seconds REAL, duration REAL, saved INTEGER DEFAULT 0, data TEXT);
CREATE INDEX IF NOT EXISTS videos_day ON videos(day);
CREATE INDEX IF NOT EXISTS videos_key ON videos(video_key);
CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, rank INTEGER NOT NULL,
  video_id INTEGER NOT NULL, why TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS picks_day ON picks(day);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, day TEXT NOT NULL, month TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT, step TEXT, prompt_tokens INTEGER DEFAULT 0,
  cached_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0,
  units REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_rm REAL DEFAULT 0);
CREATE INDEX IF NOT EXISTS usage_day ON usage(day);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, type TEXT NOT NULL,
  message TEXT NOT NULL, data TEXT);
CREATE TABLE IF NOT EXISTS day_plans (day TEXT PRIMARY KEY, preset_id TEXT, signature TEXT, plan TEXT NOT NULL);
`;

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(paths.db);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA);
  }
  return db;
}

export function closeDb() { db?.close(); db = null; }

export function kvGet<T>(key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}

export function kvSet(key: string, value: unknown) {
  getDb().prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export const nowIso = () => new Date().toISOString();
