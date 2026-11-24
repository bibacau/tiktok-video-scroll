// Engagement while watching: like / follow / favourite with daily + per-session caps.
// Comments are only DRAFTED here; they wait for your approval and are posted later.
import type { Page } from 'playwright-core';
import { getDb, nowIso } from '../db.ts';
import { log } from '../log.ts';
import { runScript } from '../browser/edge.ts';
import { selectors, type VideoInfo } from '../browser/tiktok.ts';
import { chatJson } from '../llm/client.ts';
import { getPrompt, render } from '../settings/prompts.ts';
import { zoned } from '../time.ts';

type Kind = 'like' | 'follow' | 'favourite' | 'comment';
const count = (kind: Kind, where: string, arg: string | number | null) =>
  (getDb().prepare(`SELECT COUNT(*) n FROM engagements WHERE kind = ? AND ${where} AND status IN ('done', 'pending', 'approved', 'posted')`).get(kind, arg) as any).n as number;
const record = (kind: Kind, sessionId: number | null, v: { key?: string; url?: string | null; author?: string }, status: string, text: string | null = null, error: string | null = null) =>
  Number(getDb().prepare('INSERT INTO engagements (at, day, session_id, kind, video_key, video_url, author, status, text, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(nowIso(), zoned().day, sessionId, kind, v.key ?? null, v.url ?? null, v.author ?? null, status, text, error).lastInsertRowid);

function allowed(kind: Kind, cfg: any, sessionId: number) {
  return cfg.enabled && count(kind, 'day = ?', zoned().day) < cfg.dailyCap && (cfg.sessionCap === undefined || count(kind, 'session_id = ?', sessionId) < cfg.sessionCap);
}

export async function engage(page: Page, sessionId: number, e: any, v: VideoInfo, score: number, saved: boolean, videoText: string, languages: string, signal?: AbortSignal): Promise<string[]> {
  const done: string[] = [];
  const sel = selectors();
  const click = async (kind: Exclude<Kind, 'comment'>, list: string[]) => {
    const r = await runScript<any>(page, 'engageClick', { selectors: list }).catch((x: any) => ({ error: x.message }));
    if (r?.clicked) { record(kind, sessionId, v, 'done'); done.push(kind); }
    else if (r?.already) record(kind, sessionId, v, 'skipped', null, 'already done');
    else record(kind, sessionId, v, 'failed', null, r?.error ?? 'button not found');
    await new Promise(res => setTimeout(res, 600 + Math.random() * 900));
  };
  if (allowed('like', e.like, sessionId) && score >= e.like.minScore) await click('like', sel.likeButton);
  if (allowed('favourite', e.favourite, sessionId) && saved && score >= e.favourite.minScore) await click('favourite', sel.favouriteButton);
  if (allowed('follow', e.follow, sessionId) && score >= e.follow.minScore && v.author && !count('follow', 'author = ?', v.author)) await click('follow', sel.followButton);
  if (e.comment.enabled && score >= e.comment.minScore && v.url && count('comment', 'day = ?', zoned().day) < e.comment.dailyCap && !count('comment', 'video_key = ?', v.key ?? null)) {
    try {
      const { json } = await chatJson({ step: 'analyze', signal, system: render(getPrompt('engage_comment'), { style: e.comment.style, languages, video: videoText }) });
      const text = String(json?.comment ?? '').replace(/https?:\/\/\S+/g, '').trim().slice(0, 150);
      if (text) { record('comment', sessionId, v, 'pending', text); done.push('comment drafted'); log('info', 'engage', `Comment drafted for @${v.author} — waiting for your approval`); }
    } catch (x: any) { if (x?.code === 'BUDGET_EXCEEDED') throw x; log('warn', 'engage', `Could not draft a comment: ${x.message}`); }
  }
  if (done.length) log('info', 'engage', `@${v.author}: ${done.join(', ')}`);
  return done;
}

export const listComments = (status?: string) =>
  getDb().prepare(`SELECT * FROM engagements WHERE kind = 'comment' ${status ? 'AND status = ?' : ''} ORDER BY id DESC LIMIT 200`).all(...(status ? [status] : [])) as any[];
export const engagementStats = () => getDb().prepare("SELECT kind, status, COUNT(*) n FROM engagements WHERE day = ? GROUP BY kind, status").all(zoned().day);

/** Post one approved comment in the watcher's window (only called while no session runs). */
export async function postComment(page: Page, id: number): Promise<boolean> {
  const row = getDb().prepare("SELECT * FROM engagements WHERE id = ? AND kind = 'comment'").get(id) as any;
  if (!row?.video_url || !row.text) return false;
  const sel = selectors();
  try {
    await page.goto(row.video_url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await new Promise(r => setTimeout(r, 2500));
    const guard = (await runScript<any>(page, 'inspect', sel).catch(() => null))?.guard;
    if (guard) throw new Error(`${guard.detail} — handle it in the agent window`);
    let input = null;
    for (const s of sel.commentInput) { const l = page.locator(s).first(); if (await l.isVisible().catch(() => false)) { input = l; break; } }
    if (!input) throw new Error('Comment box not found');
    await input.click();
    await input.pressSequentially(row.text, { delay: 35 });
    let posted = false;
    for (const s of sel.commentPost) { const l = page.locator(s).first(); if (await l.isVisible().catch(() => false)) { await l.click(); posted = true; break; } }
    if (!posted) await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 2500));
    const seen = await page.getByText(row.text.slice(0, 40), { exact: false }).count().catch(() => 0);
    if (!seen) throw new Error('The comment did not appear after posting');
    getDb().prepare("UPDATE engagements SET status = 'posted', error = NULL WHERE id = ?").run(id);
    log('info', 'engage', `Posted approved comment on ${row.video_url}`);
    return true;
  } catch (e: any) {
    getDb().prepare("UPDATE engagements SET status = 'failed', error = ? WHERE id = ?").run(e.message, id);
    log('warn', 'engage', `Comment #${id}: ${e.message}`);
    return false;
  }
}
