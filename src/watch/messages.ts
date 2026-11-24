// Reply to private messages (Engage → Private messages, off by default).
// Opens TikTok's Messages page in the account's Edge window (same CDP approach), reads unread chats,
// drafts a reply with the AI and either queues it for approval or types it like a person.
// Fixed safety rules below are NOT settings.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Page } from 'playwright-core';
import { getDb, kvGet, kvSet, nowIso } from '../db.ts';
import { log } from '../log.ts';
import { runScript } from '../browser/edge.ts';
import { selectors } from '../browser/tiktok.ts';
import { chatJson } from '../llm/client.ts';
import { getPrompt, render } from '../settings/prompts.ts';
import { getAppSettings, getMemory } from '../settings/store.ts';
import { zoned } from '../time.ts';
import { until, captureDebug } from '../browser/wait.ts';

export interface ChatMessage { mine: boolean; text: string }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ fixed safety rules
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|my|io|ly|me|co|gg|xyz|app|link|shop)\b)/i;
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/;
const EMAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
const CODE = /\b\d{4,}\b/;
const ASKS_SENSITIVE = /\b(phone|number|nombor|no\.? ?(tel|fon|hp)|whatsapp|wassap|telegram|wechat|line id|address|alamat|password|kata laluan|otp|tac|verification code|kod|code|bank|akaun bank|account number|ic number|ic no|pay|payment|bayar|transfer|pindah(an)?|money|duit|wang|loan|pinjam|rm ?\d+|\$ ?\d+|price|harga|deal|collab(oration)?|sponsor|meet|meetup|jumpa|ketemu|date|where do you live|tinggal di mana|rumah)\b/i;
const ABUSIVE = /\b(fuck|f\*ck|shit|bitch|bastard|asshole|bodoh|babi|sial|pukimak|puki|lancau|bangsat|celaka|stupid|idiot|kill yourself|kys|die)\b/i;
const SPAM = /\b(crypto|bitcoin|btc|forex|invest(ment)?|profit|giveaway|free followers|followers? for free|promo code|click (the )?link|earn \$|earn rm|f4f|l4l|follow back for|check my (bio|profile)|onlyfans|telegram me)\b/i;
const HUMAN_CLAIM = /\b(i'?m|i am|saya|aku)\s+(a\s+|seorang\s+)?(real\s+)?(human|person|manusia|orang (sebenar|betul|biasa))\b/i;
const MONEY_DEAL = /\b(rm ?\d|\$ ?\d|pay(ment)?|bayar|transfer|bank|deal|setuju|agree to meet|jumpa (di|kat)|meet (you|up))\b/i;

/** Incoming text → why it must not be answered automatically (or null). */
export function screenIncoming(text: string): { status: 'spam' | 'flagged'; reason: string } | null {
  if (ABUSIVE.test(text)) return { status: 'flagged', reason: 'abusive or threatening message' };
  if (SPAM.test(text) || LINK.test(text)) return { status: 'spam', reason: 'looks like spam / a scam (link or promo)' };
  if (ASKS_SENSITIVE.test(text) || PHONE.test(text) || EMAIL.test(text)) return { status: 'flagged', reason: 'asks for or contains personal details, money, a deal or a meeting' };
  return null;
}
/** Draft text → which fixed rule it breaks (or null). */
export function screenDraft(text: string): string | null {
  if (!text.trim()) return 'empty reply';
  if (text.length > 400) return 'too long';
  if (LINK.test(text)) return 'contains a link';
  if (PHONE.test(text) || CODE.test(text)) return 'contains a number that looks like a phone number or code';
  if (EMAIL.test(text)) return 'contains an email address';
  if (MONEY_DEAL.test(text)) return 'mentions money, a deal or a meeting';
  if (HUMAN_CLAIM.test(text) && !/\b(not|bukan|tak|tidak)\b/i.test(text)) return 'claims to be human';
  return null;
}

const hashOf = (...parts: string[]) => createHash('sha1').update(parts.join('\u0001')).digest('hex').slice(0, 20);
const today = () => zoned().day;

function upsert(account: string, conv: string, name: string | null, hash: string, incoming: string, status: string, fields: { reply?: string | null; reason?: string | null; error?: string | null } = {}) {
  getDb().prepare(`INSERT INTO messages (at, day, account, conversation, name, msg_hash, incoming, reply, status, reason, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account, conversation, msg_hash) DO NOTHING`).run(nowIso(), today(), account, conv, name, hash, incoming.slice(0, 2000), fields.reply ?? null, status, fields.reason ?? null, fields.error ?? null);
}
const setRow = (id: number, p: Record<string, unknown>) => {
  const keys = Object.keys(p);
  getDb().prepare(`UPDATE messages SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => p[k] as any), id);
};

export interface MsgHooks { alert: (kind: string, message: string) => void }
export class StepError extends Error { step: string; constructor(step: string, message: string) { super(message); this.step = step; } }

/** Type the reply into the open chat like a person, send it and check it appeared. */
async function typeAndSend(page: Page, text: string) {
  const sel = selectors();
  const input = await until(async () => {
    for (const s of sel.msgInput) { const l = page.locator(s).first(); if (await l.isVisible().catch(() => false)) return l; }
    return null;
  });
  if (!input) throw new StepError('message box', 'The message box did not appear within 10 s (msgInput selectors)');
  await input.click();
  await sleep(300 + Math.random() * 400);
  for (const ch of text) { await page.keyboard.type(ch); await sleep(40 + Math.random() * 110); }
  await sleep(400 + Math.random() * 500);
  let sent = false;
  for (const s of sel.msgSend) { const l = page.locator(s).first(); if (await l.isVisible().catch(() => false)) { await l.click().catch(() => {}); sent = true; break; } }
  if (!sent) await page.keyboard.press('Enter');
  const appeared = await until(async () => {
    const chat = await runScript<any>(page, 'msgChat', sel).catch(() => null);
    const last = [...(chat?.messages ?? [])].reverse().find((m: ChatMessage) => m.mine);
    return !!last && last.text.includes(text.slice(0, 20));
  });
  if (!appeared) throw new StepError('reply appeared', 'The reply did not appear in the chat within 10 s after sending');
}

const pageLoaded = (page: Page, sel: any) => page.evaluate(`(${JSON.stringify(sel.msgPage)}).some(s => { try { return [...document.querySelectorAll(s)].some(e => e.getBoundingClientRect().height > 0); } catch (e) { return false; } })`).catch(() => false);

/** Open Messages and WAIT for it (up to ~10 s); login / captcha screens stop here. */
async function openMessages(page: Page) {
  const b = getAppSettings().browser, sel = selectors();
  await page.goto(b.baseUrl.replace(/\/+$/, '') + b.messagesPath, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const state = await until(async () => {
    const guard = (await runScript<any>(page, 'inspect', sel).catch(() => null))?.guard;
    if (guard) return { guard: guard.detail };
    if (/\/login/.test(page.url())) return { guard: 'Not logged in on this account — press Log in' };
    return (await pageLoaded(page, sel)) ? { ok: true } : null;
  });
  if (state?.guard) throw new StepError('open Messages', `${state.guard} — handle it in the Edge window yourself`);
  if (!state) throw new StepError('read conversations', 'The Messages page did not load as expected within 10 s (msgPage selectors) — is the address in Settings → Browser → Messages page right?');
}

/** Conversation list; waits for it to fill (an empty inbox is not an error). */
async function readList(page: Page, sel: any): Promise<any[]> {
  const list = await until(async () => { const l = await runScript<any[]>(page, 'msgList', sel).catch(() => null); return l && l.length ? l : null; }, 10_000);
  return list ?? [];
}

/** Click conversation `index` and WAIT until its chat (header or messages) is shown. */
async function openChat(page: Page, sel: any, index: number, name: string) {
  const before = await runScript<any>(page, 'msgChat', sel).catch(() => null);
  if (!(await runScript(page, 'msgOpen', { sel, index }))) throw new StepError('open conversation', `Could not click the chat with ${name}`);
  const chat = await until(async () => {
    const c = await runScript<any>(page, 'msgChat', sel).catch(() => null);
    if (!c || !c.messages.length) return null;
    const changed = !before || before.username !== c.username || JSON.stringify(before.messages.slice(-2)) !== JSON.stringify(c.messages.slice(-2));
    return changed || !before?.messages?.length ? c : null;
  });
  if (!chat) throw new StepError('read chat', `The chat with ${name} did not show any messages within 10 s (msgItem / msgMine / msgText selectors)`);
  return chat;
}

async function isFriend(page: Page, username: string): Promise<boolean> {
  const key = `friend:${username}:${today()}`;
  const cached = kvGet<boolean | null>(key, null);
  if (cached !== null) return cached;
  const sel = selectors(), b = getAppSettings().browser;
  const back = page.url();
  await page.goto(`${b.baseUrl.replace(/\/+$/, '')}/@${encodeURIComponent(username)}`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  const txt = await until(async () => {
    const t = await page.evaluate(`[...document.querySelectorAll('button,[role="button"]')].map(b => (b.textContent || '').trim()).join('|')`).catch(() => '') as string;
    return /follow|ikut|friends|rakan|message|mesej/i.test(t) ? t : null;
  }) ?? '';
  const yes = sel.msgFriendTexts.some(t => txt.split('|').includes(t));
  kvSet(key, yes);
  await openMessages(page);
  return yes;
}

/** One inbox check. Returns counts; throws StepError with the failing step. */
export async function checkInbox(page: Page, cfg: any, account: string, hooks: MsgHooks) {
  const sel = selectors();
  const out = { conversations: 0, replied: 0, pending: 0, ignored: 0, flagged: 0 };
  await openMessages(page);
  let list = await readList(page, sel);
  const unread = list.filter(c => c.unread).slice(0, 15);
  for (const conv of unread) {
    out.conversations++;
    const chat = await openChat(page, sel, conv.index, conv.name);
    const username = String(chat.username || conv.username || conv.name).replace(/^@/, '').toLowerCase();
    const msgs: ChatMessage[] = chat.messages;
    const lastMine = msgs.map(m => m.mine).lastIndexOf(true);
    const pending = msgs.slice(lastMine + 1).filter(m => !m.mine);
    if (!pending.length) continue;
    const incoming = pending.map(m => m.text).join('\n');
    const hash = hashOf(username, msgs.slice(0, lastMine + 1).map(m => m.text).slice(-3).join('|'), incoming);
    if (getDb().prepare('SELECT 1 FROM messages WHERE account = ? AND conversation = ? AND msg_hash = ?').get(account, username, hash)) continue; // never twice
    // who may get a reply
    const allowList = (cfg.allowList as string[]).map(u => u.replace(/^@/, '').toLowerCase());
    const allowed = cfg.who === 'anyone' ? true : cfg.who === 'allowlist' ? allowList.includes(username) : await isFriend(page, username);
    if (!allowed) { upsert(account, username, conv.name, hash, incoming, 'ignored', { reason: cfg.who === 'allowlist' ? 'not on your allow-list' : 'not a friend (mutual follow)' }); out.ignored++; continue; }
    const screen = screenIncoming(incoming);
    if (screen) {
      upsert(account, username, conv.name, hash, incoming, screen.status, { reason: screen.reason });
      if (screen.status === 'flagged') { out.flagged++; hooks.alert('messages', `Message from @${username} needs you (${screen.reason}). The agent did not reply. Read it in TikTok yourself.`); }
      else out.ignored++;
      continue;
    }
    const sentToday = (getDb().prepare("SELECT COUNT(*) n FROM messages WHERE day = ? AND status IN ('sent', 'pending', 'approved')").get(today()) as any).n;
    const lastHour = (getDb().prepare("SELECT COUNT(*) n FROM messages WHERE conversation = ? AND status = 'sent' AND sent_at > ?").get(username, new Date(Date.now() - 3600_000).toISOString()) as any).n;
    if (sentToday >= cfg.dailyCap || lastHour >= cfg.perConversationPerHour) {
      upsert(account, username, conv.name, hash, incoming, 'capped', { reason: sentToday >= cfg.dailyCap ? `daily cap (${cfg.dailyCap}) reached` : `max ${cfg.perConversationPerHour} replies per hour to @${username}` });
      continue;
    }
    const history = msgs.slice(-15).map(m => `${m.mine ? 'Me' : 'Them'}: ${m.text}`).join('\n');
    const { json } = await chatJson({ step: 'analyze', system: render(getPrompt('message_reply'), { persona: getMemory().persona, style: cfg.style, username, history, incoming }) });
    const flag = String(json?.flag ?? 'none');
    const reply = String(json?.reply ?? '').trim();
    if (flag === 'spam') { upsert(account, username, conv.name, hash, incoming, 'spam', { reason: json?.reason ?? 'AI: spam' }); out.ignored++; continue; }
    if (flag === 'sensitive' || flag === 'abusive') {
      upsert(account, username, conv.name, hash, incoming, 'flagged', { reason: `AI: ${json?.reason ?? flag}` }); out.flagged++;
      hooks.alert('messages', `Message from @${username} needs you (${json?.reason ?? flag}). The agent did not reply.`);
      continue;
    }
    const broken = screenDraft(reply);
    if (broken) {
      upsert(account, username, conv.name, hash, incoming, 'flagged', { reply, reason: `The AI's draft broke a safety rule (${broken}) — not sent` }); out.flagged++;
      hooks.alert('messages', `A reply draft to @${username} broke a safety rule (${broken}) and was not sent.`);
      continue;
    }
    // Only the newest draft per chat may be answered (older ones are retired, so no double replies).
    getDb().prepare("UPDATE messages SET status = 'superseded', reason = 'newer messages arrived before approval' WHERE account = ? AND conversation = ? AND status IN ('pending', 'approved')").run(account, username);
    if (cfg.requireApproval) { upsert(account, username, conv.name, hash, incoming, 'pending', { reply }); out.pending++; log('info', 'messages', `Reply to @${username} waits for your approval`); continue; }
    upsert(account, username, conv.name, hash, incoming, 'sending', { reply });
    const row = getDb().prepare('SELECT id FROM messages WHERE account = ? AND conversation = ? AND msg_hash = ?').get(account, username, hash) as any;
    try {
      await typeAndSend(page, reply);
      setRow(row.id, { status: 'sent', sent_at: nowIso() }); out.replied++;
      log('info', 'messages', `Replied to @${username}`);
    } catch (e: any) {
      setRow(row.id, { status: 'failed', error: `${e.step ?? 'send'}: ${e.message}` });
      throw e;
    }
  }
  return out;
}

/** Send replies you approved: open each chat by name and type the (possibly edited) reply. */
export async function sendApproved(page: Page, account: string) {
  const rows = getDb().prepare("SELECT * FROM messages WHERE account = ? AND status = 'approved' ORDER BY id").all(account) as any[];
  if (!rows.length) return 0;
  const sel = selectors();
  let n = 0;
  await openMessages(page);
  for (const r of rows) {
    const screen = screenDraft(r.reply ?? '');
    if (screen) { setRow(r.id, { status: 'flagged', reason: `Edited reply breaks a safety rule (${screen}) — not sent` }); continue; }
    const list = await readList(page, sel);
    const conv = list.find(c => (c.username ?? '').toLowerCase() === r.conversation || c.name === r.name || c.name.toLowerCase().includes(r.conversation));
    if (!conv) { setRow(r.id, { status: 'failed', error: `open conversation: @${r.conversation} not found in the list` }); continue; }
    try { await openChat(page, sel, conv.index, conv.name); await typeAndSend(page, r.reply); setRow(r.id, { status: 'sent', sent_at: nowIso(), error: null }); n++; }
    catch (e: any) { setRow(r.id, { status: 'failed', error: `${e.step ?? 'send'}: ${e.message}` }); }
    await sleep(2000 + Math.random() * 3000);
  }
  return n;
}

export const listMessages = (limit = 300) => getDb().prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?').all(limit);
export function approveMessage(id: number, text?: string) {
  if (typeof text === 'string' && text.trim()) getDb().prepare('UPDATE messages SET reply = ? WHERE id = ?').run(text.trim().slice(0, 400), id);
  getDb().prepare("UPDATE messages SET status = 'approved', error = NULL WHERE id = ? AND status IN ('pending', 'failed')").run(id);
}
export function rejectMessage(id: number) { getDb().prepare("UPDATE messages SET status = 'rejected' WHERE id = ? AND status IN ('pending', 'failed', 'approved')").run(id); }

export const messagesBus = new EventEmitter();

/** "Test inbox now": open Messages and read it step by step WITHOUT sending anything. */
export async function testInbox(page: Page) {
  const sel = selectors();
  const steps: Array<{ step: string; ok: boolean; detail?: string }> = [];
  const done = async (ok: boolean) => ({ ok, steps, url: page.url(), ...(await captureDebug(page, 'inbox-test', sel.msgPage)) });
  try {
    await openMessages(page);
    steps.push({ step: 'Messages page loaded', ok: true, detail: page.url() });
  } catch (e: any) { steps.push({ step: e.step ?? 'open Messages', ok: false, detail: e.message }); return done(false); }
  const list = await readList(page, sel);
  steps.push({ step: 'conversation list read', ok: list.length > 0, detail: list.length ? `${list.length} chat(s), ${list.filter(c => c.unread).length} unread: ${list.slice(0, 5).map(c => `${c.name}${c.username ? ` (@${c.username})` : ''}${c.unread ? ' •unread' : ''}`).join(', ')}` : 'No conversations found (msgConversation selectors) — or the inbox is empty' });
  if (!list.length) return done(false);
  // Prefer a chat that is already read: opening an unread one marks it read on TikTok, and the real
  // check only answers unread chats.
  const target = list.find(c => !c.unread) ?? list[0];
  if (target.unread) steps.push({ step: 'note', ok: true, detail: `Only unread chats exist — opening "${target.name}" marks it as read, so it won't be answered automatically` });
  try {
    const chat = await openChat(page, sel, target.index, target.name);
    steps.push({ step: 'chat opened', ok: true, detail: `with ${chat.username ? `@${chat.username}` : `"${target.name}" (username not found — msgHeaderLink)`}, ${chat.messages.length} message(s). Last: ${chat.messages.slice(-3).map((m: ChatMessage) => `${m.mine ? 'Me' : 'Them'}: ${m.text.slice(0, 60)}`).join(' | ')}` });
    // Every message looking like OURS is impossible in a chat with something to read → msgMine matches too much.
    if (chat.messages.every((m: ChatMessage) => m.mine)) steps.push({ step: 'mine / theirs told apart', ok: false, detail: 'Every message looks like it was sent by you — the msgMine selectors match too much' });
  } catch (e: any) { steps.push({ step: e.step ?? 'chat opened', ok: false, detail: e.message }); return done(false); }
  const box = await until(async () => { for (const s of sel.msgInput) if (await page.locator(s).first().isVisible().catch(() => false)) return s; return null; });
  steps.push({ step: 'message box found', ok: !!box, detail: box ? `${box} (nothing was typed or sent)` : 'Not found within 10 s (msgInput selectors)' });
  return done(steps.every(s => s.ok));
}
