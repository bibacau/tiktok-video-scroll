// Private messages: allow-list, approval, no double replies, fixed safety rules (fake TikTok Messages page).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeTikTok, startMockLlm, inbox, dmSent } from './fixture/fake-sites.ts';

const BROWSER = process.env.BROWSER_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(p => fs.existsSync(p));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-msg-'));
let tt: Awaited<ReturnType<typeof startFakeTikTok>>, llm: Awaited<ReturnType<typeof startMockLlm>>, m: any;
const rows = () => m.db.prepare('SELECT * FROM messages ORDER BY id').all();
const setMsg = (patch: Record<string, unknown>) => {
  const p = m.store.listPresets()[0];
  p.data.engagement.messages = { ...p.data.engagement.messages, ...patch };
  m.store.updatePreset(p.id, { data: p.data });
};

before(async () => {
  llm = await startMockLlm();
  tt = await startFakeTikTok(0, {});
  (await import('../src/paths.ts')).ensureDirs();
  m = {
    store: await import('../src/settings/store.ts'), controller: (await import('../src/runtime/controller.ts')).controller,
    db: (await import('../src/db.ts')).getDb(), msg: await import('../src/watch/messages.ts'),
  };
  const app = m.store.getAppSettings();
  app.browser = { ...app.browser, channel: 'custom', executablePath: BROWSER, headless: true, baseUrl: tt.url, messagesPath: '/messages' };
  app.llm = { ...app.llm, baseUrl: llm.url, apiKey: 'sk-test-123456789', retries: 0 };
  app.budget = { ...app.budget, dailyCapRM: 0, monthlyCapRM: 0 };
  m.store.saveAppSettings(app);
  inbox.convs = [
    { user: 'bibacau', name: 'Biba', unread: true, messages: [{ mine: false, text: 'Hai! Video tadi best. Ada resepi lain?' }] },
    { user: 'stranger99', name: 'Stranger', unread: true, messages: [{ mine: false, text: 'hello can reply?' }] },
  ];
});
after(async () => { await m?.controller.shutdown(); tt?.close(); llm?.close(); });

test('off by default; allow-listed sender gets a typed reply, others are ignored; never twice', { skip: !BROWSER && 'no browser', timeout: 180_000 }, async () => {
  const d = m.store.listPresets()[0].data.engagement.messages;
  assert.equal(d.enabled, false); assert.equal(d.requireApproval, true); assert.deepEqual(d.allowList, ['bibacau']); assert.equal(d.who, 'allowlist');
  setMsg({ enabled: true, requireApproval: false });
  const r = await m.controller.checkInboxNow();
  assert.equal(r.error, undefined, r.error);
  assert.equal(dmSent.length, 1);
  assert.equal(dmSent[0].to, 'bibacau');
  assert.equal(dmSent[0].text, 'Terima kasih! Nanti saya kongsi resepi baru 😊');
  assert.ok(dmSent[0].keys >= 30, 'typed key by key');
  const all = rows();
  assert.equal(all.find((x: any) => x.conversation === 'bibacau').status, 'sent');
  assert.equal(all.find((x: any) => x.conversation === 'stranger99').status, 'ignored');
  assert.match(all.find((x: any) => x.conversation === 'stranger99').reason, /allow-list/);
  // check again (chat marked unread again by TikTok, e.g. re-opened) → no second reply
  inbox.convs[0].unread = true;
  await m.controller.checkInboxNow();
  assert.equal(dmSent.length, 1, 'no double reply');
});

test('approval mode: the draft waits; approve (edited) → sent; reject → never sent', { skip: !BROWSER && 'no browser', timeout: 180_000 }, async () => {
  setMsg({ requireApproval: true });
  inbox.convs[0].messages.push({ mine: false, text: 'Bila nak upload video baru?' }); inbox.convs[0].unread = true;
  await m.controller.checkInboxNow();
  const pend = rows().filter((x: any) => x.status === 'pending');
  assert.equal(pend.length, 1);
  assert.equal(dmSent.length, 1, 'nothing sent before approval');
  m.msg.approveMessage(pend[0].id, 'Esok insya-Allah! 😊');
  await m.controller.checkInboxNow();
  assert.equal(dmSent.length, 2);
  assert.equal(dmSent[1].text, 'Esok insya-Allah! 😊');
  assert.equal(rows().find((x: any) => x.id === pend[0].id).status, 'sent');
  inbox.convs[0].messages.push({ mine: false, text: 'Ok noted' }); inbox.convs[0].unread = true;
  await m.controller.checkInboxNow();
  const p2 = rows().filter((x: any) => x.status === 'pending');
  m.msg.rejectMessage(p2[0].id);
  await m.controller.checkInboxNow();
  assert.equal(dmSent.length, 2, 'rejected draft never sent');
});

test('asking for a phone number is refused and flagged; a draft with a link is blocked', { skip: !BROWSER && 'no browser', timeout: 180_000 }, async () => {
  setMsg({ requireApproval: false });
  m.controller.dismissAlert();
  inbox.convs[0].messages.push({ mine: false, text: 'Boleh bagi nombor telefon awak?' }); inbox.convs[0].unread = true;
  await m.controller.checkInboxNow();
  const f = rows().at(-1);
  assert.equal(f.status, 'flagged');
  assert.match(f.reason, /personal details/);
  assert.equal(m.controller.status.alert?.kind, 'messages');
  assert.match(m.controller.status.alert.message, /@bibacau needs you/);
  assert.equal(dmSent.length, 2, 'no reply sent');
  // the AI's draft contains a link → blocked by the fixed rules
  inbox.convs[0].messages.push({ mine: true, text: 'Maaf, tak boleh kongsi di sini.' });
  inbox.convs[0].messages.push({ mine: false, text: 'Ada website resepi? LINKTEST' }); inbox.convs[0].unread = true;
  // LINKTEST itself is not a link, so the message passes the incoming screen; the draft is what breaks the rule
  await m.controller.checkInboxNow();
  const g = rows().at(-1);
  assert.equal(g.status, 'flagged');
  assert.match(g.reason, /safety rule \(contains a link\)/);
  assert.equal(dmSent.length, 2);
});

test('fixed rules: screening of incoming messages and drafts', () => {
  const { screenIncoming, screenDraft } = m.msg;
  assert.equal(screenIncoming('Hai, apa khabar?'), null);
  assert.equal(screenIncoming('Free followers! click the link bit.ly/abc').status, 'spam');
  assert.equal(screenIncoming('kau ni bodoh').status, 'flagged');
  assert.equal(screenIncoming('Jom jumpa esok?').status, 'flagged');
  assert.equal(screenIncoming('Send me RM50').status, 'flagged');
  assert.equal(screenDraft('Terima kasih! 😊'), null);
  assert.match(screenDraft('Call me 012-345 6789'), /phone/);
  assert.match(screenDraft('Ya, saya manusia sebenar'), /human/);
  assert.equal(screenDraft('Saya bukan manusia, saya dibantu AI'), null);
  assert.match(screenDraft('Boleh, transfer RM20 dulu'), /money/);
  assert.match(screenDraft('Kod saya 123456'), /code/);
});

test('when the Messages page can\'t be read, the failing step is shown on the dashboard', { skip: !BROWSER && 'no browser', timeout: 120_000 }, async () => {
  const app = m.store.getAppSettings(); app.browser.messagesPath = '/nothing-here'; m.store.saveAppSettings(app);
  inbox.convs[0].unread = true;
  const r = await m.controller.checkInboxNow();
  assert.match(r.error, /"read conversations" failed: The Messages page did not load/);
  assert.equal(m.controller.status.alert?.kind, 'messages_error');
  app.browser.messagesPath = '/messages'; m.store.saveAppSettings(app);
});
