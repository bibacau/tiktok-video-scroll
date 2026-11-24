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

/** Save → Share: run the whole share flow once on a saved video while you watch, step by step. */
export function ShareTest() {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState(null);
  const run = async () => {
    setBusy(true); setR(null);
    try { setR(await post('/api/shares/test', {})); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return html`<section class="card"><h3>📤 Test share now</h3>
    <p class="help">Opens your most recent saved video in the watcher's Edge window and sends it to the account in "Send to" — watch the window while it runs. Each step's result is shown below; if a step fails, a screenshot and the share panel's text are saved so the selectors can be fixed.</p>
    <button class="btn" disabled=${busy} onClick=${run}>${busy ? 'Sharing… watch the Edge window' : 'Test share now'}</button>
    ${r ? html`<div class="sharetest">
      <p><b>${r.ok ? '✅ Sent' : '❌ Not sent'}</b> ${r.video ? html`· <a href=${r.video} target="_blank" rel="noopener">video ↗</a>` : null}</p>
      <ol>${r.steps.map(s => html`<li class=${s.ok ? 'okt' : 'errt'}>${s.ok ? '✓' : '✗'} ${s.step}${s.detail ? html` <span class="muted small">— ${s.detail}</span>` : null}</li>`)}</ol>
      ${!r.ok && r.message ? html`<p class="warn">${r.message}</p>` : null}
      ${r.screenshot ? html`<p class="small">Screenshot of the failing step:</p><img class="shot" src=${r.screenshot} alt="" />` : null}
      ${r.panelText ? html`<details open><summary class="small">Text visible in the share panel</summary><pre class="mono small summary">${r.panelText}</pre></details>` : null}
    </div>` : null}
  </section>`;
}

/** Engage → Private messages: check now + last result. */
export function InboxPanel() {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState(null);
  const run = async () => { setBusy(true); try { setR(await post('/api/messages/check')); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  return html`<section class="card"><h3>💬 Private messages</h3>
    <p class="help">Checks unread chats now (normally every few minutes while the app runs, and after each watching session). Drafts wait in Post → Queue when approval is on. Everything read and sent is in History → Messages.</p>
    <button class="btn" disabled=${busy} onClick=${run}>${busy ? 'Checking… (watch the Edge window)' : 'Check inbox now'}</button>
    ${r ? html`<p class=${r.error ? 'warn' : 'small'}>${r.error ?? r.skipped ?? `${r.conversations} unread chat(s) · ${r.replied + (r.sentApproved || 0)} replied · ${r.pending} waiting for approval · ${r.ignored} ignored · ${r.flagged} flagged for you`}</p>` : null}
  </section>`;
}
