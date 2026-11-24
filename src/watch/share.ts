// Share saved videos to your main TikTok account with TikTok's own Share → Send to, in the watcher's
// Edge window (same idea as dsh-douyin-agent's autonomous share). Never twice for the same video.
import type { Page } from 'playwright-core';
import { getDb, kvGet, kvSet, nowIso } from '../db.ts';
import { log } from '../log.ts';
import { runScript } from '../browser/edge.ts';
import { selectors } from '../browser/tiktok.ts';
import { sendTelegram, telegramConfigured } from '../notify.ts';
import { zoned } from '../time.ts';

export interface ShareTarget { videoKey: string; url: string | null; author?: string; videoRow?: number | null }
export type ShareResult = 'done' | 'pending' | 'skipped' | 'failed' | 'blocked' | 'needs_user';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const recipientOf = (cfg: any) => String(cfg.to || '').replace(/^@/, '').trim();

export function explain(kind: 'not_found' | 'blocked', to: string) {
  return kind === 'not_found'
    ? `Couldn't find @${to} in TikTok's "Send to" list. TikTok only lets you send videos to people you can message: on the watcher's TikTok account follow @${to}, and on @${to} follow the watcher account back (mutual follow). Then press "Retry sharing".`
    : `TikTok won't let the watcher account message @${to}. Make the two accounts follow each other (watcher follows @${to}, and @${to} follows the watcher back), check @${to}'s message settings allow messages from friends, then press "Retry sharing".`;
}

/** Any share entry for this video + recipient (except one you rejected) → never create another one. */
const sharedBefore = (key: string, to: string) => !!getDb().prepare("SELECT 1 FROM shares WHERE video_key = ? AND recipient = ? AND status != 'rejected'").get(key, to);
const alreadySent = (key: string, to: string) => !!getDb().prepare("SELECT 1 FROM shares WHERE video_key = ? AND recipient = ? AND status = 'done'").get(key, to);
const sharedToday = () => (getDb().prepare("SELECT COUNT(*) n FROM shares WHERE day = ? AND status IN ('done', 'pending', 'approved')").get(zoned().day) as any).n as number;
export const sharingPaused = () => kvGet<string | null>('sharePausedDay', null) === zoned().day;
export const resumeSharing = () => kvSet('sharePausedDay', null);
function insert(t: ShareTarget, cfg: any, status: string, sessionId: number | null, error: string | null = null) {
  return Number(getDb().prepare('INSERT INTO shares (at, day, session_id, video_row, video_key, video_url, author, recipient, mode, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(nowIso(), zoned().day, sessionId, t.videoRow ?? null, t.videoKey, t.url, t.author || t.url?.match(/\/@([^/?#]+)/)?.[1] || null, recipientOf(cfg), cfg.mode, status, error).lastInsertRowid);
}
const setStatus = (id: number, status: string, error: string | null = null, telegram?: string) =>
  getDb().prepare('UPDATE shares SET status = ?, error = ?, telegram = COALESCE(?, telegram), at = ? WHERE id = ?').run(status, error, telegram ?? null, nowIso(), id);

async function telegramCopy(cfg: any, t: ShareTarget, failed: boolean): Promise<string | undefined> {
  if (cfg.telegram === 'off' || (cfg.telegram === 'on_failure' && !failed) || !t.url) return undefined;
  if (!telegramConfigured()) return 'not set up';
  try { await sendTelegram(`🎬 Saved TikTok${t.author ? ` by @${t.author}` : ''}:\n${t.url}`); return 'sent'; } catch (e: any) { log('warn', 'share', e.message); return `failed: ${e.message}`; }
}

/** Run Share → Send to → recipient → Send on the page that shows the video. */
export async function shareOnPage(page: Page, to: string): Promise<{ ok: boolean; kind?: 'not_found' | 'blocked' | 'guard' | 'ui'; message?: string }> {
  const sel = selectors();
  const st = (extra = {}) => runScript<any>(page, 'shareState', { dialog: sel.shareDialog, blocked: sel.shareBlockedTexts, notFound: sel.shareNotFoundTexts, sent: sel.shareSentTexts, ...extra });
  const guard = (await runScript<any>(page, 'inspect', sel).catch(() => null))?.guard;
  if (guard) return { ok: false, kind: 'guard', message: guard.detail };
  const opened = await runScript<any>(page, 'shareOpen', { selectors: sel.shareButton });
  if (!opened.found) return { ok: false, kind: 'ui', message: 'Share button not found (Settings → TikTok page selectors: shareButton)' };
  await sleep(900 + Math.random() * 600);
  if (!(await st()).open) return { ok: false, kind: 'ui', message: 'The share panel did not open' };
  await runScript(page, 'shareClickText', { dialog: sel.shareDialog, texts: sel.shareSendToTexts.filter(t => !sel.shareSendTexts.includes(t)) });
  await sleep(700);
  let pick = await runScript<any>(page, 'shareSelect', { dialog: sel.shareDialog, username: to });
  if (!pick.found) {
    // Not in the recent list: type the name into the panel's search box, like a person.
    let box = null;
    for (const d of sel.shareDialog) for (const s of sel.shareSearch) {
      const l = page.locator(`${d} ${s}`).first();
      if (!box && await l.isVisible().catch(() => false)) box = l;
    }
    if (box) {
      await box.click();
      for (const ch of to) { await page.keyboard.type(ch); await sleep(70 + Math.random() * 140); }
      await sleep(1800);
      pick = await runScript<any>(page, 'shareSelect', { dialog: sel.shareDialog, username: to });
    }
  }
  if (!pick.found) {
    const s = await st();
    await page.keyboard.press('Escape').catch(() => {});
    return s.blocked ? { ok: false, kind: 'blocked', message: explain('blocked', to) } : { ok: false, kind: 'not_found', message: explain('not_found', to) };
  }
  await sleep(500 + Math.random() * 500);
  const pre = await st();
  if (pre.blocked) { await page.keyboard.press('Escape').catch(() => {}); return { ok: false, kind: 'blocked', message: explain('blocked', to) }; }
  const clicked = await runScript(page, 'shareClickText', { dialog: sel.shareDialog, texts: sel.shareSendTexts });
  if (!clicked) { await page.keyboard.press('Escape').catch(() => {}); return { ok: false, kind: 'ui', message: 'The Send button was not found or is disabled' }; }
  for (let i = 0; i < 12; i++) {
    await sleep(400);
    const s = await st();
    if (s.blocked) { await page.keyboard.press('Escape').catch(() => {}); return { ok: false, kind: 'blocked', message: explain('blocked', to) }; }
    if (s.sent || !s.open) { if (s.open) await page.keyboard.press('Escape').catch(() => {}); return { ok: true }; }
  }
  await page.keyboard.press('Escape').catch(() => {});
  return { ok: false, kind: 'ui', message: 'No confirmation after pressing Send' };
}

/**
 * Decide and (maybe) share one saved video. Returns what happened. `onBlocked` is told when TikTok
 * refuses the recipient, so the dashboard can explain what to do.
 */
export async function maybeShare(page: Page | null, cfg: any, t: ShareTarget, sessionId: number | null, score: number,
  hooks: { onBlocked?: (msg: string) => void; onGuard?: (detail: string) => Promise<void> } = {}): Promise<ShareResult> {
  const to = recipientOf(cfg);
  if (!cfg.enabled || !to || !t.url) return 'skipped';
  if (cfg.mode === 'score' && score < cfg.minScore) return 'skipped';
  if (sharedBefore(t.videoKey, to)) return 'skipped'; // never twice
  if (sharedToday() >= cfg.dailyCap) return 'skipped';
  if (cfg.requireApproval) { insert(t, cfg, 'pending', sessionId); log('info', 'share', `Share of ${t.url} to @${to} waits for your approval`); return 'pending'; }
  if (sharingPaused()) { // TikTok refused earlier today: don't keep trying; offer Telegram instead
    const tg = await telegramCopy(cfg, t, true);
    insert(t, cfg, 'blocked', sessionId, 'Sharing paused for today — see the message on the Status page');
    if (tg) getDb().prepare('UPDATE shares SET telegram = ? WHERE id = last_insert_rowid()').run(tg);
    return 'blocked';
  }
  const id = insert(t, cfg, 'sending', sessionId);
  return runShare(page!, cfg, t, id, hooks);
}

async function runShare(page: Page, cfg: any, t: ShareTarget, id: number, hooks: { onBlocked?: (msg: string) => void; onGuard?: (detail: string) => Promise<void> }): Promise<ShareResult> {
  const to = recipientOf(cfg);
  let r = await shareOnPage(page, to).catch((e: any) => ({ ok: false, kind: 'ui' as const, message: e.message }));
  if (!r.ok && r.kind === 'guard' && hooks.onGuard) { await hooks.onGuard(r.message!); r = await shareOnPage(page, to).catch((e: any) => ({ ok: false, kind: 'ui' as const, message: e.message })); }
  if (r.ok) {
    setStatus(id, 'done', null, await telegramCopy(cfg, t, false));
    log('info', 'share', `Sent ${t.url} to @${to}`);
    return 'done';
  }
  const tg = await telegramCopy(cfg, t, true);
  if (r.kind === 'not_found' || r.kind === 'blocked') {
    kvSet('sharePausedDay', zoned().day);
    setStatus(id, 'blocked', r.message!, tg);
    log('alert', 'share', r.message!);
    hooks.onBlocked?.(r.message!);
    return 'blocked';
  }
  if (r.kind === 'guard') { setStatus(id, 'needs_user', r.message!, tg); return 'needs_user'; }
  setStatus(id, 'failed', r.message!, tg);
  log('warn', 'share', `Could not share ${t.url}: ${r.message}`);
  return 'failed';
}

/** Share approved (or picks-mode) videos between sessions: open each video page, then Share → Send. */
export async function shareQueued(page: Page, cfg: any, hooks: { onBlocked?: (msg: string) => void } = {}) {
  const rows = getDb().prepare("SELECT * FROM shares WHERE status = 'approved' ORDER BY id").all() as any[];
  let n = 0;
  for (const row of rows) {
    if (sharingPaused()) break;
    if (alreadySent(row.video_key, row.recipient)) { setStatus(row.id, 'skipped', 'already sent'); continue; } // final check: never twice
    try { await page.goto(row.video_url, { waitUntil: 'domcontentloaded', timeout: 45_000 }); await sleep(2500); } catch (e: any) { setStatus(row.id, 'failed', e.message); continue; }
    if (await runShare(page, { ...cfg, to: row.recipient }, { videoKey: row.video_key, url: row.video_url, author: row.author }, row.id, hooks) === 'done') n++;
    await sleep(3000 + Math.random() * 4000);
  }
  return n;
}

/** Picks mode: queue today's picks once a day. */
export function queuePicks(cfg: any, picks: Array<{ video_key: string; url: string | null; author?: string; id?: number }>) {
  if (!cfg.enabled || cfg.mode !== 'picks') return 0;
  let n = 0;
  for (const p of picks) {
    if (!p.url || sharedBefore(p.video_key, recipientOf(cfg)) || sharedToday() >= cfg.dailyCap) continue;
    insert({ videoKey: p.video_key, url: p.url, author: p.author, videoRow: p.id }, cfg, cfg.requireApproval ? 'pending' : 'approved', null);
    n++;
  }
  return n;
}

export const listShares = (limit = 300) => getDb().prepare('SELECT * FROM shares ORDER BY id DESC LIMIT ?').all(limit);
export function approveShare(id: number) { getDb().prepare("UPDATE shares SET status = 'approved', error = NULL WHERE id = ? AND status IN ('pending', 'failed', 'blocked', 'needs_user')").run(id); }
export function rejectShare(id: number) { getDb().prepare("UPDATE shares SET status = 'rejected' WHERE id = ? AND status != 'done'").run(id); }
/** "Retry sharing" after you made the accounts follow each other. */
export function retryBlocked() {
  resumeSharing();
  // One entry per video + recipient (the newest), and never one that was already sent.
  return getDb().prepare(`UPDATE shares SET status = 'approved', error = NULL WHERE id IN (
      SELECT MAX(id) FROM shares s WHERE status IN ('blocked', 'failed', 'needs_user') AND day = ?
        AND NOT EXISTS (SELECT 1 FROM shares d WHERE d.video_key = s.video_key AND d.recipient = s.recipient AND d.status = 'done')
      GROUP BY video_key, recipient)`).run(zoned().day).changes;
}
