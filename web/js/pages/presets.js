import { useState } from 'preact/hooks';
import { html, put, post, del, patch, guard, toast } from '../api.js';
import { SettingsForm } from '../form.js';
import { useShared, reloadPresets, selectPreset, applyPresetSave } from '../store.js';

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
  const preset = sh.presets.find(p => p.id === sh.presetId);
  if (!preset) return html`<p class="pad muted">No preset.</p>`;
  const field = sh.schema.preset.fields[section];
  const version = sh.versions[preset.id]?.[section] ?? '0';
  // Only this section is sent, with the version it was loaded at; the server merges it.
  const save = async (_key, value, base) => {
    const r = await patch(`/api/presets/${preset.id}/sections/${section}`, { value, version: base });
    applyPresetSave(r.preset, section, r.version);
    return r;
  };
  return html`<div>
    <${PresetBar} />
    ${field.phase ? html`<p class="note">These settings are saved now; the feature that uses them arrives in phase ${field.phase}.</p>` : null}
    <${SettingsForm} key=${`${section}:${preset.id}`} mode="fields" groups=${[{ key: section, field, value: preset.data[section], version }]} onSave=${save} onReload=${reloadPresets} />
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
