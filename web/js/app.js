import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { html, get, post, setToken, toast } from './api.js';
import { live, shared, connect, useLive, reloadPresets } from './store.js';
import { StatusPage } from './pages/status.js';
import { PicksPage } from './pages/picks.js';
import { PresetSection, PresetsPage } from './pages/presets.js';
import { AiPage } from './pages/ai.js';
import { BudgetPage } from './pages/budget.js';
import { HistoryPage } from './pages/history.js';
import { SettingsPage } from './pages/settings.js';
import { CreatePage } from './pages/create.js';

const TABS = [
  ['status', '▶ Status'], ['picks', "⭐ Picks"], ['watch', '👀 Watch'], ['schedule', '🕒 Schedule'], ['save', '💾 Save'],
  ['engage', '❤️ Engage'], ['create', '🎬 Create'], ['post', '📤 Post'], ['presets', '🗂 Presets'], ['ai', '🧠 AI & Prompts'],
  ['budget', '💰 Budget'], ['history', '📜 History'], ['settings', '⚙️ Settings'],
];

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  return html`<div class="login card"><h2>Dashboard password</h2>
    <input type="password" value=${pw} onInput=${e => setPw(e.target.value)} onKeyDown=${e => e.key === 'Enter' && go()} />
    <button class="btn primary" onClick=${go}>Open</button></div>`;
  async function go() {
    try { const r = await post('/api/login', { password: pw }); setToken(r.token); onDone(); } catch (e) { toast(e.message, 'err'); }
  }
}

function App() {
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'status');
  const [ready, setReady] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const l = useLive();
  useEffect(() => {
    const onHash = () => setTab(location.hash.slice(1) || 'status');
    const onNeed = () => setNeedLogin(true);
    window.addEventListener('hashchange', onHash); window.addEventListener('need-login', onNeed);
    boot();
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('need-login', onNeed); };
  }, []);
  async function boot() {
    try {
      shared.schema = await get('/api/schema');
      await reloadPresets();
      setNeedLogin(false); setReady(true);
      if (!live.connected) connect();
    } catch (e) { if (!String(e.message).includes('Password')) toast(e.message, 'err'); }
  }
  if (needLogin) return html`<${Login} onDone=${() => { setNeedLogin(false); boot(); }} />`;
  const s = l.status;
  const dot = !l.connected ? 'off' : s?.state === 'needs_user' ? 'alert' : s?.state === 'running' ? 'on' : s?.state === 'paused' ? 'paused' : 'idle';
  return html`<div class="shell">
    <header class="top">
      <div class="brand"><span class=${`dot ${dot}`} /> TikTok Research Agent</div>
      <div class="topstate">${l.connected ? (s?.state ?? '') : 'reconnecting…'}</div>
    </header>
    ${s?.alert ? html`<div class=${`banner ${s.alert.kind}`} onClick=${() => { location.hash = 'status'; }}>⚠️ ${s.alert.message}</div>` : null}
    <nav class="tabs">${TABS.map(([k, label]) => html`<a href=${'#' + k} class=${tab === k ? 'on' : ''} onClick=${() => { document.title = 'TikTok Research Agent'; }}>${label}</a>`)}</nav>
    <main>${!ready ? html`<p class="muted pad">Loading…</p>` : page(tab)}</main>
  </div>`;
}

function Placeholder({ phase, title, text }) {
  return html`<section class="card"><h3>${title} <span class="badge muted">phase ${phase}</span></h3><p class="muted">${text}</p></section>`;
}

function page(tab) {
  switch (tab) {
    case 'status': return html`<${StatusPage} />`;
    case 'picks': return html`<${PicksPage} />`;
    case 'watch': return html`<${PresetSection} section="watch" />`;
    case 'schedule': return html`<${PresetSection} section="schedule" />`;
    case 'save': return html`<${PresetSection} section="save" />`;
    case 'engage': return html`<${PresetSection} section="engagement" />`;
    case 'create': return html`<${CreatePage} />`;
    case 'post': return html`<${Placeholder} phase="3" title="Posting" text="Approval queue, scheduling, accounts (QR login) and the locked AI-generated label arrive in phase 3." />`;
    case 'presets': return html`<${PresetsPage} />`;
    case 'ai': return html`<${AiPage} />`;
    case 'budget': return html`<${BudgetPage} />`;
    case 'history': return html`<${HistoryPage} />`;
    case 'settings': return html`<${SettingsPage} />`;
    default: return html`<p class="pad">Unknown page</p>`;
  }
}

render(html`<${App} />`, document.getElementById('app'));
