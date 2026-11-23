// "Log in to TikTok": open the agent's profile in a normal, non-automated window and notice when
// the login is done by looking at the profile's cookie database (names + expiry only; values are
// never read — they are encrypted by the browser anyway).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { kvGet, kvSet, nowIso } from '../db.ts';
import { log } from '../log.ts';
import { getAppSettings } from '../settings/store.ts';
import { profileDirFor, profileProcesses, profileState, startPlainBrowser, closeProfile } from './edge.ts';

export interface LoginStatus { profile: string; loggedIn: boolean | null; cookies: string[]; checkedAt: string | null; window: 'open' | 'closed'; waiting: boolean; message: string }

/** Session cookies present in the profile (null = could not read the database right now). */
export function readLoginCookies(profileName: string): string[] | null {
  const dir = profileDirFor(profileName);
  const db = [path.join(dir, 'Default', 'Network', 'Cookies'), path.join(dir, 'Default', 'Cookies')].find(f => fs.existsSync(f));
  if (!db) return [];
  const b = getAppSettings().browser;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-cookies-'));
  try {
    // Copy first: the browser keeps the live file locked.
    for (const ext of ['', '-wal', '-journal']) if (fs.existsSync(db + ext)) fs.copyFileSync(db + ext, path.join(tmp, 'Cookies' + ext));
    const conn = new DatabaseSync(path.join(tmp, 'Cookies'), { readOnly: true });
    try {
      const nowChrome = BigInt(Date.now()) * 1000n + 11644473600n * 1_000_000n; // µs since 1601 (too big for a JS number)
      const domain = b.loginCookieDomain.replace(/^\./, '');
      const names: string[] = b.loginCookieNames;
      const stmt = conn.prepare(`SELECT name, expires_utc FROM cookies WHERE (host_key = ? OR host_key = ? OR host_key LIKE ?) AND name IN (${names.map(() => '?').join(',') || "''"})`);
      stmt.setReadBigInts(true);
      const rows = stmt.all(domain, '.' + domain, '%.' + domain, ...names) as Array<{ name: string; expires_utc: bigint }>;
      return [...new Set(rows.filter(r => r.expires_utc === 0n || r.expires_utc > nowChrome).map(r => r.name))];
    } finally { conn.close(); }
  } catch (e: any) { log('debug', 'login', `Cookie check failed: ${e.message}`); return null; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

class LoginWatcher extends EventEmitter {
  private watching = new Map<string, NodeJS.Timeout>();

  status(profile: string): LoginStatus {
    const saved = kvGet<{ loggedIn: boolean | null; cookies: string[]; checkedAt: string | null }>(`login:${profile}`, { loggedIn: null, cookies: [], checkedAt: null });
    const waiting = this.watching.has(profile);
    return { profile, ...saved, window: waiting ? 'open' : 'closed', waiting,
      message: waiting ? 'Login window is open — log in there (QR code, phone or email). Detection can take up to 30 seconds; closing the window also finishes it.'
        : saved.loggedIn ? 'Logged in' : saved.loggedIn === false ? 'Not logged in' : 'Not checked yet' };
  }

  /** Check the cookie database now. */
  check(profile: string): LoginStatus {
    const names = readLoginCookies(profile);
    if (names !== null) {
      const before = kvGet<any>(`login:${profile}`, {}).loggedIn;
      kvSet(`login:${profile}`, { loggedIn: names.length > 0, cookies: names, checkedAt: nowIso() });
      if (names.length && before !== true) log('info', 'login', `TikTok login detected for profile "${profile}"`);
    }
    const st = this.status(profile);
    this.emit('status', st);
    return st;
  }

  /** Open the normal login window and watch for the login to complete. */
  async open(profile: string, opts: { url?: string; agentBusy?: boolean } = {}) {
    const state = await profileState(profile);
    if (state.state === 'agent') {
      if (opts.agentBusy) throw Object.assign(new Error('The agent is using this profile right now. Stop the session first.'), { statusCode: 409 });
      await closeProfile(profile); // idle agent window → reopen it as a normal window
    }
    if (state.state !== 'busy') {
      const b = getAppSettings().browser;
      await startPlainBrowser(profile, opts.url ?? `${b.baseUrl.replace(/\/+$/, '')}${b.loginPath}`);
    }
    this.watch(profile);
    return this.status(profile);
  }

  private watch(profile: string) {
    if (this.watching.has(profile)) return;
    const dir = profileDirFor(profile);
    const started = Date.now();
    const tick = async () => {
      const st = this.check(profile);
      const open = (await profileProcesses(dir)).length > 0;
      if (!open || Date.now() - started > 60 * 60_000 || (st.loggedIn && st.cookies.length && Date.now() - started > 2000 && !open)) {
        // The browser writes cookies to disk while shutting down: check a few more times.
        let final = this.check(profile);
        for (const wait of [1500, 3500]) { if (final.loggedIn) break; await new Promise(r => setTimeout(r, wait)); final = this.check(profile); }
        this.watching.delete(profile);
        final = this.check(profile);
        if (!final.loggedIn) log('warn', 'login', `Login window for "${profile}" closed — not logged in`);
        return;
      }
      this.watching.set(profile, setTimeout(tick, 3000));
    };
    this.watching.set(profile, setTimeout(tick, 2000));
    this.emit('status', this.status(profile));
  }
}

export const logins = new LoginWatcher();
