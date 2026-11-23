import { useEffect, useState } from 'preact/hooks';
import { html, get, rm, toast } from '../api.js';
import { AppSettingsForm } from './settings.js';

const tok = n => n > 1e6 ? `${(n / 1e6).toFixed(2)}M` : n > 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n || 0);

export function BudgetPage() {
  const [b, setB] = useState(null);
  useEffect(() => { get('/api/budget').then(setB).catch(e => toast(e.message, 'err')); }, []);
  if (!b) return html`<p class="pad muted">Loading…</p>`;
  const box = (label, x, cap) => html`<div class="kpi"><span>${label}</span><b>${rm(x.rm)}</b>
    ${cap ? html`<div class="bar"><span style=${`width:${Math.min(100, 100 * x.rm / cap)}%`} /></div><small class="muted">cap ${rm(cap)}</small>` : null}
    <small class="muted">${tok(x.prompt + x.completion)} tokens · ${x.calls} calls</small></div>`;
  return html`<div>
    <section class="card"><h3>Spending</h3>
      <div class="kpis">${box('Today', b.today, b.caps.dailyRM)}${box('Last 7 days', b.week)}${box('This month', b.month, b.caps.monthlyRM)}</div>
      <p class="help">Rate: RM${b.rate} per USD. Runs stop automatically when a cap is reached.</p>
    </section>
    <${AppSettingsForm} only=${['budget']} />
    <section class="card"><h3>This month by step</h3>
      <table><thead><tr><th>Provider</th><th>Model</th><th>Step</th><th>Calls</th><th>Tokens in/out</th><th>RM</th></tr></thead>
      <tbody>${b.byStep.map(r => html`<tr><td>${r.provider}</td><td>${r.model}</td><td>${r.step}</td><td>${r.calls}</td><td>${tok(r.prompt)} / ${tok(r.completion)}</td><td>${rm(r.rm)}</td></tr>`)}</tbody></table>
    </section>
    <section class="card"><h3>By day</h3>
      <table><thead><tr><th>Day</th><th>Calls</th><th>Tokens</th><th>RM</th></tr></thead>
      <tbody>${b.byDay.map(r => html`<tr><td>${r.day}</td><td>${r.calls}</td><td>${tok(r.tokens)}</td><td>${rm(r.rm)}</td></tr>`)}</tbody></table>
    </section>
  </div>`;
}
