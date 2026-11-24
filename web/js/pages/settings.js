import { useEffect, useState } from 'preact/hooks';
import { html, get, put, post, patch, guard, toast, getToken } from '../api.js';
import { SettingsForm } from '../form.js';
import { useShared, reloadPresets } from '../store.js';

/** Edit some groups of the app-wide settings. Each group is saved on its own. */
export function AppSettingsForm({ only }) {
  const sh = useShared();
  const [data, setData] = useState(null);
  const load = () => get('/api/app-settings').then(setData).catch(e => toast(e.message, 'err'));
  useEffect(() => {
    load();
    const on = e => { if (e.detail.scope === 'app' && only.includes(e.detail.group)) load(); };
    window.addEventListener('settingsChanged', on);
    return () => window.removeEventListener('settingsChanged', on);
  }, []);
  if (!data) return html`<p class="muted pad">Loading…</p>`;
  const save = async (group, value, version) => {
    const r = await patch(`/api/app-settings/groups/${group}`, { value, version });
    setData(d => ({ ...d, [group]: r.settings[group], _versions: { ...d._versions, [group]: r.version } }));
    return r;
  };
  const groups = only.map(k => ({ key: k, field: sh.schema.app.fields[k], value: data[k], version: data._versions?.[k] ?? '0' }));
  return html`<${SettingsForm} key=${only.join(',')} groups=${groups} onSave=${save} onReload=${load} />`;
}

export function SettingsPage() {
  const [info, setInfo] = useState(null);
  const [withMemory, setWithMemory] = useState(true);
  useEffect(() => { get('/api/info').then(setInfo).catch(() => {}); }, []);
  const stopApp = guard(async () => {
    if (!confirm('Stop the whole app? You will need the TikTok Agent shortcut on your PC to start it again.')) return;
    await post('/api/shutdown');
    document.body.innerHTML = '<div style="font:16px system-ui;padding:40px;text-align:center"><h2>The app is stopped</h2><p>Start it again with the <b>TikTok Agent</b> shortcut on your PC.</p></div>';
  });
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
    ${info?.dataDir ? html`<section class="card"><h3>Data folder</h3><p><code class="breakall">${info.dataDir}</code></p>
      <p class="help">Your settings, API keys, Edge profiles and videos live here. If settings seem to "disappear", check that you're not running a second copy of the app from a different folder: the path is also written to the log at every start.</p></section>` : null}
    <section class="card"><h3>Stop the app</h3>
      <p class="help">Stops watching, closes the agent's Edge window and shuts the app down. Start it again with the <b>TikTok Agent</b> shortcut on your PC.</p>
      <button class="btn danger" onClick=${stopApp}>⏻ Stop the app</button>
    </section>
    <section class="card"><h3>Backup</h3>
      <p class="help">Export/import all presets, prompts and settings as JSON. API keys and passwords are never exported.</p>
      <div class="row wrap">
        <label class="row"><input type="checkbox" checked=${withMemory} onChange=${e => setWithMemory(e.target.checked)} /> include persona & interest memory</label>
        <button class="btn" onClick=${exportFile}>Export JSON</button>
        <label class="btn">Import JSON<input type="file" accept="application/json,.json" hidden onChange=${importFile} /></label>
      </div>
    </section>
    <${AppSettingsForm} only=${['general', 'llm', 'media', 'tools', 'browser', 'notifications', 'selectors', 'postSelectors']} />
  </div>`;
}
