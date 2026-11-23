import { getDb } from '../db.ts';
import { chatJson } from '../llm/client.ts';
import { getPrompt, render } from '../settings/prompts.ts';
import { getMemory } from '../settings/store.ts';
import { interestsForPrompt } from '../watch/memory.ts';
import { getPicks } from '../watch/picks.ts';
import { log } from '../log.ts';
import type { Scene } from './visuals.ts';

export interface Idea { title: string; angle: string; why?: string; inspired_by?: number[] }
export interface Script { title: string; hook: string; scenes: Scene[]; caption: string; hashtags: string[] }

/** What the research found: today's picks, else the best recently saved videos. */
export function researchNotes(day: string, limit = 12) {
  const picks = getPicks(day).picks;
  const rows: any[] = picks.length ? picks : getDb().prepare('SELECT * FROM videos WHERE saved = 1 ORDER BY id DESC LIMIT ?').all(limit) as any[];
  return rows.slice(0, limit).map(r => {
    const f = (typeof r.data === 'string' ? JSON.parse(r.data || '{}') : r.data ?? {}).fields ?? {};
    return { id: r.id, topic: f.topic, hook: f.hook, format: f.format, why: r.why ?? r.reason, idea: r.idea, sound: f.audio, caption: String(r.caption ?? '').slice(0, 160) };
  });
}

export async function planIdeas(day: string, create: any, count: number, topic?: string): Promise<Idea[]> {
  const b = create.basics;
  const recent = (getDb().prepare('SELECT title FROM creations ORDER BY id DESC LIMIT 30').all() as any[]).map(r => r.title).filter(Boolean);
  const { json } = await chatJson({
    step: 'plan',
    system: render(getPrompt('create_plan'), {
      instructions: create.instructions + (topic ? `\nThe user asked specifically for: ${topic}` : ''),
      count, language: b.language, tone: b.tone, audience: b.audience,
      research: b.useResearch ? JSON.stringify(researchNotes(day), null, 1) : '(not used)',
      interests: interestsForPrompt(20), recent: recent.join('\n') || '(none)', banned_topics: create.script.bannedTopics.join(', ') || '(none)',
      persona: getMemory().persona,
    }),
  });
  const ideas: Idea[] = (Array.isArray(json?.ideas) ? json.ideas : []).filter((i: any) => i && typeof i.title === 'string').slice(0, count);
  if (!ideas.length) throw new Error('The AI returned no video ideas');
  return ideas;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function findBanned(s: Script, words: string[]): string[] {
  const text = [s.title, s.hook, s.caption, ...s.hashtags, ...s.scenes.flatMap(x => [x.voiceover, x.on_screen ?? ''])].join(' \n ');
  return words.filter(w => w.trim() && new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(text));
}
function stripBanned(s: Script, words: string[]): Script {
  const clean = (t: string) => words.reduce((acc, w) => acc.replace(new RegExp(esc(w.trim()), 'giu'), ''), t).replace(/\s{2,}/g, ' ').trim();
  return { ...s, title: clean(s.title), hook: clean(s.hook), caption: clean(s.caption), hashtags: s.hashtags.filter(h => !findBanned({ title: h, hook: '', caption: '', hashtags: [], scenes: [] }, words).length),
    scenes: s.scenes.map(x => ({ ...x, voiceover: clean(x.voiceover), on_screen: clean(x.on_screen ?? '') })) };
}

/** Apply caption & hashtag rules from settings. */
export function finalizeCaption(s: Script, rules: any): { caption: string; hashtags: string[] } {
  const norm = (h: string) => h.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 50);
  const always = rules.alwaysTags.map(norm).filter(Boolean);
  const own = s.hashtags.map(norm).filter(Boolean);
  const tags = [...new Set([...always, ...own].map(t => t.toLowerCase()))];
  const count = Math.max(rules.hashtagCount, always.length);
  let caption = s.caption.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s{2,}/g, ' ').trim();
  if (caption.length > rules.maxChars) caption = caption.slice(0, rules.maxChars - 1).replace(/\s+\S*$/, '') + '…';
  return { caption, hashtags: tags.slice(0, count) };
}

function normalize(json: any): Script {
  const scenes = (Array.isArray(json?.scenes) ? json.scenes : []).map((x: any) => ({
    voiceover: String(x?.voiceover ?? x?.text ?? '').trim(), on_screen: String(x?.on_screen ?? '').trim(),
    keywords: String(x?.keywords ?? '').trim(), image_prompt: String(x?.image_prompt ?? '').trim(),
  })).filter((x: Scene) => x.voiceover || x.on_screen).slice(0, 30);
  if (!scenes.length) throw new Error('The AI script had no scenes');
  return { title: String(json?.title ?? 'Untitled').slice(0, 120), hook: String(json?.hook ?? ''), scenes, caption: String(json?.caption ?? ''), hashtags: Array.isArray(json?.hashtags) ? json.hashtags.map(String) : [] };
}

export async function writeScript(idea: Idea, create: any, day: string): Promise<Script> {
  const b = create.basics, sc = create.script;
  const vars = {
    instructions: create.instructions, idea: JSON.stringify(idea), language: b.language, tone: b.tone, audience: b.audience,
    length: b.lengthSeconds, scene_seconds: sc.sceneSeconds, scenes: Math.max(2, Math.round(b.lengthSeconds / sc.sceneSeconds)),
    hook_style: sc.hookStyle, structure: sc.structure, cta: sc.cta,
    banned_words: sc.bannedWords.join(', ') || '(none)', banned_topics: sc.bannedTopics.join(', ') || '(none)',
    caption_rules: `${create.caption.instructions} Max ${create.caption.maxChars} characters.`, hashtag_count: create.caption.hashtagCount,
    research: b.useResearch ? JSON.stringify(researchNotes(day).filter(r => !idea.inspired_by?.length || idea.inspired_by.includes(r.id)).slice(0, 5), null, 1) : '(not used)',
    voice: create.voice.provider === 'none' ? 'There is NO voiceover: put the full message in on_screen text, keep voiceover very short (used for subtitles only).' : 'A voiceover reads each scene.',
  };
  let script = normalize((await chatJson({ step: 'script', system: render(getPrompt('create_script'), vars) })).json);
  let banned = findBanned(script, sc.bannedWords);
  if (banned.length) {
    log('info', 'create', `Script used banned words (${banned.join(', ')}) — rewriting once`);
    script = normalize((await chatJson({ step: 'script', system: render(getPrompt('create_script'), vars), user: `Your previous script used these banned words: ${banned.join(', ')}. Rewrite without them. Reply with the JSON only.` })).json);
    banned = findBanned(script, sc.bannedWords);
    if (banned.length) { log('warn', 'create', `Removed banned words from script: ${banned.join(', ')}`); script = stripBanned(script, sc.bannedWords); }
  }
  return script;
}
