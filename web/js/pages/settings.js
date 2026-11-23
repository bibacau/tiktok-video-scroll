import { useEffect, useState } from 'preact/hooks';
import { html, get, put, post, guard, toast, getToken } from '../api.js';
import { SettingsForm } from '../form.js';
import { useShared, reloadPresets } from '../store.js';

/** Edit some groups of the app-wide settings. */
export function AppSettingsForm({ only }) {
  const sh = useShared();
  const [value, setValue] = useState(null);
  const [version, setVersion] = useState(0);
  useEffect(() => { get('/api/app-settings').then(setValue).catch(e => toast(e.message, 'err')); }, [version]);
  if (!value) return html`<p class="muted pad">Loading…</p>`;
  const save = async draft => {
    try {
      const r = await put('/api/app-settings', { ...value, ...draft });
      setValue(r.settings); setVersion(v => v + 1); toast('Saved');
      for (const w of r.warnings || []) toast(w.message, 'warn');
      return true;
    } catch (e) { toast(e.message, 'err'); return false; }
  };
  return html`<${SettingsForm} key=${version} schema=${sh.schema.app} value=${value} only=${only} onSave=${save} />`;
}

export function SettingsPage() {
  const [info, setInfo] = useState(null);
  const [withMemory, setWithMemory] = useState(true);
  useEffect(() => { get('/api/info').then(setInfo).catch(() => {}); }, []);
  const exportFile = guard(async () => {
    const res = await fetch(`/api/export?memory=${withMemory ? 1 : 0}`, { headers: { 'x-dashboard-token': getToken() } });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob(), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `tiktok-agent-settings-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
  const importFile = guard(async e => {
    const file = e.target.files?.[0]; if (!file) return;
    const doc = JSON.parse(await file.text());
    if (!confirm('Import will replace your presets, prompts and settings (API keys are kept). Continue?')) return;
    await post('/api/import', doc); await reloadPresets(); toast('Imported — reloading'); setTimeout(() => location.reload(), 800);
  });
  return html`<div>
    ${info ? html`<section class="card"><h3>Open on your phone</h3>
      <p>Same Wi-Fi: ${info.lan.map(ip => html`<code>http://${ip}:${location.port || 80}</code> `)}</p>
      <p class="help">If it doesn't open, allow Node.js through Windows Firewall (see README). Set a dashboard password below if others use your Wi-Fi.</p></section>` : null}
    <section class="card"><h3>Backup</h3>
      <p class="help">Export/import all presets, prompts and settings as JSON. API keys and passwords are never exported.</p>
      <div class="row wrap">
        <label class="row"><input type="checkbox" checked=${withMemory} onChange=${e => setWithMemory(e.target.checked)} /> include persona & interest memory</label>
        <button class="btn" onClick=${exportFile}>Export JSON</button>
        <label class="btn">Import JSON<input type="file" accept="application/json,.json" hidden onChange=${importFile} /></label>
      </div>
    </section>
    <${AppSettingsForm} only=${['general', 'llm', 'media', 'tools', 'browser', 'notifications', 'selectors']} />
  </div>`;
}
