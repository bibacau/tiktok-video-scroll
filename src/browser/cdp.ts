// Minimal raw Chrome DevTools Protocol client for browser-level commands
// (read cookies, close the browser, screenshot one tab) WITHOUT Playwright attaching to pages.
import WebSocket from 'ws';

export async function cdpVersion(port: number, timeoutMs = 1500): Promise<{ webSocketDebuggerUrl: string; Browser: string } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.json() as any : null;
  } catch { return null; }
}

export async function cdpTargets(port: number): Promise<Array<{ id: string; type: string; url: string; title: string; webSocketDebuggerUrl?: string }>> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() as any : [];
  } catch { return []; }
}

/** Send commands over one websocket (browser or page target) and close it. */
export async function cdpCall<T = any>(wsUrl: string, calls: Array<{ method: string; params?: Record<string, unknown> }>, timeoutMs = 10_000): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    const results: T[] = []; let id = 0;
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('CDP call timed out')); }, timeoutMs);
    const next = () => {
      if (id >= calls.length) { clearTimeout(timer); ws.close(); resolve(results); return; }
      const c = calls[id++]; ws.send(JSON.stringify({ id, method: c.method, params: c.params ?? {} }));
    };
    ws.on('open', next);
    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== id) return; // events / other replies
      if (msg.error) { clearTimeout(timer); ws.close(); reject(new Error(msg.error.message)); return; }
      results.push(msg.result); next();
    });
    ws.on('error', e => { clearTimeout(timer); reject(e); });
    ws.on('close', () => { if (id < calls.length || results.length < calls.length) { clearTimeout(timer); reject(new Error('CDP connection closed')); } });
  });
}

export async function browserCall<T = any>(port: number, method: string, params?: Record<string, unknown>): Promise<T> {
  const v = await cdpVersion(port);
  if (!v) throw new Error('Browser is not running');
  return (await cdpCall<T>(v.webSocketDebuggerUrl, [{ method, params }]))[0];
}

export async function getCookies(port: number): Promise<Array<{ name: string; value: string; domain: string; expires: number }>> {
  return (await browserCall<any>(port, 'Storage.getCookies')).cookies ?? [];
}

/** Screenshot of one tab by URL match, captured from the compositor (no resize, no emulation). */
export async function tabScreenshot(port: number, match: (url: string) => boolean, quality = 55): Promise<{ url: string; jpeg: Buffer } | null> {
  const t = (await cdpTargets(port)).find(x => x.type === 'page' && match(x.url) && x.webSocketDebuggerUrl);
  if (!t) return null;
  const [shot] = await cdpCall<any>(t.webSocketDebuggerUrl!, [{ method: 'Page.captureScreenshot', params: { format: 'jpeg', quality, fromSurface: true, captureBeyondViewport: false } }]);
  return { url: t.url, jpeg: Buffer.from(shot.data, 'base64') };
}
