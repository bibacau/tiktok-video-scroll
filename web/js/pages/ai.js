import { useEffect, useState } from 'preact/hooks';
import { html, get, put, post, del, guard, toast } from '../api.js';
import { AppSettingsForm } from './settings.js';

function Prompts() {
  const [list, setList] = useState([]);
  const load = () => get('/api/prompts').then(setList).catch(e => toast(e.message, 'err'));
  useEffect(load, []);
  return html`<section class="card"><h3>Prompts</h3>
    <p class="help">Every prompt the app sends to the AI. Variables in {{double braces}} are filled in automatically.</p>
    ${list.map(p => html`<${PromptEditor} key=${p.key + p.updated_at} p=${p} reload=${load} />`)}
  </section>`;
}
function PromptEditor({ p, reload }) {
  const [text, setText] = useState(p.text);
  const [open, setOpen] = useState(false);
  const save = guard(async () => { await put(`/api/prompts/${p.key}`, { text }); toast('Prompt saved'); reload(); });
  const reset = guard(async () => { if (confirm('Reset this prompt to the default?')) { await del(`/api/prompts/${p.key}`); toast('Reset'); reload(); } });
  return html`<div class="subgroup">
    <header class="group-head" onClick=${() => setOpen(!open)}><h3>${p.title} ${p.custom ? html`<span class="badge">edited</span>` : null}</h3><span class="chev">${open ? '▾' : '▸'}</span></header>
    ${open ? html`<div>
      <p class="help">Model step: <b>${p.step}</b> · variables: ${p.variables.map(v => html`<code>{{${v}}}</code> `)}</p>
      <textarea class="mono" rows="16" value=${text} onInput=${e => setText(e.target.value)} />
      <div class="row"><button class="btn primary" disabled=${text === p.text} onClick=${save}>Save</button>
        <button class="btn ghost" disabled=${!p.custom} onClick=${reset}>Reset to default</button></div>
    </div>` : null}
  </div>`;
}

function Memory() {
  const [m, setM] = useState(null);
  const [persona, setPersona] = useState('');
  const load = () => get('/api/memory').then(r => { setM(r); setPersona(r.persona); });
  useEffect(load, []);
  if (!m) return null;
  const savePersona = guard(async () => { await put('/api/memory', { persona }); toast('Persona saved'); load(); });
  const saveInterests = guard(async interests => { await put('/api/memory', { interests }); load(); });
  const clear = what => guard(async () => { if (confirm(`Clear ${what}?`)) { await post('/api/memory/clear', { what }); toast('Cleared'); load(); } })();
  return html`<section class="card"><h3>Persona & interest memory</h3>
    <label class="label">Persona (who the agent is while watching)</label>
    <textarea rows="5" value=${persona} onInput=${e => setPersona(e.target.value)} />
    <div class="row"><button class="btn primary" disabled=${persona === m.persona} onClick=${savePersona}>Save persona</button>
      <button class="btn ghost" onClick=${() => clear('persona')}>Reset persona</button></div>
    <h4>Learned interests (${m.interests.length})</h4>
    <p class="help">Built from what was actually watched. Positive = liked, negative = disliked. Edit a score or remove a topic.</p>
    <div class="interests">${m.interests.map((i, idx) => html`<div class="irow">
      <span class="grow">${i.topic}</span>
      <input type="number" min="-100" max="100" value=${i.score} onChange=${e => saveInterests(m.interests.map((x, j) => j === idx ? { ...x, score: Number(e.target.value) } : x))} />
      <span class="muted small">seen ${i.seen}</span>
      <button class="btn small ghost" onClick=${() => saveInterests(m.interests.filter((_, j) => j !== idx))}>×</button></div>`)}</div>
    <button class="btn ghost" onClick=${() => clear('interests')}>Clear all interests</button>
  </section>`;
}

function VisionTest() {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = guard(async () => { setBusy(true); setRes(null); try { setRes(await post('/api/test-vision')); } finally { setBusy(false); } });
  return html`<section class="card"><h3>Test vision helper</h3>
    <p class="help">Sends one sample frame to the vision model you saved below and shows what it sees. Save your vision settings first.</p>
    <button class="btn" disabled=${busy} onClick=${run}>${busy ? 'Asking the vision model…' : '👁 Test vision'}</button>
    ${res ? html`<div class="visiontest">
      <img src=${res.image} alt="sample frame" />
      <div><p><b>${res.model}</b> · ${res.ms} ms · ${res.source}</p><p>${res.description}</p>
      ${!res.enabled ? html`<p class="warn">Works — now switch on “Describe video frames with a vision model first” and Save, or the watcher won't use it.</p>` : null}</div>
    </div>` : null}
  </section>`;
}

function Tools() {
  const [models, setModels] = useState(null);
  const test = guard(async () => { const r = await post('/api/test-llm'); toast(`AI OK (${r.model}): ${JSON.stringify(r.reply)}`); });
  const load = guard(async () => setModels((await get('/api/models')).models));
  const resetImg = guard(async () => { await post('/api/reset-image-capability'); toast('Will try sending images again'); });
  return html`<section class="card"><h3>Check connection</h3>
    <div class="row wrap"><button class="btn" onClick=${test}>Test AI connection</button><button class="btn" onClick=${load}>Load models</button>
      <button class="btn ghost" onClick=${resetImg}>Re-check image support</button></div>
    ${models ? html`<p>Models your key can use: ${models.map(m => html`<code>${m}</code> `)}</p>` : null}
  </section>`;
}

export function AiPage() {
  return html`<div>
    <${Tools} />
    <${AppSettingsForm} only=${['llm', 'vision', 'steps']} />
    <${VisionTest} />
    <${Prompts} />
    <${Memory} />
  </div>`;
}
