import { getDb, nowIso } from '../db.ts';
import { getAppSettings } from '../settings/store.ts';
import { zoned } from '../time.ts';
import { log } from '../log.ts';
import { DEFAULT_PRICING } from '../settings/schema.ts';

export class BudgetExceeded extends Error { code = 'BUDGET_EXCEEDED'; }

interface Price { provider: string; model: string; inputCacheHit: number; inputCacheMiss: number; output: number }

function priceFor(provider: string, model: string): Price {
  const user: Price[] = Array.isArray(getAppSettings().budget.pricing) ? getAppSettings().budget.pricing : [];
  const exact = (t: Price[]) => t.find(p => p.provider === provider && p.model === model);
  const hit = exact(user) ?? exact(DEFAULT_PRICING as Price[]);
  if (hit) return hit;
  const table = [...user, ...(DEFAULT_PRICING as Price[])];
  return table.find(p => p.provider === provider && p.model === '*')
    ?? table.find(p => p.model === 'deepseek-chat')
    ?? { provider, model, inputCacheHit: 0, inputCacheMiss: 0, output: 0 };
}

export interface TokenUsage { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }

/** Record token usage and its cost. */
export function recordTokens(provider: string, model: string, step: string, u: TokenUsage = {}) {
  const prompt = u.prompt_tokens ?? 0, completion = u.completion_tokens ?? 0;
  const cached = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? Math.max(0, prompt - cached);
  const p = priceFor(provider, model);
  const usd = (cached * p.inputCacheHit + miss * p.inputCacheMiss + completion * p.output) / 1_000_000;
  return recordCost(provider, model, step, usd, { prompt, cached, completion });
}

/** Record any spend in USD (TTS, images, stock APIs...). */
export function recordCost(provider: string, model: string | null, step: string, usd: number, t: { prompt?: number; cached?: number; completion?: number; units?: number } = {}) {
  const rate = getAppSettings().general.currencyRate, z = zoned();
  getDb().prepare(`INSERT INTO usage (at, day, month, provider, model, step, prompt_tokens, cached_tokens, completion_tokens, units, cost_usd, cost_rm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(nowIso(), z.day, z.month, provider, model, step, t.prompt ?? 0, t.cached ?? 0, t.completion ?? 0, t.units ?? 0, usd, usd * rate);
  return usd * rate;
}

export function spentRM(scope: 'day' | 'month', key = scope === 'day' ? zoned().day : zoned().month): number {
  const r = getDb().prepare(`SELECT COALESCE(SUM(cost_rm), 0) AS rm FROM usage WHERE ${scope} = ?`).get(key) as any;
  return r.rm;
}

/** Throws BudgetExceeded when a cap is hit. Call before every paid request. */
export function assertBudget() {
  const { dailyCapRM, monthlyCapRM } = getAppSettings().budget;
  const day = spentRM('day'), month = spentRM('month');
  if (dailyCapRM > 0 && day >= dailyCapRM) throw new BudgetExceeded(`Daily cap reached: RM${day.toFixed(2)} / RM${dailyCapRM}`);
  if (monthlyCapRM > 0 && month >= monthlyCapRM) throw new BudgetExceeded(`Monthly cap reached: RM${month.toFixed(2)} / RM${monthlyCapRM}`);
}

export function budgetSummary() {
  const z = zoned(), db = getDb();
  const weekAgo = new Date(Date.now() - 6 * 86400_000), weekStart = zoned(weekAgo).day;
  const sum = (where: string, arg: string) => db.prepare(`SELECT COALESCE(SUM(cost_rm),0) rm, COALESCE(SUM(cost_usd),0) usd, COALESCE(SUM(prompt_tokens),0) prompt, COALESCE(SUM(cached_tokens),0) cached, COALESCE(SUM(completion_tokens),0) completion, COUNT(*) calls FROM usage WHERE ${where}`).get(arg);
  const s = getAppSettings();
  return {
    today: sum('day = ?', z.day), week: sum('day >= ?', weekStart), month: sum('month = ?', z.month),
    caps: { dailyRM: s.budget.dailyCapRM, monthlyRM: s.budget.monthlyCapRM }, rate: s.general.currencyRate,
    byDay: db.prepare('SELECT day, ROUND(SUM(cost_rm), 4) rm, SUM(prompt_tokens + completion_tokens) tokens, COUNT(*) calls FROM usage GROUP BY day ORDER BY day DESC LIMIT 31').all(),
    byStep: db.prepare('SELECT provider, model, step, ROUND(SUM(cost_rm), 4) rm, SUM(prompt_tokens) prompt, SUM(completion_tokens) completion, COUNT(*) calls FROM usage WHERE month = ? GROUP BY provider, model, step ORDER BY rm DESC').all(z.month),
  };
}

export function logBudgetStop(e: BudgetExceeded) { log('alert', 'budget', `${e.message}. Runs stopped until the cap allows more.`); }
