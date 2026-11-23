import { EventEmitter } from 'node:events';
import { getDb, nowIso } from './db.js';

export type Level = 'debug' | 'info' | 'warn' | 'error' | 'alert';
export interface LogEvent { id?: number; at: string; level: Level; type: string; message: string; data?: unknown }

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const secrets = new Set<string>();
/** Register a secret value so it is scrubbed from every log line and event. */
export function registerSecret(value: string | undefined) {
  if (value && value.length >= 6) secrets.add(value);
}
export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  return out.replace(/(sk-[A-Za-z0-9]{4})[A-Za-z0-9_-]{8,}/g, '$1***').replace(/(Bearer\s+)[^\s"']+/gi, '$1***');
}

export function log(level: Level, type: string, message: string, data?: unknown) {
  const event: LogEvent = { at: nowIso(), level, type, message: redact(message) };
  let dataText: string | null = null;
  if (data !== undefined) {
    try { dataText = redact(JSON.stringify(data)); event.data = JSON.parse(dataText); } catch { /* ignore */ }
  }
  if (level !== 'debug') {
    try {
      const r = getDb().prepare('INSERT INTO events (at, level, type, message, data) VALUES (?, ?, ?, ?, ?)')
        .run(event.at, level, type, event.message, dataText);
      event.id = Number(r.lastInsertRowid);
    } catch { /* db not ready */ }
  }
  const line = `[${event.at}] ${level.toUpperCase()} ${type}: ${event.message}`;
  if (level === 'error' || level === 'alert') console.error(line); else if (level !== 'debug' || process.env.DEBUG) console.log(line);
  bus.emit('log', event);
  return event;
}
