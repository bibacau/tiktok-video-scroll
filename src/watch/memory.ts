import { getMemory, saveMemory, type Interest } from '../settings/store.js';
import { nowIso } from '../db.js';

export interface TopicSignal { topic: string; signal: 'like' | 'dislike' | 'neutral' }

/**
 * Interests follow actual behaviour (idea from LockyBee/dsh-douyin-agent persona-memory):
 * seeing a topic is not liking it. A "like" counts more when the video was really watched.
 */
export function updateInterests(topics: TopicSignal[] | undefined, watchRatio: number, decision: 'watch' | 'skip') {
  if (!Array.isArray(topics) || !topics.length) return;
  const m = getMemory();
  const byTopic = new Map(m.interests.map(i => [i.topic.toLowerCase(), i]));
  for (const t of topics.slice(0, 6)) {
    if (!t || typeof t.topic !== 'string' || !t.topic.trim()) continue;
    const name = t.topic.trim().slice(0, 80);
    let delta = 0;
    if (t.signal === 'like') delta = decision === 'watch' ? 3 + 7 * Math.min(1, watchRatio) : 1;
    else if (t.signal === 'dislike') delta = -6;
    else delta = decision === 'skip' ? -1 : watchRatio > 0.6 ? 1 : 0;
    const cur: Interest = byTopic.get(name.toLowerCase()) ?? { topic: name, score: 0, seen: 0, updated: nowIso() };
    cur.score = Math.max(-100, Math.min(100, Math.round((cur.score * 0.98 + delta) * 10) / 10));
    cur.seen += 1; cur.updated = nowIso();
    byTopic.set(name.toLowerCase(), cur);
  }
  const interests = [...byTopic.values()].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 300);
  saveMemory({ interests });
}

export function interestsForPrompt(limit = 40) {
  const list = getMemory().interests.slice(0, limit);
  return list.length ? list.map(i => `${i.topic}: ${i.score > 0 ? '+' : ''}${i.score}`).join('\n') : '(none yet)';
}
