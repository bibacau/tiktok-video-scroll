import { useEffect, useState } from 'preact/hooks';
import { get, getToken } from './api.js';

// ------- live connection (status, screenshot, log) shared by all pages -------
export const live = { status: null, screenshot: null, logs: [], subs: new Set() };
export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(getToken())}`);
  ws.onmessage = ev => {
    const { type, data } = JSON.parse(ev.data);
    if (type === 'status') {
      const prev = live.status;
      live.status = data; live.statusAt = Date.now();
      if (data.alert && (!prev?.alert || prev.alert.at !== data.alert.at)) notifyAlert(data.alert);
    } else if (type === 'screenshot') live.screenshot = data;
    else if (type === 'log') live.logs = [data, ...live.logs].slice(0, 100);
    else if (type === 'creation' || type === 'creatorQueue' || type === 'creationDeleted') { window.dispatchEvent(new CustomEvent(type, { detail: data })); return; }
    live.subs.forEach(fn => fn());
  };
  ws.onclose = () => { live.connected = false; live.subs.forEach(fn => fn()); setTimeout(connect, 2000); };
  ws.onopen = () => { live.connected = true; live.subs.forEach(fn => fn()); };
}
export function useLive() {
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force(x => x + 1); live.subs.add(fn); return () => live.subs.delete(fn); }, []);
  return live;
}
function notifyAlert(alert) {
  try { navigator.vibrate?.([300, 100, 300]); } catch {}
  try {
    const ctx = new AudioContext(), o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.1; o.start(); o.stop(ctx.currentTime + 0.4);
  } catch {}
  if ('Notification' in window && Notification.permission === 'granted') new Notification('TikTok agent needs you', { body: alert.message });
  document.title = '⚠️ Needs you — TikTok agent';
}

// ------- shared data: schema, presets -------
export const shared = { schema: null, presets: [], dayPresets: {}, presetId: null, subs: new Set() };
export async function reloadPresets() {
  const r = await get('/api/presets');
  shared.presets = r.presets; shared.dayPresets = r.dayPresets;
  let saved = null; try { saved = localStorage.getItem('presetId'); } catch {}
  if (!shared.presets.some(p => p.id === shared.presetId)) shared.presetId = shared.presets.some(p => p.id === saved) ? saved : shared.presets[0]?.id;
  shared.subs.forEach(fn => fn());
}
export function selectPreset(id) { shared.presetId = id; try { localStorage.setItem('presetId', id); } catch {} shared.subs.forEach(fn => fn()); }
export function useShared() {
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force(x => x + 1); shared.subs.add(fn); return () => shared.subs.delete(fn); }, []);
  return shared;
}

