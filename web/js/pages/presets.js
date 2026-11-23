import { useState } from 'preact/hooks';
import { html, put, post, del, guard, toast } from '../api.js';
import { SettingsForm } from '../form.js';
import { useShared, reloadPresets, selectPreset } from '../store.js';

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];

export function PresetBar() {
  const sh = useShared();
  return html`<div class="presetbar">
    <span class="muted">Editing preset</span>
    <select value=${sh.presetId} onChange=${e => selectPreset(e.target.value)}>${sh.presets.map(p => html`<option value=${p.id}>${p.name}</option>`)}</select>
    <a href="#presets" class="small">manage</a>
  </div>`;
}

/** Edit one section (watch / schedule / save / engagement) of the selected preset. */
export function PresetSection({ section }) {
  const sh = useShared();
  const [saving, setSaving] = useState(false);
  const preset = sh.presets.find(p => p.id === sh.presetId);
  if (!preset) return html`<p class="pad muted">No preset.</p>`;
  const schema = sh.schema.preset.fields[section];
  const save = async draft => {
    setSaving(true);
    try {
      const r = await put(`/api/presets/${preset.id}`, { data: { ...preset.data, [section]: draft } });
      await reloadPresets();
      toast('Saved');
      for (const w of r.warnings || []) if (w.path.startsWith(section)) toast(w.message, 'warn');
      return true;
    } catch (e) { toast(e.message, 'err'); return false; } finally { setSaving(false); }
  };
  return html`<div>
    <${PresetBar} />
    ${schema.phase ? html`<p class="note">These settings are saved now; the feature that uses them arrives in phase ${schema.phase}.</p>` : null}
    <${SettingsForm} key=${preset.id + preset.updated_at} schema=${schema} value=${preset.data[section]} onSave=${save} saving=${saving} />
  </div>`;
}

export function PresetsPage() {
  const sh = useShared();
  const [name, setName] = useState('');
  const create = guard(async copyFrom => {
    const p = await post('/api/presets', { name: name || undefined, copyFrom });
    setName(''); await reloadPresets(); selectPreset(p.id); toast(`Created "${p.name}"`);
  });
  const rename = guard(async (p, n) => { if (n && n !== p.name) { await put(`/api/presets/${p.id}`, { name: n }); await reloadPresets(); } });
  const remove = guard(async p => { if (confirm(`Delete preset "${p.name}"?`)) { await del(`/api/presets/${p.id}`); await reloadPresets(); } });
  const setDay = guard(async (d, id) => { await put('/api/day-presets', { ...sh.dayPresets, [d]: id }); await reloadPresets(); toast('Saved'); });
  return html`<div class="grid2">
    <section class="card">
      <h3>Presets</h3>
      <p class="help">Each preset holds its own watch, schedule, save and engagement settings (and later create/post settings).</p>
      ${sh.presets.map(p => html`<div class="presetrow">
        <input value=${p.name} onChange=${e => rename(p, e.target.value.trim())} />
        <button class="btn small" onClick=${() => { selectPreset(p.id); location.hash = 'watch'; }}>Edit</button>
        <button class="btn small ghost" onClick=${() => create(p.id)}>Duplicate</button>
        <button class="btn small ghost" disabled=${sh.presets.length < 2} onClick=${() => remove(p)}>Delete</button>
      </div>`)}
      <div class="row"><input placeholder="New preset name, e.g. Tech research" value=${name} onInput=${e => setName(e.target.value)} /><button class="btn primary" onClick=${() => create()}>Add</button></div>
    </section>
    <section class="card">
      <h3>Which preset runs on which day</h3>
      ${DAYS.map(([d, label]) => html`<div class="field inline"><label class="label">${label}</label>
        <select value=${sh.dayPresets[d]} onChange=${e => setDay(d, e.target.value)}>${sh.presets.map(p => html`<option value=${p.id}>${p.name}</option>`)}</select></div>`)}
    </section>
  </div>`;
}
