// Post performance from TikTok Studio's content list (scraper ported from 0xArtex/tiktok-mcp analyzePosts),
// stored as a time series, and summarised for tomorrow's planning.
import { getDb, kvGet, kvSet, nowIso } from '../db.ts';
import { BrowserManager, runScript } from '../browser/edge.ts';
import { getAppSettings } from '../settings/store.ts';
import { log } from '../log.ts';
import { profileOf } from './accounts.ts';
import { normCaption, postSelectors } from './upload.ts';

export async function refreshAnalytics(accountId: string) {
  const browser = new BrowserManager(() => profileOf(accountId));
  try {
    const page = await browser.ensure();
    const base = getAppSettings().browser.baseUrl.replace(/\/+$/, '');
    await page.goto(base + postSelectors().contentPath, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // Wait until rows render — an unrendered list must not be stored as "0 posts".
    let rows: any[] = [];
    for (let i = 0; i < 30; i++) {
      rows = await runScript<any[]>(page, 'studioRows').catch(() => []);
      if (rows.length) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    for (let i = 0, last = -1; i < 20 && rows.length !== last; i++) { // load more rows by scrolling
      last = rows.length;
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
      await new Promise(r => setTimeout(r, 1200));
      rows = await runScript<any[]>(page, 'studioRows').catch(() => rows);
    }
    if (!rows.length) throw new Error('No posts were found in TikTok Studio (not logged in, no posts yet, or the page changed)');
    const db = getDb(), at = nowIso();
    const ours = db.prepare("SELECT id, caption, post_id FROM creations WHERE account_id = ? AND status IN ('posted', 'scheduled_tiktok')").all(accountId) as any[];
    for (const r of rows) {
      const text = normCaption(r.caption);
      const c = ours.find(x => x.post_id === r.id) ?? ours.find(x => !x.post_id && x.caption && text.includes(normCaption(x.caption).slice(0, 24)));
      if (c) db.prepare('UPDATE creations SET post_id = COALESCE(post_id, ?), post_url = COALESCE(post_url, ?) WHERE id = ?').run(r.id, r.video_url, c.id);
      db.prepare('INSERT INTO metrics (account_id, video_id, video_url, caption, creation_id, at, views, likes, comments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(accountId, r.id, r.video_url, String(r.caption).slice(0, 300), c?.id ?? null, at, r.views, r.likes, r.comments);
    }
    kvSet(`analyticsAt:${accountId}`, at);
    log('info', 'analytics', `Read ${rows.length} posts for account ${accountId}`);
    return latestMetrics(accountId);
  } finally { await browser.close().catch(() => {}); }
}

export const analyticsAt = (accountId: string) => kvGet<string | null>(`analyticsAt:${accountId}`, null);

/** Latest sample per video (+ change since the previous sample). */
export function latestMetrics(accountId: string) {
  return (getDb().prepare(`SELECT m.*, c.title, c.script,
      (SELECT views FROM metrics p WHERE p.account_id = m.account_id AND p.video_id = m.video_id AND p.id < m.id ORDER BY p.id DESC LIMIT 1) AS prev_views
    FROM metrics m LEFT JOIN creations c ON c.id = m.creation_id
    WHERE m.id IN (SELECT MAX(id) FROM metrics WHERE account_id = ? GROUP BY video_id) ORDER BY m.video_id DESC`).all(accountId) as any[])
    .map(r => ({ ...r, hook: (() => { try { return JSON.parse(r.script || '{}').hook ?? null; } catch { return null; } })(), script: undefined }));
}

/** Text for the planning prompt: what worked and what didn't, from our own posts. */
export function performanceSummary(accountId: string | null, days: number): string {
  if (!accountId) return '(no account set)';
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = latestMetrics(accountId).filter(r => r.creation_id && r.at >= since);
  if (!rows.length) return '(no performance data yet)';
  const sorted = [...rows].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const fmt = (r: any) => `- "${r.title ?? r.caption}" — ${r.views ?? '?'} views, ${r.likes ?? '?'} likes, ${r.comments ?? '?'} comments${r.hook ? ` · hook: ${r.hook}` : ''}`;
  const avg = Math.round(rows.reduce((a, r) => a + (r.views ?? 0), 0) / rows.length);
  return [`${rows.length} of our videos in the last ${days} days, average ${avg} views.`, 'Best:', ...sorted.slice(0, 5).map(fmt),
    ...(sorted.length > 5 ? ['Weakest:', ...sorted.slice(-3).map(fmt)] : [])].join('\n');
}
