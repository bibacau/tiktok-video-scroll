// Renders any settings schema (from /api/schema) as a form. No per-setting UI code needed.
import { useEffect, useState } from 'preact/hooks';
import { html, get, del, getToken, toast } from './api.js';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export function Group({ field, value, onChange, nested = false, siblings }) {
  const [open, setOpen] = useState(!field.collapsed);
  const set = (k, v) => onChange({ ...value, [k]: v });
  const body = Object.entries(field.fields).map(([k, f]) => {
    if (f.showIf && value?.[f.showIf.field] !== f.showIf.equals) return null;
    return f.type === 'group'
      ? html`<${Group} key=${k} field=${f} value=${value?.[k]} onChange=${v => set(k, v)} nested=${true} />`
      : html`<${FieldRow} key=${k} field=${f} value=${value?.[k]} onChange=${v => f.fills?.[v] ? onChange({ ...value, [k]: v, ...f.fills[v] }) : set(k, v)} />`;
  });
  return html`<section class=${nested ? 'subgroup' : 'card'}>
    <header class="group-head" onClick=${() => setOpen(!open)}>
      <h3>${field.label}${field.phase ? html` <span class="badge muted">phase ${field.phase}</span>` : null}</h3>
      <span class="chev">${open ? '▾' : '▸'}</span>
    </header>
    ${open && field.help ? html`<p class="help">${field.help}</p>` : null}
    ${open ? body : null}
  </section>`;
}

function FieldRow({ field, value, onChange }) {
  const warn = field.type === 'bool' && field.warnWhenOn && value ? field.warnWhenOn
    : (field.type === 'number' || field.type === 'slider') && field.warn && ((field.warn.above !== undefined && value > field.warn.above) || (field.warn.below !== undefined && value < field.warn.below)) ? field.warn.message : null;
  const inline = ['bool', 'locked'].includes(field.type);
  return html`<div class=${`field ${inline ? 'inline' : ''}`}>
    <label class="label">${field.label}${field.unit ? html` <span class="muted">(${field.unit})</span>` : null}</label>
    <div class="control"><${Control} field=${field} value=${value} onChange=${onChange} /></div>
    ${field.help ? html`<p class="help">${field.help}</p>` : null}
    ${warn ? html`<p class="warn">⚠️ ${warn}</p>` : null}
  </div>`;
}

function Control({ field: f, value, onChange }) {
  switch (f.type) {
    case 'text': case 'time': case 'color':
      return html`<input type=${f.type === 'text' ? 'text' : f.type} value=${value ?? ''} placeholder=${f.placeholder || ''} onInput=${e => onChange(e.target.value)} />`;
    case 'secret': {
      const isSet = value && typeof value === 'object' && value.set;
      return html`<div class="row">
        <input type="password" autocomplete="new-password" placeholder=${isSet ? `saved (${value.hint}) — type to replace` : 'not set'}
          value=${typeof value === 'string' ? value : ''} onInput=${e => onChange(e.target.value)} />
        ${isSet ? html`<button class="btn small ghost" onClick=${() => onChange('')}>Clear</button>` : null}
      </div>`;
    }
    case 'textarea':
      return html`<textarea rows=${f.rows || 4} value=${value ?? ''} placeholder=${f.placeholder || ''} onInput=${e => onChange(e.target.value)} />`;
    case 'number':
      return html`<input type="number" min=${f.min} max=${f.max} step=${f.step || 'any'} value=${value} onInput=${e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />`;
    case 'slider':
      return html`<div class="row"><input type="range" min=${f.min} max=${f.max} step=${f.step || 1} value=${value} onInput=${e => onChange(Number(e.target.value))} /><span class="val">${value}</span></div>`;
    case 'bool':
      return html`<label class="switch"><input type="checkbox" checked=${!!value} onChange=${e => onChange(e.target.checked)} /><span /></label>`;
    case 'locked':
      return html`<div class="locked"><label class="switch"><input type="checkbox" checked disabled /><span /></label> 🔒 <span class="muted">${f.note}</span></div>`;
    case 'select': {
      if (f.allowCustom) {
        const id = `dl-${f.label.replace(/\W/g, '')}`;
        return html`<div><input list=${id} value=${value} onInput=${e => onChange(e.target.value)} /><datalist id=${id}>${f.options.map(o => html`<option value=${o.value}>${o.label}</option>`)}</datalist></div>`;
      }
      return html`<select value=${value} onChange=${e => onChange(e.target.value)}>${f.options.map(o => html`<option value=${o.value}>${o.label}</option>`)}</select>`;
    }
    case 'checkboxes':
      return html`<div class="chips">${f.options.map(o => {
        const on = (value || []).includes(o.value);
        return html`<button type="button" class=${`chip ${on ? 'on' : ''}`} onClick=${() => onChange(on ? value.filter(v => v !== o.value) : [...(value || []), o.value])}>${on ? '✓ ' : ''}${o.label}</button>`;
      })}</div>`;
    case 'list': return html`<${ListInput} value=${value || []} placeholder=${f.placeholder} onChange=${onChange} />`;
    case 'weights': {
      const total = f.options.reduce((a, o) => a + (value?.[o.value] || 0), 0) || 1;
      return html`<div class="weights">${f.options.map(o => html`<div class="row">
        <span class="wlabel">${o.label}</span>
        <input type="range" min="0" max="100" value=${value?.[o.value] || 0} onInput=${e => onChange({ ...value, [o.value]: Number(e.target.value) })} />
        <span class="val">${Math.round(100 * (value?.[o.value] || 0) / total)}%</span></div>`)}</div>`;
    }
    case 'windows': return html`<${Windows} value=${value || {}} onChange=${onChange} />`;
    case 'json': return html`<${JsonInput} value=${value} rows=${f.rows} onChange=${onChange} />`;
    case 'file': return html`<${FilePicker} kind=${f.kind} value=${value || ''} onChange=${onChange} />`;
    default: return html`<span class="muted">unsupported field</span>`;
  }
}

function ListInput({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const items = draft.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    if (items.length) onChange([...new Set([...value, ...items])]);
    setDraft('');
  };
  return html`<div class="list">
    <div class="chips">${value.map(v => html`<span class="chip on">${v} <button class="x" onClick=${() => onChange(value.filter(x => x !== v))}>×</button></span>`)}</div>
    <div class="row"><input value=${draft} placeholder=${placeholder || 'Type and press Enter (comma = several)'} onInput=${e => setDraft(e.target.value)}
      onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /><button class="btn small" onClick=${add}>Add</button></div>
  </div>`;
}

function Windows({ value, onChange }) {
  const setDay = (d, list) => onChange({ ...value, [d]: list });
  return html`<div class="windows">${DAYS.map(d => html`<div class="wday">
    <strong>${DAY_LABEL[d]}</strong>
    <div class="wlist">
      ${(value[d] || []).map((w, i) => html`<div class="row">
        <input type="time" value=${w.start} onInput=${e => setDay(d, value[d].map((x, j) => j === i ? { ...x, start: e.target.value } : x))} />
        <span>–</span>
        <input type="time" value=${w.end} onInput=${e => setDay(d, value[d].map((x, j) => j === i ? { ...x, end: e.target.value } : x))} />
        <button class="btn small ghost" onClick=${() => setDay(d, value[d].filter((_, j) => j !== i))}>×</button></div>`)}
      ${(value[d] || []).length === 0 ? html`<span class="muted">off</span>` : null}
      <button class="btn small ghost" onClick=${() => setDay(d, [...(value[d] || []), { start: '09:00', end: '12:00' }])}>+ window</button>
    </div>
  </div>`)}
  <button class="btn small ghost" onClick=${() => onChange(Object.fromEntries(DAYS.map(d => [d, structuredClone(value.mon || [])])))}>Copy Monday to all days</button>
  </div>`;
}

function JsonInput({ value, rows, onChange }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [err, setErr] = useState('');
  return html`<div><textarea class="mono" rows=${rows || 10} value=${text} onInput=${e => {
    setText(e.target.value);
    try { onChange(JSON.parse(e.target.value)); setErr(''); } catch (x) { setErr('Invalid JSON — not saved until fixed'); }
  }} />${err ? html`<p class="warn">${err}</p>` : null}</div>`;
}

/** Editor for a whole settings object with a sticky save bar. */
export function SettingsForm({ schema, value, onSave, only, saving }) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const change = v => { setDraft(v); setDirty(true); };
  const keys = only || Object.keys(schema.fields);
  return html`<div>
    ${keys.map(k => schema.fields[k].type === 'group'
      ? html`<${Group} key=${k} field=${schema.fields[k]} value=${draft[k]} onChange=${v => change({ ...draft, [k]: v })} />`
      : html`<section class="card" key=${k}><${FieldRow} field=${schema.fields[k]} value=${draft[k]} onChange=${v => change({ ...draft, [k]: v })} /></section>`)}
    <div class=${`savebar ${dirty ? 'show' : ''}`}>
      <span>Unsaved changes</span>
      <button class="btn ghost" onClick=${() => { setDraft(value); setDirty(false); }}>Discard</button>
      <button class="btn primary" disabled=${saving} onClick=${async () => { if (await onSave(draft) !== false) setDirty(false); }}>Save</button>
    </div>
  </div>`;
}

const KIND_LABEL = { fonts: 'Automatic', logos: 'No logo', music: 'Random track from my music folder' };
const ACCEPT = { fonts: '.ttf,.otf', logos: 'image/png,image/jpeg,image/webp', music: 'audio/*,.mp3,.m4a,.wav,.ogg,.flac' };
/** Choose an uploaded file (or system font), upload new ones, delete own uploads. */
function FilePicker({ kind, value, onChange }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => get(`/api/files/${kind}`).then(setFiles).catch(e => toast(e.message, 'err'));
  useEffect(load, [kind]);
  const upload = async e => {
    const list = [...(e.target.files || [])]; if (!list.length) return;
    setBusy(true);
    try {
      const fd = new FormData(); list.forEach(f => fd.append('file', f, f.name));
      const res = await fetch(`/api/files/${kind}`, { method: 'POST', body: fd, headers: { 'x-dashboard-token': getToken() } });
      const r = await res.json(); if (!res.ok) throw new Error(r.error || 'Upload failed');
      toast(`Uploaded ${r.saved.length} file(s)`); await load();
      if (r.saved[0] && kind !== 'music') onChange(r.saved[0]);
    } catch (x) { toast(x.message, 'err'); } finally { setBusy(false); e.target.value = ''; }
  };
  const remove = async () => {
    if (!value || value.startsWith('system:') || !confirm(`Delete ${value}?`)) return;
    try { await del(`/api/files/${kind}/${encodeURIComponent(value)}`); onChange(''); load(); } catch (x) { toast(x.message, 'err'); }
  };
  const own = files.filter(f => f.own);
  return html`<div class="filepick">
    <div class="row">
      <select value=${value} onChange=${e => onChange(e.target.value)}>
        <option value="">${KIND_LABEL[kind]}</option>
        ${files.map(f => html`<option value=${f.value}>${f.label}</option>`)}
      </select>
      ${value && !value.startsWith('system:') ? html`<button class="btn small ghost" onClick=${remove}>Delete</button>` : null}
    </div>
    <div class="row wrap">
      <label class="btn small">${busy ? 'Uploading…' : '⬆ Upload'}<input type="file" hidden multiple=${kind === 'music'} accept=${ACCEPT[kind]} onChange=${upload} /></label>
      ${kind === 'music' ? html`<span class="muted small">${own.length} track(s) in your music folder</span>` : null}
      ${kind === 'logos' && value ? html`<img class="logoprev" src=${`/uploads/logos/${encodeURIComponent(value)}`} alt="" />` : null}
    </div>
  </div>`;
}
