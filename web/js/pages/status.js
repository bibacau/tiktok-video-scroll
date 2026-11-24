import { useEffect, useState } from 'preact/hooks';
import { html, get, post, guard, fmtDur, fmtTime, rm, toast, frameBadge } from '../api.js';
import { useLive, useShared } from '../store.js';

export function StatusPage() {
  const l = useLive(), sh = useShared();
  const s = l.status;
  const [plan, setPlan] = useState(null);
  const [minutes, setMinutes] = useState('');
  const [presetId, setPresetId] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { get('/api/plan').then(setPlan).catch(() => {}); const t = setInterval(() => setTick(x => x + 1), 1000); return () => clearInterval(t); }, [s?.state]);
  useEffect(() => { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); }, []);
  if (!s) return html`<p class="pad muted">Connecting…</p>`;

  const running = ['running', 'starting', 'paused', 'needs_user', 'stopping'].includes(s.state);
  const elapsed = s.activeSeconds + (s.state === 'running' ? (Date.now() - l.statusAt) / 1000 : 0);
  const pct = s.plannedSeconds ? Math.min(100, 100 * elapsed / s.plannedSeconds) : 0;
  const todayPreset = sh.presets.find(p => p.id === sh.dayPresets[['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()]]);
  const chosen = sh.presets.find(p => p.id === (presetId || todayPreset?.id));

  const start = guard(async () => { await post('/api/control/start', { minutes: minutes ? Number(minutes) : undefined, presetId: presetId || undefined }); toast('Session started'); });
  const act = (path, msg) => guard(async () => { await post(path); if (msg) toast(msg); });

  return html`<div class="grid2">
    <div>
      ${s.state === 'needs_user' ? html`<section class="card alertcard">
        <h3>⚠️ The agent needs you</h3>
        <p>${s.alert?.message}</p>
        <p class="muted">The agent never solves captchas or logs in by itself. Fix it in the Edge window on your PC, then press Resume.</p>
        <button class="btn primary big" onClick=${act('/api/control/resume', 'Resumed')}>I've handled it — Resume</button>
      </section>` : null}
      ${s.alert?.kind === 'profile_busy' ? html`<${ProfileBusy} alert=${s.alert} />` : null}
      ${s.alert?.kind === 'share_blocked' ? html`<section class="card alertcard">
        <h3>📤 Can't send saved videos to your main account</h3>
        <p>${s.alert.message}</p>
        <p class="muted small">Sharing is paused for today so TikTok isn't asked again and again. Saved videos are still saved (and sent to Telegram if you turned that on).</p>
        <div class="controls"><button class="btn primary" onClick=${act('/api/shares/retry', 'Retrying…')}>I've followed each other — Retry sharing</button>
          <button class="btn ghost" onClick=${act('/api/control/dismiss-alert')}>Dismiss</button></div>
      </section>` : null}
      ${s.alert && s.state !== 'needs_user' && !['profile_busy', 'share_blocked'].includes(s.alert.kind) ? html`<section class="card alertcard soft"><p>⚠️ ${s.alert.message}</p><button class="btn small ghost" onClick=${act('/api/control/dismiss-alert')}>Dismiss</button></section>` : null}

      <section class="card">
        <div class="statehead">
          <span class=${`pill ${s.state}`}>${s.state.replace('_', ' ')}</span>
          ${s.presetName ? html`<span class="muted">${s.presetName} · ${s.trigger}</span>` : null}
        </div>
        ${running ? html`
          <div class="timer"><strong>${fmtDur(elapsed)}</strong> <span class="muted">of ${fmtDur(s.plannedSeconds)}</span></div>
          <div class="bar"><span style=${`width:${pct}%`} /></div>
          <div class="controls">
            ${s.state === 'paused' ? html`<button class="btn primary" onClick=${act('/api/control/resume')}>▶ Resume</button>`
              : s.state !== 'needs_user' ? html`<button class="btn" onClick=${act('/api/control/pause')}>⏸ Pause</button>` : null}
            <button class="btn danger" onClick=${act('/api/control/stop', 'Stopping…')}>■ Stop</button>
          </div>` : html`
          <div class="startbox">
            <label class="label">Preset</label>
            <select value=${presetId || todayPreset?.id} onChange=${e => setPresetId(e.target.value)}>
              ${sh.presets.map(p => html`<option value=${p.id}>${p.name}${p.id === todayPreset?.id ? ' (today)' : ''}</option>`)}
            </select>
            <label class="label">Minutes</label>
            <input type="number" min="1" max="600" placeholder=${chosen?.data.schedule.manualMinutes ?? 10} value=${minutes} onInput=${e => setMinutes(e.target.value)} />
            <button class="btn primary big" onClick=${start}>▶ Start now</button>
          </div>`}
        <${LoginBox} profile=${s.browserProfile} disabled=${running} />
        <${BrowserState} profile=${s.browserProfile} />
        <div class="controls">
          ${s.browserOpen
            ? html`<button class="btn small ghost" disabled=${running} onClick=${act('/api/control/close-browser')}>Close agent window</button>`
            : html`<button class="btn small ghost" onClick=${act('/api/control/open-browser', 'Agent window opening on your PC')}>Open agent window</button>`}
        </div>
      </section>

      <section class="card">
        <h3>Now</h3>
        ${s.source ? html`<p class="muted">Source: ${s.source}</p>` : null}
        ${s.search ? html`<div class="searchnow">🔎 AI search: <b>"${s.search.query}"</b><div class="small muted">${s.search.reason}</div></div>` : null}
        ${s.current ? html`<div class="current">
          <div><span class=${`pill small ${s.current.phase}`}>${s.current.phase}</span> <strong>@${s.current.author || '?'}</strong>
          ${s.current.duration ? html` <span class="muted">${Math.round(s.current.duration)}s</span>` : null}</div>
          <p class="desc">${s.current.desc || html`<span class="muted">(no caption)</span>`}</p>
          ${s.current.frames ? html`<div class="framemode">Frames: ${frameBadge(s.current.frames)}
            ${s.current.frames.mode === 'text' ? html`<a href="#ai" class="small"> set up a vision helper</a>` : null}
            ${s.current.frames.description ? html`<details><summary class="small">What the vision model saw</summary><p class="small">${s.current.frames.description}</p></details>` : null}</div>` : null}
          ${s.current.url ? html`<a href=${s.current.url} target="_blank" rel="noopener">Open on TikTok ↗</a>` : null}
        </div>` : html`<p class="muted">—</p>`}
        <div class="thinking">🧠 ${s.thinking || '…'}</div>
        <div class="stats4">
          <div><b>${s.counts.videos}</b><span>seen</span></div><div><b>${s.counts.watched}</b><span>watched</span></div>
          <div><b>${s.counts.skipped}</b><span>skipped</span></div><div><b>${s.counts.saved}</b><span>saved</span></div>
        </div>
        ${s.restarts ? html`<p class="muted">Browser restarts this session: ${s.restarts}</p>` : null}
      </section>

      <section class="card">
        <h3>Today</h3>
        <div class="stats4">
          <div><b>${fmtDur(s.today?.watchedSeconds)}</b><span>watched</span></div>
          <div><b>${rm(s.today?.spentRM)}</b><span>AI spend</span></div>
        </div>
        ${plan ? html`<div class="plan">
          <p class="muted">${plan.presetName} · schedule ${plan.enabled ? 'ON' : 'OFF (manual only)'} · ${plan.plannedMinutes}/${plan.requestedMinutes} min planned</p>
          ${plan.entries.map(e => html`<div class="planrow"><span>${e.start}–${e.end}</span><span>${e.minutes} min</span><span class=${`pill small ${e.status}`}>${e.status}</span></div>`)}
          ${plan.warnings.map(w => html`<p class="warn">⚠️ ${w}</p>`)}
        </div>` : null}
      </section>
    </div>

    <div>
      <section class="card">
        <h3>Browser ${l.screenshot ? html`<span class="muted small">${fmtTime(l.screenshot.at)}</span>` : null}</h3>
        ${l.screenshot ? html`<img class="shot" src=${`data:image/jpeg;base64,${l.screenshot.base64}`} alt="Live browser view" />`
          : html`<p class="muted">The live view appears while a session is running.</p>`}
        ${s.state === 'idle' && s.browserOpen ? html`<button class="btn small ghost" onClick=${act('/api/screenshot')}>📷 Take a snapshot</button>` : null}
      </section>
      <section class="card">
        <h3>Live log</h3>
        <div class="log">${l.logs.length ? l.logs.slice(0, 40).map(e => html`<div class=${`logline ${e.level}`}><span class="muted">${new Date(e.at).toLocaleTimeString()}</span> ${e.message}</div>`) : html`<p class="muted">Nothing yet.</p>`}</div>
      </section>
    </div>
  </div>`;
}

function ProfileBusy({ alert }) {
  const [busy, setBusy] = useState(false);
  const close = guard(async () => {
    setBusy(true);
    try { const r = await post(`/api/browser/profiles/${encodeURIComponent(alert.profile)}/close`); toast(r.killed ? `Closed ${r.killed} Edge process(es) for "${alert.profile}"` : 'Nothing was open any more'); }
    finally { setBusy(false); }
  });
  return html`<section class="card alertcard">
    <h3>🔒 The agent's Edge profile is in use</h3>
    <p>${alert.message}</p>
    <p class="muted small">Only processes using the "${alert.profile}" profile folder are closed — your normal Edge windows are not touched. Unsaved work in that window is lost.</p>
    <div class="controls"><button class="btn primary" disabled=${busy} onClick=${close}>${busy ? 'Closing…' : 'Close it for me'}</button>
      <button class="btn ghost" onClick=${guard(() => post('/api/control/dismiss-alert'))}>Dismiss</button></div>
  </section>`;
}

/** Live state of the watcher's Edge profile, refreshed every few seconds while idle. */
export function BrowserState({ profile }) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (!profile) return;
    let stop = false;
    const load = () => get(`/api/browser/profiles/${encodeURIComponent(profile)}`).then(r => !stop && setSt(r)).catch(() => {});
    load(); const t = setInterval(load, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [profile]);
  if (!st) return null;
  const label = { closed: 'closed', agent: 'open (agent window)', busy: 'open in another window — the agent cannot use it' }[st.state];
  return html`<p class="small muted">Edge profile "${profile}": <b class=${st.state === 'busy' ? 'warntext' : ''}>${label}</b>
    ${st.state === 'busy' ? html` <button class="btn small" onClick=${guard(async () => { await post(`/api/browser/profiles/${encodeURIComponent(profile)}/close`); toast('Closed'); })}>Close it for me</button>` : null}</p>`;
}

/** "Log in to TikTok" in a normal, non-automated Edge window, with live detection. */
export function LoginBox({ profile, disabled, label = 'Log in to TikTok', openPath }) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (!profile) return;
    get(`/api/login/${encodeURIComponent(profile)}`).then(setSt).catch(() => {});
    const on = e => { if (e.detail.profile === profile) setSt(e.detail); };
    window.addEventListener('login', on);
    return () => window.removeEventListener('login', on);
  }, [profile]);
  const open = guard(async () => { setSt(await post(openPath || `/api/login/${encodeURIComponent(profile)}/open`, { qr: true })); toast('A normal Edge window is opening on your PC — log in there'); });
  const check = guard(async () => setSt(await post(`/api/login/${encodeURIComponent(profile)}/check`)));
  if (!st) return null;
  const icon = st.waiting ? '⏳' : st.loggedIn ? '✅' : st.loggedIn === false ? '⚠️' : '❔';
  return html`<div class="loginbox">
    <div class="row wrap"><span class="grow">${icon} TikTok: <b>${st.message}</b>${st.checkedAt && !st.waiting ? html` <span class="muted small">(checked ${fmtTime(st.checkedAt)})</span>` : null}</span>
      <button class="btn small ${st.loggedIn ? 'ghost' : 'primary'}" disabled=${disabled || st.waiting} onClick=${open}>${st.loggedIn ? 'Log in again' : label}</button>
      ${!st.waiting ? html`<button class="btn small ghost" onClick=${check}>Check</button>` : null}</div>
  </div>`;
}
