import { useEffect, useState } from 'preact/hooks';
import { html, get, post, put, del, guard, toast, fmtTime } from '../api.js';
import { useShared } from '../store.js';
import { PresetSection } from './presets.js';
import { LoginBox } from './status.js';

const fmtAt = iso => iso ? new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const n = x => x == null ? '?' : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : String(x);

function useAccounts() {
  const [list, setList] = useState([]);
  const load = () => get('/api/accounts').then(setList).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); const on = () => load(); window.addEventListener('login', on); return () => window.removeEventListener('login', on); }, []);
  return [list, load];
}

function WaitingCard({ c, accounts, reload }) {
  const [account, setAccount] = useState(c.account_id || '');
  const [time, setTime] = useState('');
  const [slot, setSlot] = useState(null);
  useEffect(() => { get(`/api/post/${c.id}/next-slot${account ? `?account=${account}` : ''}`).then(setSlot).catch(() => {}); }, [account]);
  const approve = when => guard(async () => { await post(`/api/post/${c.id}/approve`, { when, accountId: account || undefined }); toast(when === 'now' ? 'Posting…' : 'Scheduled'); reload(); })();
  return html`<article class="ccard">
    <div class="cmedia">${c.video_url ? html`<video src=${c.video_url} poster=${c.thumb_url} controls playsinline preload="none" />` : null}</div>
    <div class="cbody">
      <strong>#${c.id} ${c.title}</strong>
      <div class="captionbox"><p>${c.caption}</p><p class="muted">${(c.hashtags || []).map(h => '#' + h).join(' ')}</p></div>
      <p class="small">🔒 Will be labelled <b>AI-generated</b> on TikTok.</p>
      ${c.post_error ? html`<p class="warn">${c.post_error}</p>` : null}
      <label class="label small">Account</label>
      <select value=${account} onChange=${e => setAccount(e.target.value)}>
        <option value="">Preset default${slot?.account && !account ? '' : ''}</option>
        ${accounts.map(a => html`<option value=${a.id}>${a.name}${a.login.loggedIn ? '' : ' (not logged in)'}</option>`)}
      </select>
      <div class="row wrap actions">
        <button class="btn primary small" onClick=${() => approve('slot')}>✓ Approve → ${slot?.at ? fmtAt(slot.at) : 'next slot'}</button>
        <button class="btn small" onClick=${() => confirm('Post this video to TikTok right now?') && approve('now')}>Post now</button>
      </div>
      <div class="row wrap"><input type="datetime-local" value=${time} onInput=${e => setTime(e.target.value)} style="max-width:220px" />
        <button class="btn small ghost" disabled=${!time} onClick=${() => approve(new Date(time).toISOString())}>Schedule at this time</button></div>
      ${slot?.scheduleWith === 'tiktok' ? html`<p class="muted small">Scheduled posts are uploaded right away and published by TikTok's scheduler (your PC can be off).</p>` : html`<p class="muted small">Scheduled posts are published by this app — keep the PC and app on.</p>`}
      <div class="row wrap actions"><button class="btn small ghost" onClick=${guard(async () => { await post(`/api/post/${c.id}/reject`); reload(); })}>✕ Reject</button>
        <a class="small" href="#create">edit in Studio</a></div>
    </div>
  </article>`;
}

function Row({ c, reload, accounts }) {
  const acc = accounts.find(a => a.id === c.account_id);
  return html`<div class="vrow">
    ${c.thumb_url ? html`<img class="thumbsm" src=${c.thumb_url} alt="" />` : null}
    <div class="grow"><b>#${c.id} ${c.title}</b> <span class=${`pill small ${c.status}`}>${c.status.replace('_', ' ')}</span>
      <div class="small muted">${acc ? acc.name : ''} · ${c.status === 'posted' ? `posted ${fmtAt(c.posted_at)}` : `for ${fmtAt(c.post_at)}`} · ${c.stage}</div>
      ${c.post_error ? html`<div class="warn small">${c.post_error}</div>` : null}
      ${c.post_url ? html`<a class="small" href=${c.post_url} target="_blank" rel="noopener">Open on TikTok ↗</a>` : null}</div>
    ${['scheduled', 'post_failed', 'rejected'].includes(c.status) ? html`<button class="btn small ghost" onClick=${guard(async () => { await post(`/api/post/${c.id}/unschedule`); reload(); })}>Back to approval</button>` : null}
  </div>`;
}

function Comments({ list, reload }) {
  if (!list.length) return null;
  return html`<section class="card"><h3>💬 Comments waiting for your approval</h3>
    <p class="help">Drafted by the AI while watching. Nothing is posted until you approve. Approved comments are posted between watching sessions.</p>
    ${list.map(c => html`<${CommentRow} key=${c.id} c=${c} reload=${reload} />`)}</section>`;
}
function CommentRow({ c, reload }) {
  const [text, setText] = useState(c.text || '');
  return html`<div class="vrow"><div class="grow">
    <div class="small"><b>@${c.author || '?'}</b> <span class=${`pill small ${c.status}`}>${c.status}</span> <a href=${c.video_url} target="_blank" rel="noopener">video ↗</a></div>
    ${c.status === 'pending' || c.status === 'failed' ? html`<input value=${text} maxlength="150" onInput=${e => setText(e.target.value)} />` : html`<p>${c.text}</p>`}
    ${c.error ? html`<div class="warn small">${c.error}</div>` : null}</div>
    ${c.status !== 'approved' ? html`<button class="btn small primary" onClick=${guard(async () => { const r = await post(`/api/comments/${c.id}/approve`, { text }); toast(`Approved — posts ${r.willPost}`); reload(); })}>Approve</button>` : null}
    <button class="btn small ghost" onClick=${guard(async () => { await post(`/api/comments/${c.id}/reject`); reload(); })}>Reject</button>
  </div>`;
}

function Queue() {
  const sh = useShared();
  const [q, setQ] = useState(null);
  const [accounts] = useAccounts();
  const load = () => get('/api/post/queue').then(setQ).catch(e => toast(e.message, 'err'));
  useEffect(() => {
    load(); const on = () => load();
    for (const ev of ['creation', 'posterQueue']) window.addEventListener(ev, on);
    return () => { for (const ev of ['creation', 'posterQueue']) window.removeEventListener(ev, on); };
  }, []);
  if (!q) return html`<p class="pad muted">Loading…</p>`;
  const autoPresets = sh.presets.filter(p => p.data.post.mode === 'auto');
  return html`<div>
    ${autoPresets.length ? html`<div class="banner">⚠️ Auto-post is ON for: ${autoPresets.map(p => p.name).join(', ')}. Finished videos are posted without your approval.</div>` : null}
    ${!accounts.length ? html`<section class="card"><p>No TikTok account yet. Add one in <b>Accounts</b> first.</p></section>` : null}
    ${q.poster.current ? html`<p class="muted small pad">Working: ${q.poster.current}</p>` : null}
    <section class="card"><h3>Waiting for approval (${q.waiting.length})</h3>${!q.waiting.length ? html`<p class="muted">Finished videos from the Studio appear here.</p>` : null}</section>
    <div class="ccards">${q.waiting.map(c => html`<${WaitingCard} key=${c.id} c=${c} accounts=${accounts} reload=${load} />`)}</div>
    <${Comments} list=${q.comments} reload=${load} />
    <${PendingShares} />
    ${q.scheduled.length ? html`<section class="card"><h3>Scheduled & in progress</h3>${q.scheduled.map(c => html`<${Row} c=${c} reload=${load} accounts=${accounts} />`)}</section>` : null}
    ${q.failed.length ? html`<section class="card"><h3>Failed</h3>${q.failed.map(c => html`<${Row} c=${c} reload=${load} accounts=${accounts} />`)}</section>` : null}
    ${q.posted.length ? html`<section class="card"><h3>Posted</h3>${q.posted.map(c => html`<${Row} c=${c} reload=${load} accounts=${accounts} />`)}</section>` : null}
  </div>`;
}

function Accounts() {
  const [list, load] = useAccounts();
  const [name, setName] = useState(''); const [handle, setHandle] = useState('');
  const add = guard(async () => { await post('/api/accounts', { name, handle }); setName(''); setHandle(''); load(); toast('Account added — now log in'); });
  return html`<div>
    <section class="card"><h3>Add a TikTok account</h3>
      <p class="help">Each account gets its own Edge profile, so logins never mix. Log in by scanning the QR code with the TikTok app on your phone.</p>
      <div class="row wrap"><input placeholder="Name, e.g. Food channel" value=${name} onInput=${e => setName(e.target.value)} />
        <input placeholder="@handle (optional)" value=${handle} onInput=${e => setHandle(e.target.value)} />
        <button class="btn primary" onClick=${add}>Add</button></div></section>
    ${list.map(a => html`<section class="card" key=${a.id}>
      <div class="row wrap"><h3 class="grow">${a.name} ${a.handle ? html`<span class="muted">@${a.handle}</span>` : null}</h3>
        <button class="btn small ghost" onClick=${guard(async () => { const keep = !confirm(`Remove "${a.name}"?\n\nOK = also delete its Edge profile (its TikTok login).\nCancel = keep the profile.`); await del(`/api/accounts/${a.id}?profile=${keep ? 0 : 1}`); load(); })}>Remove</button></div>
      <${AccountLogin} a=${a} />
    </section>`)}
  </div>`;
}
function AccountLogin({ a }) {
  return html`<div>
    <${LoginBox} profile=${a.profile} label="Log in (QR code)" openPath=${`/api/accounts/${a.id}/login`} />
    <p class="muted small">On your phone, open the TikTok app, tap its QR-scan icon and scan the code shown in the Edge window on your PC. That window has no automation attached.</p>
  </div>`;
}

function Analytics() {
  const [accounts] = useAccounts();
  const [id, setId] = useState('');
  const [data, setData] = useState(null);
  const acc = id || accounts[0]?.id;
  const load = () => acc && get(`/api/analytics/${acc}`).then(setData).catch(e => toast(e.message, 'err'));
  useEffect(() => { load(); const on = () => load(); window.addEventListener('analytics', on); return () => window.removeEventListener('analytics', on); }, [acc]);
  if (!accounts.length) return html`<p class="pad muted">Add an account first.</p>`;
  return html`<div>
    <section class="card"><div class="row wrap">
      <select value=${acc} onChange=${e => setId(e.target.value)} style="max-width:260px">${accounts.map(a => html`<option value=${a.id}>${a.name}</option>`)}</select>
      <span class="muted small grow">Last read: ${data?.at ? fmtTime(data.at) : 'never'}</span>
      <button class="btn small" onClick=${guard(async () => { await post(`/api/analytics/${acc}/refresh`); toast('Reading TikTok Studio…'); })}>↻ Refresh now</button></div>
      ${data ? html`<details open><summary class="small">What tomorrow's planning sees</summary><pre class="mono small summary">${data.summary}</pre></details>` : null}
    </section>
    ${data?.posts?.length ? html`<section class="card"><table><thead><tr><th>Video</th><th>Views</th><th>Likes</th><th>Comments</th><th></th></tr></thead><tbody>
      ${data.posts.map(p => html`<tr><td>${p.title ? html`<b>${p.title}</b><br />` : null}<span class="small muted">${p.caption}</span></td>
        <td>${n(p.views)}${p.prev_views != null && p.views != null && p.views > p.prev_views ? html` <span class="small okt">+${n(p.views - p.prev_views)}</span>` : null}</td><td>${n(p.likes)}</td><td>${n(p.comments)}</td>
        <td><a href=${p.video_url} target="_blank" rel="noopener">↗</a></td></tr>`)}</tbody></table></section>` : null}
  </div>`;
}

export function PostPage() {
  const [tab, setTab] = useState(() => { try { const t = localStorage.getItem('postTab'); localStorage.removeItem('postTab'); return t || 'queue'; } catch { return 'queue'; } });
  const tabs = [['queue', '📥 Queue'], ['accounts', '👤 Accounts'], ['analytics', '📈 Analytics'], ['settings', '⚙️ Posting settings']];
  return html`<div>
    <div class="subtabs">${tabs.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${tab === 'queue' ? html`<${Queue} />` : tab === 'accounts' ? html`<${Accounts} />` : tab === 'analytics' ? html`<${Analytics} />` : html`<${PresetSection} section="post" />`}
  </div>`;
}

function PendingShares() {
  const [rows, setRows] = useState([]);
  const load = () => get('/api/shares').then(r => setRows(r.shares.filter(s => s.status === 'pending'))).catch(() => {});
  useEffect(load, []);
  if (!rows.length) return null;
  return html`<section class="card"><h3>📤 Shares waiting for your approval</h3>
    <p class="help">Saved videos to send to your main account (Save & picks → Share → "Require my approval" is on).</p>
    ${rows.map(s => html`<div class="vrow"><div class="grow small"><b>@${s.author || '?'}</b> → @${s.recipient} · <a href=${s.video_url} target="_blank" rel="noopener">video ↗</a></div>
      <button class="btn small primary" onClick=${guard(async () => { const r = await post(`/api/shares/${s.id}/approve`); toast(`Approved — sends ${r.willSend}`); load(); })}>Approve</button>
      <button class="btn small ghost" onClick=${guard(async () => { await post(`/api/shares/${s.id}/reject`); load(); })}>Reject</button></div>`)}
  </section>`;
}
