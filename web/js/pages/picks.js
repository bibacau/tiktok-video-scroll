import { useEffect, useState } from 'preact/hooks';
import { html, get, post, guard, toast } from '../api.js';

const localDay = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function VideoCard({ v, extra }) {
  const f = v.data?.fields ?? {};
  const [img, setImg] = useState(true);
  return html`<article class="vcard">
    ${img ? html`<img src=${`/media/video-${v.id}.jpg`} loading="lazy" onError=${() => setImg(false)} alt="" />` : null}
    <div class="vbody">
      <div><strong>@${v.author || '?'}</strong> ${v.score != null ? html`<span class="pill small">score ${v.score}</span>` : null}
        ${v.url ? html` <a href=${v.url} target="_blank" rel="noopener">open ↗</a>` : null}</div>
      ${extra}
      ${f.topic ? html`<p><b>Topic:</b> ${f.topic}</p>` : null}
      ${f.hook ? html`<p><b>Hook:</b> ${f.hook}</p>` : null}
      ${f.format ? html`<p><b>Format:</b> ${f.format}</p>` : null}
      ${f.audio ? html`<p><b>Sound:</b> ${f.audio}</p>` : null}
      ${f.reason ?? v.reason ? html`<p><b>Why:</b> ${f.reason ?? v.reason}</p>` : null}
      ${f.summary ? html`<p class="muted">${f.summary}</p>` : null}
      ${f.stats ? html`<p class="muted small">❤ ${f.stats.likes || '?'} · 💬 ${f.stats.comments || '?'} · ↗ ${f.stats.shares || '?'} · 🔖 ${f.stats.saves || '?'}</p>` : null}
      ${f.caption ? html`<details><summary class="small">Caption</summary><p class="small">${f.caption}</p></details>` : null}
    </div>
  </article>`;
}

export function PicksPage() {
  const [day, setDay] = useState(localDay());
  const [picks, setPicks] = useState(null);
  const [saved, setSaved] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => {
    get(`/api/picks?day=${day}`).then(setPicks).catch(e => toast(e.message, 'err'));
    get(`/api/history/videos?day=${day}&saved=1&limit=100`).then(setSaved).catch(() => {});
  };
  useEffect(load, [day]);
  const generate = guard(async () => { setBusy(true); try { setPicks(await post('/api/picks/generate', { day })); toast('Picks ready'); } finally { setBusy(false); } });
  return html`<div>
    <section class="card">
      <div class="row wrap">
        <h3 class="grow">Today's picks</h3>
        <input type="date" value=${day} onChange=${e => setDay(e.target.value)} />
        <button class="btn primary" disabled=${busy} onClick=${generate}>${busy ? 'Thinking…' : 'Build picks now'}</button>
      </div>
      ${picks?.summary ? html`<p>${picks.summary}</p>` : null}
      ${picks && !picks.picks.length ? html`<p class="muted">No picks for this day yet. They are built automatically after the last scheduled session, or press the button.</p>` : null}
    </section>
    <div class="cards">${(picks?.picks ?? []).map(p => html`<${VideoCard} v=${p} extra=${html`
      <p class="pick"><b>#${p.rank}</b> ${p.why}</p>${p.idea ? html`<p class="idea">💡 ${p.idea}</p>` : null}`} />`)}</div>
    <section class="card"><h3>All saved videos (${saved.length})</h3></section>
    <div class="cards">${saved.map(v => html`<${VideoCard} v=${v} />`)}</div>
  </div>`;
}
