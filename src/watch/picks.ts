import { getDb, kvSet, kvGet, nowIso } from '../db.ts';
import { chatJson } from '../llm/client.ts';
import { getPrompt, render } from '../settings/prompts.ts';
import { getMemory } from '../settings/store.ts';
import { log } from '../log.ts';

export async function generatePicks(day: string, preset: { data: any }) {
  const save = preset.data.save;
  const candidates = getDb().prepare(`SELECT id, url, author, caption, score, reason, data FROM videos
    WHERE day = ? AND saved = 1 ORDER BY score DESC LIMIT 60`).all(day) as any[];
  if (!candidates.length) {
    log('info', 'picks', `No saved videos on ${day} yet — nothing to pick from`);
    return { day, summary: 'No saved videos yet.', picks: [] };
  }
  const list = candidates.map(c => {
    const d = JSON.parse(c.data || '{}'), f = d.fields ?? {};
    return { id: c.id, score: c.score, creator: c.author, caption: String(c.caption ?? '').slice(0, 200), topic: f.topic, hook: f.hook, format: f.format, why: c.reason };
  });
  const { json } = await chatJson({
    step: 'picks',
    system: render(getPrompt('picks'), {
      persona: getMemory().persona, criteria: save.pickCriteria, count: save.picksCount, candidates: JSON.stringify(list, null, 1),
      instructions: preset.data.watch.instructions,
    }),
  });
  const ids = new Set(candidates.map(c => c.id));
  const picks = (Array.isArray(json?.picks) ? json.picks : []).filter((p: any) => ids.has(Number(p.id))).slice(0, save.picksCount);
  const db = getDb();
  db.prepare('DELETE FROM picks WHERE day = ?').run(day);
  picks.forEach((p: any, i: number) => db.prepare('INSERT INTO picks (day, rank, video_id, why, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(day, i + 1, Number(p.id), JSON.stringify({ why: p.why ?? '', idea: p.idea ?? '' }), nowIso()));
  kvSet(`picksSummary:${day}`, String(json?.summary ?? ''));
  log('info', 'picks', `Built ${picks.length} picks for ${day}`);
  return getPicks(day);
}

export function getPicks(day: string) {
  const rows = getDb().prepare(`SELECT p.rank, p.why, v.* FROM picks p JOIN videos v ON v.id = p.video_id WHERE p.day = ? ORDER BY p.rank`).all(day) as any[];
  return {
    day, summary: kvGet(`picksSummary:${day}`, ''),
    picks: rows.map(r => { const w = JSON.parse(r.why || '{}'); return { ...r, why: w.why, idea: w.idea, data: JSON.parse(r.data || '{}') }; }),
  };
}
