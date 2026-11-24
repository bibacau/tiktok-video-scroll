import { useEffect, useState } from 'preact/hooks';
import { html, get, fmtDur, fmtTime, toast, frameBadge } from '../api.js';

function Videos({ session }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { get(`/api/history/videos?session=${session}&limit=500`).then(setRows).catch(e => toast(e.message, 'err')); }, [session]);
  if (!rows) return html`<p class="muted">Loading…</p>`;
  if (!rows.length) return html`<p class="muted">No videos recorded.</p>`;
  return html`<div class="vlist">${rows.map(v => html`<div class=${`vrow ${v.decision}`}>
    <span class=${`pill small ${v.decision}`}>${v.decision}${v.saved ? ' 💾' : ''}</span>
    <span class="small">${new Date(v.at).toLocaleTimeString()}</span>
    <strong>@${v.author || '?'}</strong>
    ${v.interest != null ? html`<span class="muted small">interest ${v.interest}${v.score != null ? ` · score ${v.score}` : ''}</span>` : null}
    <span class="muted small">${Math.round(v.watched_seconds)}s</span>
    ${frameBadge(v.data?.frames)}
    ${v.url ? html`<a class="small" href=${v.url} target="_blank" rel="noopener">↗</a>` : null}
    <div class="why">${v.reason}</div>
    ${v.caption ? html`<div class="muted small clamp">${v.caption}</div>` : null}
  </div>`)}</div>`;
}

export function HistoryPage() {
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState('sessions');
  useEffect(() => {
    get('/api/history/sessions').then(setSessions).catch(e => toast(e.message, 'err'));
    get('/api/history/events?limit=300').then(setEvents).catch(() => {});
  }, []);
  return html`<div>
    <div class="subtabs"><button class=${tab === 'sessions' ? 'on' : ''} onClick=${() => setTab('sessions')}>Sessions</button>
      <button class=${tab === 'searches' ? 'on' : ''} onClick=${() => setTab('searches')}>AI searches</button>
      <button class=${tab === 'events' ? 'on' : ''} onClick=${() => setTab('events')}>Event log</button></div>
    ${tab === 'searches' ? html`<${Searches} />` : null}
    ${tab === 'searches' ? null : tab === 'sessions' ? html`<div>
      ${!sessions.length ? html`<p class="pad muted">No sessions yet.</p>` : null}
      ${sessions.map(s => html`<section class="card">
        <header class="group-head" onClick=${() => setOpen(open === s.id ? null : s.id)}>
          <div><strong>#${s.id}</strong> ${fmtTime(s.started_at)} · ${s.preset_name} · <span class=${`pill small ${s.status}`}>${s.status}</span>
            <div class="muted small">${s.trigger} · ${fmtDur(s.watched_seconds)} · ${s.videos} videos · ${s.saved} saved${s.note ? ` · ${s.note}` : ''}</div></div>
          <span class="chev">${open === s.id ? '▾' : '▸'}</span>
        </header>
        ${open === s.id ? html`<${Videos} session=${s.id} />` : null}
      </section>`)}
    </div>` : html`<section class="card"><div class="log tall">${events.map(e => html`<div class=${`logline ${e.level}`}>
      <span class="muted">${fmtTime(e.at)}</span> <b>${e.type}</b> ${e.message}</div>`)}</div></section>`}
  </div>`;
}

function Searches() {
  const [rows, setRows] = useState(null);
  useEffect(() => { get('/api/history/searches').then(setRows).catch(e => toast(e.message, 'err')); }, []);
  if (!rows) return html`<p class="pad muted">Loading…</p>`;
  if (!rows.length) return html`<p class="pad muted">No AI searches yet. Turn them on in Watch → Sources → "Let the AI choose what to search".</p>`;
  return html`<section class="card">${rows.map(r => html`<div class="vrow">
    <span class=${`pill small ${r.status === 'done' ? 'done' : 'missed'}`}>${r.status}</span>
    <span class="small">${fmtTime(r.at)}</span><b>"${r.query}"</b>${r.method ? html`<span class="muted small">${r.method === 'typed' ? 'typed into the search bar' : 'opened by link'}</span>` : null}
    <div class="why">${r.reason}</div>${r.note ? html`<div class="warn small">${r.note}</div>` : null}</div>`)}</section>`;
}
