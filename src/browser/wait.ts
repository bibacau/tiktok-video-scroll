// "Wait until it appears" instead of "sleep, then look once": Edge and TikTok sometimes load slowly.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { paths } from '../paths.ts';

/** Poll `check` until it returns something truthy (or the time is up → null). */
export async function until<T>(check: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 10_000, every = 250): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    let v: any = null;
    try { v = await check(); } catch { v = null; }
    if (v) return v as T;
    if (Date.now() >= end) return null;
    await new Promise(r => setTimeout(r, every));
  }
}

/** Screenshot + visible page text, saved for a failing step (shown on the dashboard). */
export async function captureDebug(page: Page | null, label: string, focusSelectors: string[] = []): Promise<{ screenshot?: string; pageText?: string }> {
  if (!page || page.isClosed()) return {};
  const out: { screenshot?: string; pageText?: string } = {};
  try {
    const file = path.join(paths.media, `debug-${label}-${Date.now()}.jpg`);
    fs.writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 70, timeout: 8000 }));
    out.screenshot = `/media/${path.basename(file)}`;
  } catch { /* best effort */ }
  try {
    out.pageText = String(await page.evaluate(`(() => {
      const sels = ${JSON.stringify(focusSelectors)};
      for (const s of sels) { try { const el = [...document.querySelectorAll(s)].find(e => e.getBoundingClientRect().height > 0); if (el) return el.innerText; } catch (e) {} }
      return document.body ? document.body.innerText : '';
    })()`)).slice(0, 3000);
  } catch { /* best effort */ }
  return out;
}
