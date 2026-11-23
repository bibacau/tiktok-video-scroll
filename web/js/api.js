import { h } from 'preact';
import htm from 'htm';
export const html = htm.bind(h);

let token = '';
try { token = localStorage.getItem('dashToken') || ''; } catch {}
export const setToken = t => { token = t; try { localStorage.setItem('dashToken', t); } catch {} };
export const getToken = () => token;

export async function api(method, url, body) {
  const res = await fetch(url, {
    method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), 'x-dashboard-token': token },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 401) { window.dispatchEvent(new Event('need-login')); }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}
export const get = url => api('GET', url);
export const put = (url, b) => api('PUT', url, b ?? {});
export const post = (url, b) => api('POST', url, b ?? {});
export const del = url => api('DELETE', url);

// tiny toast
export function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, kind === 'err' ? 6000 : 2500);
}
export const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, 'err'); } };

export const fmtDur = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${String(x).padStart(2, '0')}s` : `${x}s`; };
export const fmtTime = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const rm = n => `RM${(Number(n) || 0).toFixed(2)}`;

export const FRAME_MODES = {
  images: ['🖼', 'images sent to the AI'], vision: ['👁', 'vision helper'], text: ['📝', 'text only (no image understanding)'], none: ['—', 'no frames'],
};
export function frameBadge(f) {
  if (!f?.mode) return null;
  const [icon, label] = FRAME_MODES[f.mode] ?? ['?', f.mode];
  return html`<span class=${`pill small fm-${f.mode}`} title=${f.description || ''}>${icon} ${label}${f.mode === 'vision' && f.visionModel ? ` (${f.visionModel})` : ''}</span>`;
}
