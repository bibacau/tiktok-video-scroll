// Settings never go blank, never overwrite other sections, and stale saves are refused (UI + API).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright-core';

const BROWSER = process.env.BROWSER_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(p => fs.existsSync(p));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-setui-'));
const PORT = 8093, URL_ = `http://127.0.0.1:${PORT}`;
let server: ChildProcess, browser: Browser;

const api = async (method: string, p: string, body?: unknown, client = 'test-client') => {
  const r = await fetch(URL_ + p, { method, headers: { 'content-type': 'application/json', 'x-client-id': client }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json() as any };
};
const preset = async () => { const r = (await api('GET', '/api/presets')).json; return { p: r.presets[0], v: r.versions[r.presets[0].id] }; };
const fieldInput = (page: Page, label: string) => page.locator('.field', { hasText: label }).locator('input, textarea, select').first();
const saved = (page: Page) => page.locator('.saveind.saved').waitFor({ timeout: 8000 });

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.ts'], { env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), NO_SCHEDULER: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_ + '/api/info')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 250)); }
  if (BROWSER) browser = await chromium.launch({ executablePath: BROWSER, args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] });
});
after(async () => { await browser?.close(); server?.kill(); });

test('switching directly between preset tabs never shows another tab\'s data; saving one keeps the others', { skip: !BROWSER && 'no browser' }, async () => {
  const page = await browser.newPage();
  await page.goto(`${URL_}/#watch`);
  const instr = fieldInput(page, 'Watch instructions');
  await instr.fill('UI TEST: Malaysian desserts only');
  await saved(page);
  await page.click('nav a[href="#schedule"]');
  const total = fieldInput(page, 'Total watch time per day');
  assert.equal(await total.inputValue(), '60', 'Schedule shows its own value, not empty');
  await total.fill('95');
  await saved(page);
  await page.click('nav a[href="#watch"]');
  assert.equal(await fieldInput(page, 'Watch instructions').inputValue(), 'UI TEST: Malaysian desserts only', 'Watch intact');
  await page.click('nav a[href="#save"]');
  assert.equal(await fieldInput(page, 'Number of "Today\'s picks"').inputValue(), '5');
  const { p } = await preset();
  assert.equal(p.data.watch.instructions, 'UI TEST: Malaysian desserts only');
  assert.equal(p.data.schedule.dailyMinutes, 95);
  assert.equal(p.data.save.picksCount, 5);
  await page.close();
});

test('two clients editing different sections both survive; a stale save is refused with 409', async () => {
  const { p, v } = await preset(); // both "clients" loaded the page at the same time
  const a = await api('PATCH', `/api/presets/${p.id}/sections/watch`, { value: { ...p.data.watch, instructions: 'from the phone' }, version: v.watch }, 'phone');
  const b = await api('PATCH', `/api/presets/${p.id}/sections/schedule`, { value: { ...p.data.schedule, sessions: 4 }, version: v.schedule }, 'pc');
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const now = (await preset()).p;
  assert.equal(now.data.watch.instructions, 'from the phone');
  assert.equal(now.data.schedule.sessions, 4);
  assert.equal(now.data.schedule.dailyMinutes, 95, 'untouched fields kept');
  const stale = await api('PATCH', `/api/presets/${p.id}/sections/watch`, { value: { ...p.data.watch, instructions: 'old tab' }, version: v.watch }, 'old-tab');
  assert.equal(stale.status, 409);
  assert.match(stale.json.error, /changed elsewhere/);
  assert.equal((await preset()).p.data.watch.instructions, 'from the phone');
  assert.equal((await api('PUT', '/api/app-settings', {})).status, 410, 'whole-settings saves are gone');
});

test('saving AI & Prompts never changes Settings or Budget groups', { skip: !BROWSER && 'no browser' }, async () => {
  const before = (await api('GET', '/api/app-settings')).json;
  const g = (await api('PATCH', '/api/app-settings/groups/budget', { value: { ...before.budget, dailyCapRM: 7.5 }, version: before._versions.budget })).json;
  assert.equal(g.settings.budget.dailyCapRM, 7.5);
  const mid = (await api('GET', '/api/app-settings')).json;
  const page = await browser.newPage();
  await page.goto(`${URL_}/#ai`);
  await fieldInput(page, 'Request timeout').fill('120');
  await saved(page);
  const after = (await api('GET', '/api/app-settings')).json;
  assert.equal(after.llm.timeoutSeconds, 120);
  for (const k of ['budget', 'general', 'browser', 'media', 'tools', 'selectors', 'postSelectors']) assert.deepEqual(after[k], mid[k], `${k} unchanged`);
  assert.equal(after.budget.dailyCapRM, 7.5);
  await page.close();
});

test('another dashboard updates live; saved API keys are shown as saved', { skip: !BROWSER && 'no browser' }, async () => {
  const page = await browser.newPage();
  await page.goto(`${URL_}/#schedule`);
  await fieldInput(page, 'Total watch time per day').waitFor();
  const { p, v } = await preset();
  await api('PATCH', `/api/presets/${p.id}/sections/schedule`, { value: { ...p.data.schedule, dailyMinutes: 33 }, version: v.schedule }, 'someone-else');
  await page.waitForFunction(() => [...document.querySelectorAll('.field')].some(f => f.textContent!.includes('Total watch time per day') && (f.querySelector('input') as HTMLInputElement)?.value === '33'), null, { timeout: 8000 });
  const s = (await api('GET', '/api/app-settings')).json;
  await api('PATCH', '/api/app-settings/groups/llm', { value: { ...s.llm, apiKey: 'sk-abcdefgh12345678' }, version: s._versions.llm });
  await page.goto(`${URL_}/#ai`);
  await page.locator('.secretok', { hasText: '✓ Saved (sk-…5678)' }).first().waitFor({ timeout: 8000 });
  const info = (await api('GET', '/api/info')).json;
  assert.equal(info.dataDir, DATA);
  await page.close();
});

test('the TikTok page selectors box (JSON) really persists after paste + save + reload', { skip: !BROWSER && 'no browser' }, async () => {
  const page = await browser.newPage();
  await page.goto(`${URL_}/#settings`);
  const box = page.locator('.field', { hasText: 'TikTok page selectors' }).locator('textarea').first();
  await box.waitFor();
  const current = JSON.parse(await box.inputValue());
  // also change another field on the same page just before, like a real editing session
  await fieldInput(page, 'Exchange rate').fill('4.33');
  const mine = { ...current, shareButton: ["path[d^='M23.82 3.5']"], myExtra: ['div.mine'] };
  await box.fill('{ "broken": ');              // half-pasted, invalid
  await page.waitForTimeout(400);
  await box.fill(JSON.stringify(mine, null, 2)); // full paste
  await saved(page);
  await page.waitForTimeout(2500);               // any late autosave / live update must not revert it
  await page.reload();
  const again = page.locator('.field', { hasText: 'TikTok page selectors' }).locator('textarea').first();
  await again.waitFor();
  const shown = JSON.parse(await again.inputValue());
  assert.deepEqual(shown.shareButton, ["path[d^='M23.82 3.5']"]);
  assert.deepEqual(shown.myExtra, ['div.mine']);
  const s = (await api('GET', '/api/app-settings')).json;
  assert.deepEqual(s.selectors.shareButton, ["path[d^='M23.82 3.5']"]);
  assert.equal(s.general.currencyRate, 4.33);
  await page.close();
});

test('JSON box: curly quotes / trailing commas are repaired and saved; invalid JSON is shown loudly, never silently lost', { skip: !BROWSER && 'no browser' }, async () => {
  const page = await browser.newPage();
  await page.goto(`${URL_}/#settings`);
  const box = page.locator('.field', { hasText: 'TikTok page selectors' }).locator('textarea').first();
  await box.waitFor();
  const cur = JSON.parse(await box.inputValue());
  const pasted = JSON.stringify({ ...cur, myExtra: ['div.pasted'] }, null, 2).replace('"div.pasted"', '“div.pasted”,'); // curly quotes + trailing comma
  await box.fill(pasted);
  await saved(page);
  assert.deepEqual((await api('GET', '/api/app-settings')).json.selectors.myExtra, ['div.pasted']);
  await box.fill('{ "shareButton": [ "a", ');
  await page.locator('.saveind.error', { hasText: 'Invalid JSON' }).waitFor({ timeout: 5000 });
  assert.equal(await page.locator('.savebar.show').count(), 1, 'save bar shows the problem');
  assert.deepEqual((await api('GET', '/api/app-settings')).json.selectors.myExtra, ['div.pasted'], 'old value still in use');
  page.once('dialog', d => d.dismiss());
  await page.click('nav a[href="#status"]');
  await page.waitForTimeout(500);
  assert.match(page.url(), /#settings/, 'leaving with invalid JSON asks first (and stays when you cancel)');
  await page.close();
});
