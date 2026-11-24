import fs from 'node:fs';
import path from 'node:path';
import { getDb, nowIso } from '../db.ts';
import { paths } from '../paths.ts';

/** Every prompt the app sends. Default text lives in src/prompts/<key>.md; edits are stored in the DB. */
export const PROMPTS: Array<{ key: string; title: string; step: string; variables: string[] }> = [
  { key: 'watch_decide', title: 'Watch: watch or skip?', step: 'watch',
    variables: ['persona', 'interests', 'instructions', 'strictness', 'languages', 'video', 'frames_note'] },
  { key: 'watch_analyze', title: 'Watch: second look & what to save', step: 'analyze',
    variables: ['persona', 'instructions', 'fields', 'video', 'first_decision', 'frames_note'] },
  { key: 'vision_describe', title: 'Vision helper: describe frames', step: 'vision', variables: [] },
  { key: 'create_plan', title: 'Create: plan video ideas', step: 'plan',
    variables: ['persona', 'instructions', 'count', 'language', 'tone', 'audience', 'research', 'interests', 'recent', 'banned_topics', 'performance'] },
  { key: 'create_script', title: 'Create: write the script', step: 'script',
    variables: ['instructions', 'idea', 'research', 'language', 'tone', 'audience', 'length', 'scenes', 'scene_seconds', 'hook_style', 'structure', 'cta', 'voice', 'banned_words', 'banned_topics', 'caption_rules', 'hashtag_count'] },
  { key: 'create_image', title: 'Create: AI image / video prompt', step: 'image', variables: ['scene', 'style'] },
  { key: 'engage_comment', title: 'Engage: draft a comment (always needs your approval)', step: 'analyze', variables: ['style', 'languages', 'video'] },
  { key: 'picks', title: "Today's picks", step: 'picks',
    variables: ['persona', 'criteria', 'count', 'candidates', 'instructions'] },
];

const defaultText = (key: string) => {
  try { return fs.readFileSync(path.join(paths.defaultPrompts, `${key}.md`), 'utf8'); } catch { return ''; }
};

export function getPrompt(key: string): string {
  const row = getDb().prepare('SELECT text FROM prompts WHERE key = ?').get(key) as { text: string } | undefined;
  return row?.text ?? defaultText(key);
}
export function setPrompt(key: string, text: string) {
  if (!PROMPTS.some(p => p.key === key)) throw Object.assign(new Error('Unknown prompt'), { statusCode: 404 });
  getDb().prepare('INSERT INTO prompts (key, text, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at')
    .run(key, String(text).slice(0, 100_000), nowIso());
}
export function resetPrompt(key: string) { getDb().prepare('DELETE FROM prompts WHERE key = ?').run(key); }
export function listPrompts() {
  return PROMPTS.map(p => {
    const row = getDb().prepare('SELECT text, updated_at FROM prompts WHERE key = ?').get(p.key) as any;
    return { ...p, text: row?.text ?? defaultText(p.key), default: defaultText(p.key), custom: !!row, updated_at: row?.updated_at ?? null };
  });
}

/** {{name}} substitution. Unknown variables are left empty. */
export function render(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 1);
  });
}
