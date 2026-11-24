// Renders any settings schema (from /api/schema) as a form. No per-setting UI code needed.
import { useEffect, useRef, useState } from 'preact/hooks';
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
    : field.type === 'select' && field.warnValues?.[value] ? field.warnValues[value]
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
      </div>${isSet ? html`<div class="secretok">✓ Saved (${value.hint})</div>` : typeof value === 'string' && value ? html`<div class="muted small">New key — will be saved</div>` : html`<div class="muted small">Not set</div>`}`;
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
    case 'account': return html`<${AccountPicker} value=${value || ''} onChange=${onChange} />`;
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

/** Parse JSON, repairing what copy-paste typically breaks: curly quotes and trailing commas. */
export function tolerantJson(text) {
  try { return JSON.parse(text); } catch { /* try a repair */ }
  const fixed = text.replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(fixed);
}

function JsonInput({ value, rows, onChange }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [err, setErr] = useState('');
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  // Show the saved value when it changes elsewhere (not while you are typing in the box).
  useEffect(() => {
    if (focused || err) return;
    let same = false; try { same = JSON.stringify(tolerantJson(text)) === JSON.stringify(value); } catch { /* */ }
    if (!same) setText(JSON.stringify(value, null, 2));
  }, [JSON.stringify(value)]);
  const report = invalid => ref.current?.dispatchEvent(new CustomEvent('json-invalid', { bubbles: true, detail: { invalid } }));
  return html`<div><textarea ref=${ref} class="mono" rows=${rows || 10} value=${text} onFocus=${() => setFocused(true)} onBlur=${() => setFocused(false)} onInput=${e => {
    setText(e.target.value);
    try { onChange(tolerantJson(e.target.value)); setErr(''); report(false); }
    catch (x) { setErr(`Invalid JSON — NOT saved: ${String(x.message).slice(0, 120)}`); report(true); }
  }} />${err ? html`<p class="warn">⚠️ ${err}. Fix it (or press Discard) — the old value is still in use.</p>` : null}</div>`;
}

/** Forms with changes that are not saved yet (pending autosave, failed or conflicting). */
export const unsaved = new Map(); // id → { flush, state }
let formSeq = 0;

/**
 * Editor for one or more settings groups. Each group is saved on its own (only that group is sent,
 * with the version it was loaded at), automatically ~1.5 s after the last change.
 *   groups: [{ key, field, value, version }]   onSave(key, value, version) → { version } (throws on 409)
 *   mode 'fields' renders the fields of a single group as cards (preset sections); 'groups' renders each group as a card.
 */
export function SettingsForm({ groups, onSave, onReload, mode = 'groups', autosave = true }) {
  const [id] = useState(() => `form${++formSeq}`);
  const [drafts, setDrafts] = useState(() => Object.fromEntries(groups.map(g => [g.key, g.value])));
  const [base, setBase] = useState(() => Object.fromEntries(groups.map(g => [g.key, g.version])));
  const [dirty, setDirty] = useState({});
  const [state, setState] = useState('idle'); // idle | pending | saving | saved | error | conflict
  const [error, setError] = useState('');
  const timers = useRef({}), seq = useRef({}), inFlight = useRef({}), live = useRef({ drafts, base, dirty });
  live.current = { drafts, base, dirty };

  // Take new values from the server whenever they change — unless that group has unsaved edits.
  const sig = groups.map(g => `${g.key}@${g.version}`).join('|');
  useEffect(() => {
    const d = { ...live.current.drafts }, b = { ...live.current.base };
    let conflict = false;
    for (const g of groups) {
      if (inFlight.current[g.key]) continue; // the echo of our own save
      if (live.current.dirty[g.key]) { if (g.version !== b[g.key]) conflict = true; continue; }
      d[g.key] = g.value; b[g.key] = g.version;
    }
    setDrafts(d); setBase(b);
    if (conflict) { setState('conflict'); setError('These settings were changed elsewhere — reload to see the latest'); }
  }, [sig]);

  const save = async key => {
    clearTimeout(timers.current[key]);
    const mySeq = seq.current[key] || 0;
    setState('saving');
    inFlight.current[key] = true;
    try {
      const r = await onSave(key, live.current.drafts[key], live.current.base[key]);
      live.current.base = { ...live.current.base, [key]: r.version };
      setBase(b => ({ ...b, [key]: r.version }));
      if ((seq.current[key] || 0) === mySeq) setDirty(x => { const n = { ...x }; delete n[key]; return n; });
      setState('saved'); setError('');
      for (const w of r.warnings || []) toast(w.message, 'warn');
    } catch (e) {
      if (/changed elsewhere|409/.test(e.message)) { setState('conflict'); setError('These settings were changed elsewhere — reload to see the latest'); }
      else { setState('error'); setError(e.message); }
    } finally { inFlight.current[key] = false; }
  };
  const saveAll = () => Promise.all(Object.keys(live.current.dirty).map(save));
  const change = (key, v) => {
    seq.current[key] = (seq.current[key] || 0) + 1;
    setDrafts(d => ({ ...d, [key]: v })); setDirty(x => ({ ...x, [key]: true }));
    if (state !== 'conflict') setState('pending');
    if (autosave && state !== 'conflict') { clearTimeout(timers.current[key]); timers.current[key] = setTimeout(() => save(key), 1500); }
  };
  const discard = () => {
    Object.values(timers.current).forEach(clearTimeout);
    setDrafts(Object.fromEntries(groups.map(g => [g.key, g.value]))); setBase(Object.fromEntries(groups.map(g => [g.key, g.version])));
    setDirty({}); setState('idle'); setError('');
  };
  const reload = async () => { discard(); await onReload?.(); };

  const rootRef = useRef(null);
  const [invalid, setInvalid] = useState(0);
  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    const bad = new Set();
    const on = e => { if (e.detail.invalid) bad.add(e.target); else bad.delete(e.target); setInvalid(bad.size); };
    el.addEventListener('json-invalid', on);
    return () => el.removeEventListener('json-invalid', on);
  }, []);
  const anyDirty = Object.keys(dirty).length > 0 || invalid > 0;
  useEffect(() => {
    if (anyDirty || state === 'conflict' || state === 'error') unsaved.set(id, { flush: saveAll, state: invalid ? 'error' : state });
    else unsaved.delete(id);
  }, [anyDirty, state, invalid]);
  // Leaving the page: save what is pending right away.
  useEffect(() => () => { if (Object.keys(live.current.dirty).length && autosave) saveAll(); unsaved.delete(id); }, []);

  const indicator = { pending: '✎ Unsaved…', saving: 'Saving…', saved: 'Saved ✓', error: '⚠️ Not saved', conflict: '⚠️ Changed elsewhere', idle: '' }[state];
  const body = mode === 'fields'
    ? groups.flatMap(g => Object.entries(g.field.fields).map(([k, f]) => {
        if (f.showIf && drafts[g.key]?.[f.showIf.field] !== f.showIf.equals) return null;
        const set = v => change(g.key, { ...drafts[g.key], [k]: v });
        return f.type === 'group'
          ? html`<${Group} key=${g.key + k} field=${f} value=${drafts[g.key]?.[k]} onChange=${set} />`
          : html`<section class="card" key=${g.key + k}><${FieldRow} field=${f} value=${drafts[g.key]?.[k]} onChange=${set} /></section>`;
      }))
    : groups.map(g => g.field.type === 'group'
        ? html`<${Group} key=${g.key} field=${g.field} value=${drafts[g.key]} onChange=${v => change(g.key, v)} />`
        : html`<section class="card" key=${g.key}><${FieldRow} field=${g.field} value=${drafts[g.key]} onChange=${v => change(g.key, v)} /></section>`);
  return html`<div class="settingsform" ref=${rootRef} data-state=${invalid ? 'error' : state}>
    ${invalid ? html`<div class="saveind error">⚠️ Invalid JSON — not saved</div>` : indicator ? html`<div class=${`saveind ${state}`}>${indicator}</div>` : null}
    ${state === 'conflict' ? html`<div class="banner">${error} <button class="btn small" onClick=${reload}>Reload</button></div>` : null}
    ${state === 'error' ? html`<div class="warn">Not saved: ${error} <button class="btn small" onClick=${saveAll}>Try again</button></div>` : null}
    ${body}
    <div class=${`savebar ${anyDirty || state === 'error' ? 'show' : ''}`}>
      <span>${invalid ? 'Invalid JSON — fix it to save' : state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : 'Unsaved changes (saving automatically)'}</span>
      <button class="btn ghost" onClick=${discard}>Discard</button>
      <button class="btn primary" disabled=${state === 'conflict'} onClick=${saveAll}>Save now</button>
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

function AccountPicker({ value, onChange }) {
  const [list, setList] = useState(null);
  useEffect(() => { get('/api/accounts').then(setList).catch(() => setList([])); }, []);
  if (!list) return html`<span class="muted">Loading…</span>`;
  return html`<div class="row"><select value=${value} onChange=${e => onChange(e.target.value)}>
    <option value="">— choose an account —</option>
    ${list.map(a => html`<option value=${a.id}>${a.name}${a.handle ? ` (@${a.handle})` : ''}${a.login.loggedIn ? '' : ' — not logged in'}</option>`)}
  </select><a class="small" href="#post" onClick=${() => { try { localStorage.setItem('postTab', 'accounts'); } catch {} }}>manage</a></div>`;
}
