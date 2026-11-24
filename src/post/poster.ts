// Approval queue, posting slots and the three posting modes.
//   approval  → finished videos wait; you choose "post now" / "next slot" / a time
//   schedule  → approving assigns the next free posting time automatically
//   auto      → finished videos are approved and scheduled without you (warned in the UI)
import { EventEmitter } from 'node:events';
import { getDb, nowIso } from '../db.ts';
import { log } from '../log.ts';
import { getPreset, listPresets } from '../settings/store.ts';
import { dateAtMinute, hhmmToMin, zoned } from '../time.ts';
import { creator, getCreation } from '../create/pipeline.ts';
import { logins } from '../browser/login.ts';
import { getAccount, listAccounts, profileOf } from './accounts.ts';
import { uploadVideo } from './upload.ts';
import { analyticsAt, refreshAnalytics } from './analytics.ts';

const ACTIVE = ['approved', 'scheduled', 'posting', 'scheduled_tiktok', 'posted'];
const err = (m: string, statusCode = 400) => Object.assign(new Error(m), { statusCode });

export function postSettingsFor(c: any) {
  return (getPreset(c.preset_id) ?? listPresets()[0]).data.post;
}

/** Next free posting time for an account (respects times, max per day and taken slots). */
export function nextSlot(post: any, accountId: string, after = new Date(), leadMinutes = post.scheduleWith === 'tiktok' ? 20 : 1): Date | null {
  const times = [...post.times].sort();
  if (!times.length) return null;
  const db = getDb();
  const taken = (db.prepare(`SELECT post_at FROM creations WHERE account_id = ? AND post_at IS NOT NULL AND status IN (${ACTIVE.map(() => '?').join(',')})`).all(accountId, ...ACTIVE) as any[]).map(r => r.post_at as string);
  for (let d = 0; d < 10; d++) {
    const ref = new Date(after.getTime() + d * 86400_000);
    const day = zoned(ref).day;
    const usedToday = taken.filter(t => zoned(new Date(t)).day === day).length;
    if (usedToday >= post.maxPerDay) continue;
    for (const t of times) {
      const at = dateAtMinute(hhmmToMin(t), ref);
      if (at.getTime() < after.getTime() + leadMinutes * 60_000) continue;
      if (taken.some(x => Math.abs(new Date(x).getTime() - at.getTime()) < 60_000)) continue;
      return at;
    }
  }
  return null;
}

class Poster extends EventEmitter {
  private queue: Array<{ label: string; run: () => Promise<void> }> = [];
  private busy = false;
  current: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  private patch(id: number, p: Record<string, unknown>) { creator.patch(id, p); }
  private enqueue(label: string, run: () => Promise<void>) { this.queue.push({ label, run }); void this.pump(); }
  private async pump() {
    if (this.busy) return; this.busy = true;
    while (this.queue.length) {
      const j = this.queue.shift()!; this.current = j.label; this.emit('queue', this.state());
      try { await j.run(); } catch (e: any) { log('error', 'post', `${j.label}: ${e.message}`); }
    }
    this.current = null; this.busy = false; this.emit('queue', this.state());
  }
  state() { return { current: this.current, queued: this.queue.map(q => q.label) }; }

  /** Approve a finished video. when: 'now' | 'slot' | ISO time. */
  approve(id: number, opts: { when?: string; accountId?: string } = {}) {
    const c = getCreation(id);
    if (!c) throw err('Not found', 404);
    if (!['ready', 'post_failed'].includes(c.status)) throw err(`This video is ${c.status} — only finished videos can be approved`);
    const post = postSettingsFor(c);
    const accountId = opts.accountId || c.account_id || post.account;
    const account = accountId ? getAccount(accountId) : null;
    if (!account) throw err('Choose a TikTok account first (Post → Accounts, then pick it here or in the preset\'s Posting settings)');
    if (logins.status(account.profile).loggedIn === false) throw err(`Account "${account.name}" is not logged in — press Log in for it first`);
    const when = opts.when || 'slot';
    const base = { account_id: account.id, approved_at: nowIso(), post_error: null };
    if (when === 'now') {
      this.patch(id, { ...base, status: 'approved', stage: 'Posting now…', post_at: nowIso(), post_method: 'now' });
      this.enqueue(`Post #${id}`, () => this.post(id));
      return getCreation(id);
    }
    const at = when === 'slot' ? nextSlot(post, account.id) : new Date(when);
    if (!at || isNaN(at.getTime())) throw err('No free posting time in the next 10 days — add posting times or raise the daily maximum');
    if (when !== 'slot' && at.getTime() < Date.now() + 60_000) throw err('Pick a time in the future');
    if (post.scheduleWith === 'tiktok') {
      if (at.getTime() < Date.now() + 15 * 60_000 || at.getTime() > Date.now() + 10 * 86400_000) throw err("TikTok's scheduler needs a time 15 minutes to 10 days ahead");
      this.patch(id, { ...base, status: 'approved', stage: 'Uploading to TikTok with a schedule…', post_at: at.toISOString(), post_method: 'tiktok' });
      this.enqueue(`Schedule #${id} on TikTok`, () => this.post(id, at));
    } else {
      this.patch(id, { ...base, status: 'scheduled', stage: `Will be posted by this app at ${at.toLocaleString()}`, post_at: at.toISOString(), post_method: 'app' });
    }
    log('info', 'post', `Video #${id} approved for ${account.name} at ${at.toISOString()} (${post.scheduleWith})`);
    return getCreation(id);
  }

  reject(id: number) {
    const c = getCreation(id); if (!c) throw err('Not found', 404);
    if (['posting', 'scheduled_tiktok', 'posted'].includes(c.status)) throw err(`Already ${c.status}`);
    this.patch(id, { status: 'rejected', stage: 'Rejected — will not be posted' });
    return getCreation(id);
  }
  /** Back to the approval queue (app-scheduled, failed or rejected). TikTok-scheduled posts must be cancelled in TikTok Studio. */
  unschedule(id: number) {
    const c = getCreation(id); if (!c) throw err('Not found', 404);
    if (c.status === 'scheduled_tiktok') throw err('This one is already uploaded and scheduled on TikTok — cancel it in TikTok Studio');
    if (!['scheduled', 'post_failed', 'rejected', 'approved'].includes(c.status) || this.current === `Post #${id}`) throw err(`Can't move a ${c.status} video back`);
    this.patch(id, { status: 'ready', stage: 'Waiting for your approval', post_at: null, post_method: null, approved_at: null });
    return getCreation(id);
  }

  private async post(id: number, scheduleAt?: Date) {
    const c = getCreation(id);
    if (!c?.video_path || !c.account_id) return;
    const post = postSettingsFor(c);
    this.patch(id, { status: 'posting', stage: scheduleAt ? 'Uploading with TikTok schedule…' : 'Uploading to TikTok…' });
    const caption = [c.caption, (c.hashtags ?? []).map((h: string) => `#${h}`).join(' ')].filter(Boolean).join(' ');
    const r = await uploadVideo({ accountId: c.account_id, file: c.video_path, caption, privacy: post.privacy,
      allowComments: post.allowComments, allowDuet: post.allowDuet, allowStitch: post.allowStitch, scheduleAt });
    if (r.ok) {
      this.patch(id, scheduleAt
        ? { status: 'scheduled_tiktok', stage: `Uploaded — TikTok publishes it at ${scheduleAt.toLocaleString()}`, post_url: r.videoUrl ?? null, post_id: r.videoId ?? null }
        : { status: 'posted', stage: 'Posted', posted_at: nowIso(), post_url: r.videoUrl ?? null, post_id: r.videoId ?? null });
    } else {
      // A post that may have gone through must not be retried blindly.
      const unsure = r.code === 'NOT_CONFIRMED';
      this.patch(id, { status: 'post_failed', stage: unsure ? 'Not confirmed — check TikTok Studio before retrying' : 'Posting failed', post_error: r.error ?? 'failed' });
      log(r.needsUser ? 'alert' : 'error', 'post', `Video #${id}: ${r.error}`);
    }
  }

  async tick() {
    const db = getDb(), now = Date.now();
    // auto mode: approve finished videos without asking
    for (const c of db.prepare("SELECT id, preset_id FROM creations WHERE status = 'ready'").all() as any[]) {
      if (postSettingsFor(c).mode === 'auto') { try { this.approve(c.id, { when: 'slot' }); } catch (e: any) { log('warn', 'post', `Auto-post #${c.id}: ${e.message}`); } }
    }
    // app-scheduled posts that are due
    for (const c of db.prepare("SELECT id, post_at FROM creations WHERE status = 'scheduled' AND post_method = 'app'").all() as any[]) {
      if (new Date(c.post_at).getTime() <= now) { this.patch(c.id, { status: 'approved', stage: 'Posting…' }); this.enqueue(`Post #${c.id}`, () => this.post(c.id)); }
    }
    // TikTok-scheduled posts whose time has passed
    for (const c of db.prepare("SELECT id, post_at FROM creations WHERE status = 'scheduled_tiktok'").all() as any[]) {
      if (new Date(c.post_at).getTime() <= now) this.patch(c.id, { status: 'posted', stage: 'Published by TikTok\'s scheduler', posted_at: c.post_at });
    }
    // analytics refresh per account (using the shortest interval of the presets that post to it)
    for (const a of listAccounts()) {
      const posts = listPresets().map(p => p.data.post).filter(p => p.account === a.id && p.analytics.enabled);
      if (!posts.length || a.login.loggedIn === false) continue;
      const hours = Math.min(...posts.map(p => p.analytics.refreshHours));
      const last = analyticsAt(a.id);
      if (last && now - new Date(last).getTime() < hours * 3600_000) continue;
      if (this.queue.some(q => q.label === `Analytics ${a.id}`) || this.current === `Analytics ${a.id}`) continue;
      this.refresh(a.id);
    }
  }

  refresh(accountId: string) {
    if (!getAccount(accountId)) throw err('Account not found', 404);
    this.enqueue(`Analytics ${accountId}`, async () => { try { await refreshAnalytics(accountId); this.emit('analytics', accountId); } catch (e: any) { log('warn', 'analytics', e.message); } });
  }

  start() {
    const loop = async () => { try { await this.tick(); } catch (e: any) { log('warn', 'post', e.message); } this.timer = setTimeout(loop, 30_000); };
    this.timer = setTimeout(loop, 5000);
  }
  stop() { if (this.timer) clearTimeout(this.timer); }
}

export const poster = new Poster();
export { profileOf };
