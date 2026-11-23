import { useEffect, useState } from 'preact/hooks';
import { html, get, post, put, del, guard, toast, fmtTime, rm } from '../api.js';
import { useLive, useShared } from '../store.js';
import { PresetSection, PresetBar } from './presets.js';

const STATUS_STEPS = ['planning', 'scripting', 'voicing', 'visuals', 'rendering', 'ready'];

function ScriptEditor({ c, onClose }) {
  const [s, setS] = useState(structuredClone(c.script));
  const setScene = (i, k, v) => setS({ ...s, scenes: s.scenes.map((x, j) => j === i ? { ...x, [k]: v } : x) });
  const save = guard(async rerender => {
    await put(`/api/creations/${c.id}/script`, s);
    if (rerender) await post(`/api/creations/${c.id}/regenerate`, { step: 'render' });
    toast(rerender ? 'Saved — re-rendering (changed lines get a new voice)' : 'Script saved'); onClose();
  });
  return html`<div class="scripted">
    <label class="label">Title</label><input value=${s.title} onInput=${e => setS({ ...s, title: e.target.value })} />
    ${s.scenes.map((x, i) => html`<div class="scene">
      <div class="row"><b>Scene ${i + 1}</b><span class="grow" />
        <button class="btn small ghost" disabled=${i === 0} onClick=${() => { const a = [...s.scenes]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setS({ ...s, scenes: a }); }}>↑</button>
        <button class="btn small ghost" onClick=${() => setS({ ...s, scenes: s.scenes.filter((_, j) => j !== i) })}>Remove</button></div>
      <label class="label small">Voiceover / subtitles</label><textarea rows="2" value=${x.voiceover} onInput=${e => setScene(i, 'voiceover', e.target.value)} />
      <label class="label small">On-screen headline</label><input value=${x.on_screen} onInput=${e => setScene(i, 'on_screen', e.target.value)} />
      <details><summary class="small muted">Visual search / image prompt</summary>
        <input value=${x.keywords} placeholder="stock search words" onInput=${e => setScene(i, 'keywords', e.target.value)} />
        <textarea rows="2" value=${x.image_prompt} placeholder="AI image prompt" onInput=${e => setScene(i, 'image_prompt', e.target.value)} /></details>
    </div>`)}
    <button class="btn small ghost" onClick=${() => setS({ ...s, scenes: [...s.scenes, { voiceover: '', on_screen: '', keywords: '', image_prompt: '' }] })}>+ Add scene</button>
    <label class="label">Caption</label><textarea rows="2" value=${s.caption} onInput=${e => setS({ ...s, caption: e.target.value })} />
    <label class="label">Hashtags (space separated)</label><input value=${s.hashtags.join(' ')} onInput=${e => setS({ ...s, hashtags: e.target.value.split(/[\s,]+/).filter(Boolean) })} />
    <div class="row wrap"><button class="btn primary" onClick=${() => save(true)}>Save & re-render</button>
      <button class="btn" onClick=${() => save(false)}>Save only</button><button class="btn ghost" onClick=${onClose}>Cancel</button></div>
  </div>`;
}

function CreationCard({ c }) {
  const [editing, setEditing] = useState(false);
  const busy = !['ready', 'failed'].includes(c.status);
  const regen = step => guard(async () => { await post(`/api/creations/${c.id}/regenerate`, { step }); toast(`Redoing ${step}…`); })();
  const remove = guard(async () => { if (confirm(`Delete video #${c.id}?`)) await del(`/api/creations/${c.id}`); });
  const copy = guard(async () => { await navigator.clipboard.writeText(`${c.caption}\n\n${c.hashtags.map(h => '#' + h).join(' ')}`); toast('Caption copied'); });
  const step = STATUS_STEPS.indexOf(c.status);
  return html`<article class="ccard">
    <div class="cmedia">${c.video_url ? html`<video src=${c.video_url} poster=${c.thumb_url} controls playsinline preload="none" />` : html`<div class="cplaceholder">${busy ? '⏳' : c.status === 'failed' ? '⚠️' : '🎬'}</div>`}</div>
    <div class="cbody">
      <div class="row wrap"><strong class="grow">#${c.id} ${c.title || 'New video'}</strong><span class=${`pill small ${c.status}`}>${c.status}</span></div>
      <p class="muted small">${fmtTime(c.created_at)} · ${c.duration ? `${c.duration.toFixed(1)}s · ` : ''}AI cost ${rm(c.cost_rm)}</p>
      ${busy ? html`<div class="steps">${STATUS_STEPS.slice(0, 5).map((s, i) => html`<span class=${i < step ? 'done' : i === step ? 'now' : ''}>${s}</span>`)}</div>` : null}
      <p class="small">${c.stage}</p>
      ${c.error ? html`<p class="warn">${c.error}</p>` : null}
      ${c.idea ? html`<p class="small"><b>Idea:</b> ${c.idea.angle || c.idea.title}</p>` : null}
      ${c.caption ? html`<div class="captionbox"><p>${c.caption}</p><p class="muted">${c.hashtags.map(h => '#' + h).join(' ')}</p>
        <button class="btn small ghost" onClick=${copy}>Copy caption</button></div>` : null}
      ${c.assets?.credits?.length ? html`<p class="muted small">Stock: ${c.assets.credits.join(' · ')}</p>` : null}
      <div class="row wrap actions">
        <button class="btn small" disabled=${busy || !c.idea} onClick=${() => regen('script')}>↻ Script</button>
        <button class="btn small" disabled=${busy || !c.script} onClick=${() => regen('voice')}>↻ Voice</button>
        <button class="btn small" disabled=${busy || !c.script} onClick=${() => regen('visuals')}>↻ Visuals</button>
        <button class="btn small" disabled=${busy || !c.script} onClick=${() => regen('render')}>↻ Re-render</button>
        <button class="btn small ghost" disabled=${busy || !c.script} onClick=${() => setEditing(!editing)}>✎ Edit script</button>
        ${c.video_url ? html`<a class="btn small ghost" href=${c.video_url} download=${`video-${c.id}.mp4`}>⬇ Download</a>` : null}
        <button class="btn small ghost" disabled=${busy} onClick=${remove}>Delete</button>
      </div>
      ${editing && c.script ? html`<${ScriptEditor} c=${c} onClose=${() => setEditing(false)} />` : null}
      ${c.script && !editing ? html`<details><summary class="small">Script (${c.script.scenes.length} scenes)</summary>
        <ol class="small">${c.script.scenes.map(x => html`<li><b>${x.on_screen}</b> — ${x.voiceover}</li>`)}</ol></details>` : null}
    </div>
  </article>`;
}

function Studio() {
  const sh = useShared(); useLive();
  const [list, setList] = useState(null);
  const [queue, setQueue] = useState({ current: null, queued: [] });
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(1);
  const load = () => get('/api/creations').then(r => { setList(r.creations); setQueue(r.queue); }).catch(e => toast(e.message, 'err'));
  useEffect(() => {
    load();
    const onC = e => setList(l => { const c = e.detail; if (!l) return [c]; const i = l.findIndex(x => x.id === c.id); return i < 0 ? [c, ...l] : l.map(x => x.id === c.id ? c : x); });
    const onQ = e => setQueue(e.detail);
    const onD = e => setList(l => (l || []).filter(x => x.id !== e.detail));
    window.addEventListener('creation', onC); window.addEventListener('creatorQueue', onQ); window.addEventListener('creationDeleted', onD);
    return () => { window.removeEventListener('creation', onC); window.removeEventListener('creatorQueue', onQ); window.removeEventListener('creationDeleted', onD); };
  }, []);
  const make = guard(async () => { await post('/api/creations', { presetId: sh.presetId, count, topic }); setTopic(''); toast('Planning your video…'); });
  return html`<div>
    <section class="card">
      <h3>Make a video now</h3>
      <p class="help">Uses the selected preset's creation settings and today's research. Nothing is posted — videos wait here for you.</p>
      <${PresetBar} />
      <label class="label">Topic (optional — leave empty to let the AI pick from today's research)</label>
      <input value=${topic} placeholder="e.g. 3 nasi lemak mistakes" onInput=${e => setTopic(e.target.value)} />
      <div class="row"><label class="label">How many</label><input type="number" min="1" max="10" value=${count} onInput=${e => setCount(Number(e.target.value) || 1)} style="max-width:90px" />
        <button class="btn primary grow" onClick=${make}>🎬 Create</button></div>
      ${queue.current ? html`<p class="muted small">Working: ${queue.current}${queue.queued.length ? ` · ${queue.queued.length} waiting` : ''}</p>` : null}
    </section>
    ${list && !list.length ? html`<p class="pad muted">No videos yet.</p>` : null}
    <div class="ccards">${(list || []).map(c => html`<${CreationCard} key=${c.id} c=${c} />`)}</div>
  </div>`;
}

export function CreatePage() {
  const [tab, setTab] = useState('studio');
  return html`<div>
    <div class="subtabs"><button class=${tab === 'studio' ? 'on' : ''} onClick=${() => setTab('studio')}>🎬 Studio</button>
      <button class=${tab === 'settings' ? 'on' : ''} onClick=${() => setTab('settings')}>⚙️ Creation settings</button></div>
    ${tab === 'studio' ? html`<${Studio} />` : html`<${PresetSection} section="create" />`}
  </div>`;
}
