// Share saved videos to your main TikTok account with TikTok's own Share → Send to, in the watcher's
// Edge window (same idea as dsh-douyin-agent's autonomous share). Never twice for the same video.
// Every decision is written to History → Shares — including every skip and why.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { getDb, kvGet, kvSet, nowIso } from '../db.ts';
import { log } from '../log.ts';
import { paths } from '../paths.ts';
import { runScript } from '../browser/edge.ts';
import { selectors } from '../browser/tiktok.ts';
import { getAppSettings } from '../settings/store.ts';
import { sendTelegram, telegramConfigured } from '../notify.ts';
import { zoned } from '../time.ts';

export interface ShareTarget { videoKey: string; url: string | null; author?: string; videoRow?: number | null }
export type ShareResult = 'done' | 'pending' | 'queued' | 'skipped' | 'failed' | 'blocked' | 'needs_user';
export interface Step { step: string; ok: boolean; detail?: string }
export interface ShareRun { ok: boolean; kind?: 'not_found' | 'blocked' | 'guard' | 'ui'; message?: string; steps: Step[]; url?: string | null; screenshot?: string; panelText?: string }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const recipientOf = (cfg: any) => String(cfg?.to || '').replace(/^@/, '').trim();
const ACTIVE = ['done', 'pending', 'approved', 'queued', 'sending', 'blocked', 'failed', 'needs_user'];

export function explain(kind: 'not_found' | 'blocked', to: string) {
  return kind === 'not_found'
    ? `Couldn't find @${to} in TikTok's "Send to" list. TikTok only lets you send videos to people you can message: on the watcher's TikTok account follow @${to}, and on @${to} follow the watcher account back (mutual follow). Then press "Retry sharing".`
    : `TikTok won't let the watcher account message @${to}. Make the two accounts follow each other (watcher follows @${to}, and @${to} follows the watcher back), check @${to}'s message settings allow messages from friends, then press "Retry sharing".`;
}

/** A share that is still active (or done) for this video + recipient → never create another one. */
const sharedBefore = (key: string, to: string) => !!getDb().prepare(`SELECT 1 FROM shares WHERE video_key = ? AND recipient = ? AND status IN (${ACTIVE.map(() => '?').join(',')})`).get(key, to, ...ACTIVE);
const alreadySent = (key: string, to: string) => !!getDb().prepare("SELECT 1 FROM shares WHERE video_key = ? AND recipient = ? AND status = 'done'").get(key, to);
const sharedToday = () => (getDb().prepare("SELECT COUNT(*) n FROM shares WHERE day = ? AND status IN ('done', 'pending', 'approved', 'queued', 'sending')").get(zoned().day) as any).n as number;
export const sharingPaused = () => kvGet<string | null>('sharePausedDay', null) === zoned().day;
export const resumeSharing = () => kvSet('sharePausedDay', null);

function insert(t: ShareTarget, cfg: any, status: string, sessionId: number | null, error: string | null = null, mode?: string) {
  const author = t.author || t.url?.match(/\/@([^/?#]+)/)?.[1] || null;
  return Number(getDb().prepare('INSERT INTO shares (at, day, session_id, video_row, video_key, video_url, author, recipient, mode, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(nowIso(), zoned().day, sessionId, t.videoRow ?? null, t.videoKey, t.url, author, recipientOf(cfg) || '?', mode ?? cfg?.mode ?? null, status, error).lastInsertRowid);
}
const setStatus = (id: number, status: string, error: string | null = null, telegram?: string, url?: string | null) =>
  getDb().prepare('UPDATE shares SET status = ?, error = ?, telegram = COALESCE(?, telegram), video_url = COALESCE(?, video_url), at = ? WHERE id = ?')
    .run(status, error, telegram ?? null, url ?? null, nowIso(), id);
const skip = (t: ShareTarget, cfg: any, sessionId: number | null, why: string) => { insert(t, cfg, 'skipped', sessionId, `skipped: ${why}`); log('info', 'share', `Not shared (${why}): ${t.url ?? t.videoKey}`); return 'skipped' as const; };

async function telegramCopy(cfg: any, t: ShareTarget, failed: boolean): Promise<string | undefined> {
  if (!cfg?.telegram || cfg.telegram === 'off' || (cfg.telegram === 'on_failure' && !failed) || !t.url) return undefined;
  if (!telegramConfigured()) return 'not set up';
  try { await sendTelegram(`🎬 Saved TikTok${t.author ? ` by @${t.author}` : ''}:\n${t.url}`); return 'sent'; } catch (e: any) { log('warn', 'share', e.message); return `failed: ${e.message}`; }
}

/**
 * Run Share → (Copy link) → Send to → recipient → Send on the page that shows the video, recording every
 * step. With `debug`, a failing step also saves a screenshot and the visible share-panel text.
 */
export async function shareOnPage(page: Page, to: string, opts: { wantLink?: boolean; debug?: boolean } = {}): Promise<ShareRun> {
  const sel = selectors();
  const steps: Step[] = [];
  const st = () => runScript<any>(page, 'shareState', { dialog: sel.shareDialog, blocked: sel.shareBlockedTexts, notFound: sel.shareNotFoundTexts, sent: sel.shareSentTexts });
  const fail = async (step: string, kind: ShareRun['kind'], message: string): Promise<ShareRun> => {
    steps.push({ step, ok: false, detail: message });
    const out: ShareRun = { ok: false, kind, message, steps };
    if (opts.debug) {
      try {
        const file = path.join(paths.media, `share-debug-${Date.now()}.jpg`);
        fs.writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 70 }));
        out.screenshot = `/media/${path.basename(file)}`;
      } catch { /* screenshot is best effort */ }
      out.panelText = (await st().catch(() => ({ text: '' }))).text;
    }
    await page.keyboard.press('Escape').catch(() => {});
    return out;
  };
  const openPanel = async () => {
    const o = await runScript<any>(page, 'shareOpen', { selectors: sel.shareButton });
    if (!o.found) return false;
    await sleep(900 + Math.random() * 600);
    return (await st()).open;
  };
  const guard = (await runScript<any>(page, 'inspect', sel).catch(() => null))?.guard;
  if (guard) return fail('page check', 'guard', guard.detail);
  const found = await runScript<any>(page, 'shareOpen', { selectors: sel.shareButton });
  if (!found.found) return fail('share button found', 'ui', 'Share button not found (Settings → TikTok page selectors: shareButton)');
  steps.push({ step: 'share button found', ok: true });
  await sleep(900 + Math.random() * 600);
  if (!(await st()).open) return fail('panel opened', 'ui', 'The share panel did not open (shareDialog selectors)');
  steps.push({ step: 'panel opened', ok: true });
  let url: string | null = null;
  if (opts.wantLink) { // the link wasn't readable from the feed: use the panel's "Copy link"
    if (await runScript(page, 'shareCopyLink', { dialog: sel.shareDialog, texts: sel.shareCopyLinkTexts })) {
      await sleep(600);
      url = await runScript<string | null>(page, 'shareCopyLink', { read: true });
    }
    steps.push({ step: 'copy link', ok: !!url, detail: url ?? 'no link copied' });
    if (!(await st()).open && !(await openPanel())) return fail('panel opened again', 'ui', 'The share panel closed after Copy link and did not reopen');
  }
  const sendTo = await runScript(page, 'shareClickText', { dialog: sel.shareDialog, texts: sel.shareSendToTexts.filter(t => !sel.shareSendTexts.includes(t)) });
  steps.push({ step: '"Send to" found', ok: true, detail: sendTo ? `clicked "${sendTo}"` : 'no separate "Send to" button (list shown directly)' });
  await sleep(700);
  let pick = await runScript<any>(page, 'shareSelect', { dialog: sel.shareDialog, username: to });
  let how = 'in the recent list';
  if (!pick.found) {
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
      how = 'typed into the panel search';
    } else how = 'no search box in the panel';
  }
  if (!pick.found) {
    const s = await st();
    return s.blocked ? fail('recipient found', 'blocked', explain('blocked', to)) : fail('recipient found', 'not_found', explain('not_found', to));
  }
  steps.push({ step: 'recipient found', ok: true, detail: `@${to} ${how}` });
  await sleep(500 + Math.random() * 500);
  if ((await st()).blocked) return fail('recipient allowed', 'blocked', explain('blocked', to));
  const clicked = await runScript(page, 'shareClickText', { dialog: sel.shareDialog, texts: sel.shareSendTexts });
  if (!clicked) return fail('Send clicked', 'ui', 'The Send button was not found or is disabled (shareSendTexts)');
  steps.push({ step: 'Send clicked', ok: true });
  for (let i = 0; i < 12; i++) {
    await sleep(400);
    const s = await st();
    if (s.blocked) return fail('confirmed', 'blocked', explain('blocked', to));
    if (s.sent || !s.open) {
      if (s.open) await page.keyboard.press('Escape').catch(() => {});
      steps.push({ step: 'confirmed', ok: true, detail: s.sent ? `"${s.sent}" shown` : 'panel closed after Send' });
      return { ok: true, steps, url };
    }
  }
  return fail('confirmed', 'ui', 'No confirmation after pressing Send (shareSentTexts)');
}

type Hooks = { onBlocked?: (msg: string) => void; onGuard?: (detail: string) => Promise<void> };

/**
 * Decide what to do with one saved video and ALWAYS record it. If the video is still on screen it is
 * shared right away; otherwise it is queued and sent from its own page after the session.
 */
export async function planShare(page: Page | null, cfg: any, t: ShareTarget, sessionId: number | null, score: number, inView: boolean, hooks: Hooks = {}): Promise<ShareResult> {
  const to = recipientOf(cfg);
  if (!cfg?.enabled) return skip(t, cfg, sessionId, 'sharing is off (Save → Share saved videos)');
  if (!to) return skip(t, cfg, sessionId, 'no username set in "Send to"');
  if (cfg.mode === 'picks') return skip(t, cfg, sessionId, "mode is \"Today's picks\" — it's sent with the picks once a day");
  if (cfg.mode === 'score' && score < cfg.minScore) return skip(t, cfg, sessionId, `score ${score} is below ${cfg.minScore}`);
  if (sharedBefore(t.videoKey, to)) return skip(t, cfg, sessionId, 'duplicate (already shared or queued)');
  if (sharedToday() >= cfg.dailyCap) return skip(t, cfg, sessionId, `daily cap reached (${cfg.dailyCap})`);
  if (cfg.requireApproval) {
    if (!t.url && !inView) { insert(t, cfg, 'failed', sessionId, 'No video link could be read and the video left the screen'); return 'failed'; }
    insert(t, cfg, 'pending', sessionId); log('info', 'share', `Share to @${to} waits for your approval`); return 'pending';
  }
  if (sharingPaused()) {
    const id = insert(t, cfg, 'blocked', sessionId, 'Sharing is paused for today — see the message on the Status page');
    const tg = await telegramCopy(cfg, t, true); if (tg) setStatus(id, 'blocked', 'Sharing is paused for today — see the message on the Status page', tg);
    return 'blocked';
  }
  if (!inView || !page) {
    if (!t.url) { insert(t, cfg, 'failed', sessionId, 'No video link could be read from the feed and the video left the screen before it could be shared'); return 'failed'; }
    insert(t, cfg, 'queued', sessionId, 'The video left the screen — it will be sent from its own page after this session');
    log('info', 'share', `Queued ${t.url} (video left the screen)`);
    return 'queued';
  }
  const id = insert(t, cfg, 'sending', sessionId);
  return runShare(page, cfg, t, id, hooks, !t.url);
}

async function runShare(page: Page, cfg: any, t: ShareTarget, id: number, hooks: Hooks, wantLink = false): Promise<ShareResult> {
  const to = recipientOf(cfg);
  let r = await shareOnPage(page, to, { wantLink }).catch((e: any) => ({ ok: false, kind: 'ui' as const, message: e.message, steps: [] } as ShareRun));
  if (!r.ok && r.kind === 'guard' && hooks.onGuard) { await hooks.onGuard(r.message!); r = await shareOnPage(page, to, { wantLink }).catch((e: any) => ({ ok: false, kind: 'ui' as const, message: e.message, steps: [] } as ShareRun)); }
  const url = r.url ?? t.url;
  if (r.ok) {
    setStatus(id, 'done', null, await telegramCopy(cfg, { ...t, url }, false), url);
    log('info', 'share', `Sent ${url ?? t.videoKey} to @${to}`);
    return 'done';
  }
  const tg = await telegramCopy(cfg, { ...t, url }, true);
  const where = r.steps?.length ? ` (failed at: ${r.steps.at(-1)!.step})` : '';
  if (r.kind === 'not_found' || r.kind === 'blocked') {
    kvSet('sharePausedDay', zoned().day);
    setStatus(id, 'blocked', r.message!, tg, url);
    log('alert', 'share', r.message!);
    hooks.onBlocked?.(r.message!);
    return 'blocked';
  }
  if (r.kind === 'guard') { setStatus(id, 'needs_user', r.message!, tg, url); return 'needs_user'; }
  setStatus(id, 'failed', `${r.message}${where}`, tg, url);
  log('warn', 'share', `Could not share ${url ?? t.videoKey}: ${r.message}${where}`);
  return 'failed';
}

/** Send queued / approved shares from each video's own page (between sessions). */
export async function shareQueued(page: Page, cfg: any, hooks: Hooks = {}) {
  const rows = getDb().prepare("SELECT * FROM shares WHERE status IN ('approved', 'queued') ORDER BY id").all() as any[];
  let n = 0;
  for (const row of rows) {
    if (sharingPaused()) break;
    if (alreadySent(row.video_key, row.recipient)) { setStatus(row.id, 'skipped', 'skipped: duplicate (already sent)'); continue; } // final check: never twice
    if (!row.video_url) { setStatus(row.id, 'failed', 'No video link to open'); continue; }
    try { await page.goto(row.video_url, { waitUntil: 'domcontentloaded', timeout: 45_000 }); await sleep(2500); } catch (e: any) { setStatus(row.id, 'failed', `Could not open the video page: ${e.message}`); continue; }
    setStatus(row.id, 'sending');
    if (await runShare(page, { ...cfg, to: row.recipient }, { videoKey: row.video_key, url: row.video_url, author: row.author }, row.id, hooks) === 'done') n++;
    await sleep(3000 + Math.random() * 4000);
  }
  return n;
}

/** Picks mode: queue today's picks once a day. */
export function queuePicks(cfg: any, picks: Array<{ video_key: string; url: string | null; author?: string; id?: number }>) {
  if (!cfg?.enabled || cfg.mode !== 'picks') return 0;
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

/** "Retry" on one failed or skipped share. */
export function retryShare(id: number) {
  const row = getDb().prepare('SELECT * FROM shares WHERE id = ?').get(id) as any;
  if (!row) throw Object.assign(new Error('Share not found'), { statusCode: 404 });
  if (row.status === 'done') throw Object.assign(new Error('Already sent'), { statusCode: 409 });
  if (!row.video_url) throw Object.assign(new Error("No link for this video was read, so it can't be opened again"), { statusCode: 400 });
  if (alreadySent(row.video_key, row.recipient)) throw Object.assign(new Error('This video was already sent to that account'), { statusCode: 409 });
  if (sharingPaused()) resumeSharing();
  getDb().prepare("UPDATE shares SET status = 'queued', error = NULL, at = ? WHERE id = ?").run(nowIso(), id);
}

/** "Retry sharing" after you made the accounts follow each other. */
export function retryBlocked() {
  resumeSharing();
  return getDb().prepare(`UPDATE shares SET status = 'approved', error = NULL WHERE id IN (
      SELECT MAX(id) FROM shares s WHERE status IN ('blocked', 'failed', 'needs_user') AND day = ? AND video_url IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM shares d WHERE d.video_key = s.video_key AND d.recipient = s.recipient AND d.status = 'done')
      GROUP BY video_key, recipient)`).run(zoned().day).changes;
}

/** "Test share now": open one saved video and run the whole flow while you watch, step by step. */
export async function testShare(page: Page, cfg: any, videoUrl?: string): Promise<ShareRun & { video: string | null }> {
  const to = recipientOf(cfg);
  if (!to) throw Object.assign(new Error('Set "Send to" first'), { statusCode: 400 });
  const url = videoUrl ?? (getDb().prepare("SELECT url FROM videos WHERE saved = 1 AND url LIKE '%/video/%' ORDER BY id DESC LIMIT 1").get() as any)?.url
    ?? (getDb().prepare("SELECT video_url url FROM shares WHERE video_url LIKE '%/video/%' ORDER BY id DESC LIMIT 1").get() as any)?.url ?? null;
  if (!url) throw Object.assign(new Error('No saved video with a link yet — run a watching session first'), { statusCode: 400 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await sleep(2500);
  const r = await shareOnPage(page, to, { debug: true });
  const key = url.match(/\/video\/(\d+)/)?.[1] ?? url;
  insert({ videoKey: key, url }, cfg, r.ok ? 'done' : 'failed', null, r.ok ? null : `Test: ${r.message}`, 'test');
  log(r.ok ? 'info' : 'warn', 'share', `Test share to @${to}: ${r.ok ? 'sent' : r.message}`);
  return { ...r, video: url };
}

export const shareBase = () => getAppSettings().browser.baseUrl;
