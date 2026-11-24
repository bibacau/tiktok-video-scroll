// AI-chosen searches: validation, daily limit and the log shown in History.
import { getDb, nowIso } from '../db.ts';
import { zoned } from '../time.ts';
import { log } from '../log.ts';

export const MAX_QUERY = 60;

/** Check an AI-proposed query against length, your exclude / banned words, the block-list and the allow-list. */
export function validateQuery(raw: unknown, watch: any, bannedWords: string[] = []): { ok: boolean; query: string; why?: string } {
  const query = String(raw ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[#@"“”<>]/g, '').replace(/\s+/g, ' ').trim();
  const lower = query.toLowerCase();
  if (!query) return { ok: false, query, why: 'empty query' };
  if (query.length > MAX_QUERY) return { ok: false, query, why: `longer than ${MAX_QUERY} characters` };
  if (/https?:|www\./i.test(query)) return { ok: false, query, why: 'looks like a link' };
  const s = watch.sources.aiSearch;
  const hit = [...watch.filters.excludeKeywords, ...s.blockList, ...bannedWords].find((w: string) => w.trim() && lower.includes(w.trim().toLowerCase()));
  if (hit) return { ok: false, query, why: `contains blocked word "${hit}"` };
  if (s.allowTopics.length && !s.allowTopics.some((w: string) => lower.includes(w.trim().toLowerCase()))) return { ok: false, query, why: 'not about an allowed topic' };
  return { ok: true, query };
}

export const searchesToday = () => (getDb().prepare("SELECT COUNT(*) n FROM searches WHERE day = ? AND status = 'done'").get(zoned().day) as any).n as number;
export const aiSearchAvailable = (watch: any) => watch.sources.aiSearch.enabled && searchesToday() < watch.sources.aiSearch.dailyLimit;

export function recordSearch(sessionId: number | null, query: string, reason: string, status: 'done' | 'rejected' | 'failed', method: string | null, note: string | null = null) {
  getDb().prepare('INSERT INTO searches (at, day, session_id, query, reason, status, method, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(nowIso(), zoned().day, sessionId, query.slice(0, 120), String(reason ?? '').slice(0, 500), status, method, note);
  log(status === 'done' ? 'info' : 'warn', 'ai-search', status === 'done' ? `AI searched "${query}" (${method}) — ${reason}` : `AI search "${query}" ${status}: ${note}`);
}

export const listSearches = (limit = 200) => getDb().prepare('SELECT * FROM searches ORDER BY id DESC LIMIT ?').all(limit);

/** Extra instructions added to the watch prompt only while AI search is on and allowed today. */
export function searchOption(watch: any): string {
  if (!aiSearchAvailable(watch)) return '';
  const s = watch.sources.aiSearch;
  return [`You may ALSO choose "action": "search" with a "query" (max ${MAX_QUERY} characters, in the language people would search in) when a search would find videos that fit the user's instructions better than this feed does right now — e.g. after several off-topic videos, or to dig deeper into a promising topic you just saw.`,
    `Searches left today: ${s.dailyLimit - searchesToday()}.`,
    s.allowTopics.length ? `Every query must be about one of: ${s.allowTopics.join(', ')}.` : '',
    s.blockList.length ? `Never search for: ${s.blockList.join(', ')}.` : ''].filter(Boolean).join('\n');
}
