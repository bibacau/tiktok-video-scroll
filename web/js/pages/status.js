import { useEffect, useState } from 'preact/hooks';
import { html, get, post, guard, fmtDur, fmtTime, rm, toast } from '../api.js';
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
      ${s.alert && s.state !== 'needs_user' ? html`<section class="card alertcard soft"><p>⚠️ ${s.alert.message}</p><button class="btn small ghost" onClick=${act('/api/control/dismiss-alert')}>Dismiss</button></section>` : null}

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
        <div class="controls">
          ${s.browserOpen
            ? html`<button class="btn small ghost" disabled=${running} onClick=${act('/api/control/close-browser')}>Close browser</button>`
            : html`<button class="btn small ghost" onClick=${act('/api/control/open-browser', 'Browser opening on your PC — log in to TikTok there')}>Open browser (to log in)</button>`}
        </div>
      </section>

      <section class="card">
        <h3>Now</h3>
        ${s.source ? html`<p class="muted">Source: ${s.source}</p>` : null}
        ${s.current ? html`<div class="current">
          <div><span class=${`pill small ${s.current.phase}`}>${s.current.phase}</span> <strong>@${s.current.author || '?'}</strong>
          ${s.current.duration ? html` <span class="muted">${Math.round(s.current.duration)}s</span>` : null}</div>
          <p class="desc">${s.current.desc || html`<span class="muted">(no caption)</span>`}</p>
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
          : html`<p class="muted">The live view appears when the browser is open.</p>`}
      </section>
      <section class="card">
        <h3>Live log</h3>
        <div class="log">${l.logs.length ? l.logs.slice(0, 40).map(e => html`<div class=${`logline ${e.level}`}><span class="muted">${new Date(e.at).toLocaleTimeString()}</span> ${e.message}</div>`) : html`<p class="muted">Nothing yet.</p>`}</div>
      </section>
    </div>
  </div>`;
}
