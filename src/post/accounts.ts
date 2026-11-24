// Posting accounts. Each one has its own Edge profile (acct-<id>) so logins never mix.
import { randomUUID } from 'node:crypto';
import { getDb, nowIso } from '../db.ts';
import { logins } from '../browser/login.ts';
import { closeProfile, profileDirFor } from '../browser/edge.ts';
import fs from 'node:fs';

export interface Account { id: string; name: string; handle: string | null; created_at: string; notes: string | null; profile: string }
export const profileOf = (id: string) => `acct-${id}`;
const withProfile = (r: any): Account => ({ ...r, profile: profileOf(r.id) });

export function listAccounts(): Array<Account & { login: ReturnType<typeof logins.status> }> {
  return (getDb().prepare('SELECT * FROM accounts ORDER BY created_at').all() as any[]).map(withProfile).map(a => ({ ...a, login: logins.status(a.profile) }));
}
export function getAccount(id: string): Account | null {
  const r = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  return r ? withProfile(r) : null;
}
export function addAccount(name: string, handle?: string): Account {
  const id = randomUUID().slice(0, 8);
  getDb().prepare('INSERT INTO accounts (id, name, handle, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name.trim().slice(0, 60) || 'TikTok account', (handle ?? '').replace(/^@/, '').trim().slice(0, 60) || null, nowIso());
  return getAccount(id)!;
}
export function updateAccount(id: string, patch: { name?: string; handle?: string }) {
  const a = getAccount(id);
  if (!a) throw Object.assign(new Error('Account not found'), { statusCode: 404 });
  getDb().prepare('UPDATE accounts SET name = ?, handle = ? WHERE id = ?')
    .run(patch.name?.trim().slice(0, 60) || a.name, patch.handle !== undefined ? patch.handle.replace(/^@/, '').trim().slice(0, 60) || null : a.handle, id);
  return getAccount(id)!;
}
/** Remove the account; optionally delete its Edge profile (its TikTok login). */
export async function removeAccount(id: string, deleteProfile: boolean) {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
  if (deleteProfile) { await closeProfile(profileOf(id)); fs.rmSync(profileDirFor(profileOf(id)), { recursive: true, force: true }); }
}
