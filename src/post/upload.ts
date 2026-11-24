// Upload a finished video through TikTok Studio in the account's own Edge profile.
// Flow ported from 0xArtex/tiktok-mcp (MIT) postVideo: caption → schedule → privacy → toggles →
// submit → confirm. Added: the AI-generated label, which is ALWAYS turned on and verified —
// if it can't be confirmed the upload is cancelled.
import path from 'node:path';
import fs from 'node:fs';
import type { Page } from 'playwright-core';
import { BrowserManager, runScript } from '../browser/edge.ts';
import { selectors } from '../browser/tiktok.ts';
import { getAppSettings } from '../settings/store.ts';
import { DEFAULT_POST_SELECTORS } from '../settings/schema.ts';
import { paths } from '../paths.ts';
import { log } from '../log.ts';
import { zoned } from '../time.ts';
import { until } from '../browser/wait.ts';
import { profileOf } from './accounts.ts';

export interface UploadRequest {
  accountId: string; file: string; caption: string;
  privacy: 'public' | 'friends' | 'private'; allowComments: boolean; allowDuet: boolean; allowStitch: boolean;
  scheduleAt?: Date; // TikTok native schedule
}
export interface UploadResult { ok: boolean; videoUrl?: string; videoId?: string; error?: string; code?: string; needsUser?: boolean }

export const postSelectors = (): typeof DEFAULT_POST_SELECTORS => {
  const c = getAppSettings().postSelectors;
  return { ...DEFAULT_POST_SELECTORS, ...(c && typeof c === 'object' ? c : {}) };
};
const base = () => getAppSettings().browser.baseUrl.replace(/\/+$/, '');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Editors turn spaces into non-breaking spaces etc. — compare captions loosely. */
export const normCaption = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function firstVisible(page: Page, list: string[], timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const s of list) {
      const loc = page.locator(s).first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    await sleep(500);
  }
  return null;
}

async function dismissModals(page: Page, ms = 6000) {
  const ps = postSelectors();
  const end = Date.now() + ms; let clear = 0;
  while (Date.now() < end && clear < 2) {
    const r = await runScript<any>(page, 'dismissModals', { labels: ps.modalDismissTexts, keep: [...ps.aiLabelTexts, 'scheduled posting'] }).catch(() => ({ open: 0 }));
    if (r.open && !r.kept) { clear = 0; if (!r.clicked) await page.keyboard.press('Escape').catch(() => {}); await sleep(600); } else { clear++; await sleep(400); }
  }
}

/** Fixed rule: turn on TikTok's AI-generated label and confirm it is on. */
export async function ensureAiLabel(page: Page): Promise<{ ok: boolean; error?: string }> {
  const ps = postSelectors();
  const read = () => runScript<any>(page, 'aiLabel', { texts: ps.aiLabelTexts, turnOn: false });
  let st = await until(async () => { const s = await read(); return s.found ? s : null; }, 3000);
  if (!st) { // the setting is behind "Show more"
    await until(() => runScript(page, 'clickByText', { texts: ps.showMoreTexts }), 5000);
    st = await until(async () => { const s = await read(); return s.found ? s : null; });
  }
  if (!st) return { ok: false, error: 'The "AI-generated content" setting did not appear within 10 s on the upload page' };
  if (st.checked !== true) {
    await runScript(page, 'aiLabel', { texts: ps.aiLabelTexts, turnOn: true });
    // a "Turn on" confirmation may appear: keep confirming until the switch reads ON (or 10 s pass)
    st = await until(async () => {
      await runScript(page, 'clickByText', { texts: ps.aiConfirmTexts, inDialog: true });
      const s = await read();
      return s.checked === true ? s : null;
    }) ?? await read();
  }
  return st.checked === true ? { ok: true } : { ok: false, error: 'Could not confirm the "AI-generated content" switch is on' };
}

/** Ported from 0xArtex/tiktok-mcp setPrivacy: open "Who can see this post", pick, verify. */
async function setPrivacy(page: Page, privacy: 'friends' | 'private'): Promise<{ ok: boolean; value?: string }> {
  const wanted = privacy === 'private' ? /only (you|me)/i : /friends/i;
  const label = page.getByText(/Who can see this post/i).first();
  if (!(await label.isVisible({ timeout: 4000 }).catch(() => false))) return { ok: false, value: 'label not found' };
  const row = label.locator('xpath=ancestor::*[.//button[@role="combobox"]][1]');
  const trigger = row.locator('button[role="combobox"]').first();
  await trigger.click({ timeout: 4000 }).catch(() => {});
  const opt = page.getByRole('option', { name: wanted }).first();
  if (!(await until(() => opt.isVisible().catch(() => false)))) { await page.keyboard.press('Escape').catch(() => {}); return { ok: false, value: 'option not found' }; }
  await opt.click({ timeout: 4000 }).catch(() => {});
  const shown = (await until(async () => { const s = String(await row.textContent().catch(() => '')).replace(/who can see this post/i, '').trim(); return wanted.test(s) ? s : null; }))
    ?? String(await row.textContent().catch(() => '')).replace(/who can see this post/i, '').trim();
  return { ok: wanted.test(shown), value: shown.slice(0, 40) };
}

/** Ported from 0xArtex/tiktok-mcp applySchedule (TikTok Studio's native scheduler). */
async function applySchedule(page: Page, when: Date): Promise<{ ok: boolean; error?: string }> {
  const z = zoned(when), [y, mo, d] = z.day.split('-');
  let hh = Math.floor(z.minutes / 60), mi = Math.round((z.minutes % 60) / 5) * 5;
  if (mi === 60) { mi = 0; hh = (hh + 1) % 24; }
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeStr = `${pad(hh)}:${pad(mi)}`, dateStr = `${y}-${mo}-${d}`;
  const sel = await page.evaluate(`(()=>{const r=document.querySelector('input[name="postSchedule"][value="schedule"]');if(!r)return 'no-radio';r.click();return 'ok';})()`).catch(() => 'err');
  if (sel !== 'ok') return { ok: false, error: "'Schedule' option not found" };
  await sleep(1100);
  await runScript(page, 'clickByText', { texts: ['Allow'] });
  await sleep(1200);
  await page.locator('button[aria-haspopup="dialog"]:not(.Select__trigger)').first().click({ timeout: 3000 }).catch(() => {});
  await sleep(800);
  const fields = page.locator('input.TUXTextInputCore-input');
  let t: any = null, dt: any = null;
  for (let a = 0; a < 4 && (!t || !dt); a++) {
    const n = await fields.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const v = String(await fields.nth(i).inputValue().catch(() => ''));
      if (/^\d{1,2}:\d{2}/.test(v)) t = fields.nth(i); else if (/^\d{4}-\d{2}-\d{2}/.test(v)) dt = fields.nth(i);
    }
    if (!t || !dt) await sleep(800);
  }
  if (!t || !dt) return { ok: false, error: 'date/time fields not found' };
  await dt.click().catch(() => {}); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
  await dt.pressSequentially(dateStr, { delay: 50 }); await page.keyboard.press('Enter'); await sleep(400); await page.keyboard.press('Escape').catch(() => {});
  await t.click().catch(() => {}); await sleep(700);
  const lists = page.locator('.tiktok-timepicker-option-list');
  await lists.nth(0).locator('.tiktok-timepicker-option-item', { hasText: new RegExp(`^${pad(hh)}$`) }).first().click({ timeout: 3000 }).catch(() => {});
  await sleep(300);
  await lists.nth(1).locator('.tiktok-timepicker-option-item', { hasText: new RegExp(`^${pad(mi)}$`) }).first().click({ timeout: 3000 }).catch(() => {});
  await sleep(300);
  await page.getByText(/Who can see this post/i).first().click({ timeout: 2000 }).catch(() => {});
  await sleep(300);
  const dv = String(await dt.inputValue().catch(() => '')), tv = String(await t.inputValue().catch(() => ''));
  if (!dv.startsWith(dateStr)) return { ok: false, error: `date shows "${dv}", expected ${dateStr}` };
  if (!tv.startsWith(timeStr)) return { ok: false, error: `time shows "${tv}", expected ${timeStr}` };
  return { ok: true };
}

/** Find the new post's URL in Studio's content list — only a caption match counts (never "newest"). */
async function findPosted(page: Page, caption: string): Promise<{ videoUrl?: string; videoId?: string }> {
  const ps = postSelectors();
  if (!new RegExp(ps.successUrl, 'i').test(page.url())) await page.goto(base() + ps.contentPath, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const key = normCaption(caption).slice(0, 24);
  for (let i = 0; i < 6; i++) {
    const rows = await runScript<any[]>(page, 'studioRows').catch(() => []);
    const hit = rows.find(r => normCaption(r.caption).includes(key));
    if (hit) return { videoUrl: hit.video_url, videoId: hit.id };
    await sleep(1500);
  }
  return {};
}

export async function uploadVideo(req: UploadRequest): Promise<UploadResult> {
  // Fixed rule: only our own rendered videos can be uploaded.
  const file = path.resolve(req.file);
  if (!file.startsWith(path.resolve(paths.renders) + path.sep) || !fs.existsSync(file)) return { ok: false, error: 'Only videos made by this app can be posted', code: 'NOT_OURS' };
  const ps = postSelectors();
  const browser = new BrowserManager(() => profileOf(req.accountId));
  try {
    const page = await browser.ensure();
    await page.goto(base() + ps.uploadPath, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Wait until either the upload page (file input) or a login / verification screen shows.
    await until(async () => (await page.locator(ps.fileInput.join(', ')).count().catch(() => 0)) > 0 || /\/login/.test(page.url())
      || !!(await runScript<any>(page, 'inspect', selectors()).catch(() => null))?.guard, 15_000);
    const guard = (await runScript<any>(page, 'inspect', selectors()).catch(() => null))?.guard;
    if (guard || /\/login/.test(page.url())) return { ok: false, needsUser: true, code: 'NEEDS_USER', error: guard?.kind === 'captcha' ? 'TikTok shows a verification check — open the account (Log in) and complete it yourself' : 'This account is not logged in — press Log in for it' };
    const input = page.locator(ps.fileInput.join(', ')).first();
    await input.waitFor({ state: 'attached', timeout: 30_000 });
    await input.setInputFiles(file);
    const caption = await firstVisible(page, ps.caption, 120_000);
    if (!caption) return { ok: false, code: 'UPLOAD_FAILED', error: 'The upload editor never appeared (video rejected, or the page changed — see Settings → Posting page selectors)' };
    await dismissModals(page);
    await caption.click();
    await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
    await caption.pressSequentially(req.caption, { delay: 12 });
    await page.keyboard.press('Escape').catch(() => {}); // close hashtag suggestions
    await sleep(500);
    if (req.scheduleAt) {
      const s = await applySchedule(page, req.scheduleAt);
      if (!s.ok) return { ok: false, code: 'SCHEDULE_FAILED', error: `Could not set TikTok's schedule (${s.error}) — cancelled so it doesn't post immediately` };
    }
    if (req.privacy !== 'public') {
      const p = await setPrivacy(page, req.privacy);
      if (!p.ok) return { ok: false, code: 'PRIVACY_FAILED', error: `Could not set who can see the post (${p.value}) — cancelled` };
    }
    for (const [allowed, key, text] of [[req.allowComments, 'comment', 'Comment'], [req.allowDuet, 'duet', 'Duet'], [req.allowStitch, 'stitch', 'Stitch']] as const) {
      if (!allowed) await page.locator(`[data-e2e="upload-switch-${key}"], label:has-text("${text}")`).first().click({ timeout: 2000 }).catch(() => {});
    }
    const ai = await ensureAiLabel(page);
    if (!ai.ok) return { ok: false, code: 'AI_LABEL_FAILED', error: `${ai.error}. The video was NOT posted (the AI-generated label is required).` };
    await dismissModals(page, 3000);
    let button = await firstVisible(page, ps.postButton, 10_000);
    if (!button) {
      const re = new RegExp(`^(${ps.postButtonTexts.map(esc).join('|')})$`, 'i');
      const byRole = page.getByRole('button', { name: re }).first();
      if (await byRole.isVisible().catch(() => false)) button = byRole;
    }
    if (!button) return { ok: false, code: 'UI_TIMEOUT', error: 'Post button not found' };
    // Re-check the label right before submitting.
    const again = await runScript<any>(page, 'aiLabel', { texts: ps.aiLabelTexts, turnOn: false });
    if (again.checked !== true) return { ok: false, code: 'AI_LABEL_FAILED', error: 'The AI-generated label turned off before posting — NOT posted' };
    const api = page.waitForResponse(r => /\/aweme\/v\d+\/(web\/)?aweme\/post/.test(r.url()), { timeout: 90_000 }).catch(() => null);
    await button.click({ timeout: 10_000 });
    const okText = new RegExp(`(${ps.successTexts.map(esc).join('|')})`, 'i');
    let confirmed = false;
    for (let i = 0; i < 90 && !confirmed; i++) {
      if (new RegExp(ps.successUrl, 'i').test(page.url())) confirmed = true;
      else if (await page.locator(`text=/your (video|post).*${okText.source}/i`).first().isVisible().catch(() => false)) confirmed = true;
      else if (await Promise.race([api, sleep(1000).then(() => undefined)])) {
        const r: any = await api; const j = await r.json().catch(() => ({}));
        if (r.ok() && (!j.status_code || j.status_code === 0)) confirmed = true;
        else return { ok: false, code: 'TIKTOK_ERROR', error: j.status_msg || `TikTok returned HTTP ${r.status()}` };
      }
    }
    if (!confirmed) return { ok: false, code: 'NOT_CONFIRMED', error: 'No confirmation from TikTok after pressing Post. Check TikTok Studio before retrying, so it is not posted twice.' };
    const found = await findPosted(page, req.caption);
    log('info', 'post', `Uploaded to account ${req.accountId}${req.scheduleAt ? ` (TikTok will publish at ${req.scheduleAt.toISOString()})` : ''}${found.videoUrl ? `: ${found.videoUrl}` : ''}`);
    return { ok: true, ...found };
  } catch (e: any) {
    return { ok: false, code: e?.code === 'PROFILE_IN_USE' ? 'PROFILE_IN_USE' : 'ERROR', error: e.message };
  } finally {
    await browser.close().catch(() => {});
  }
}
