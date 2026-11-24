import type { Page } from 'playwright-core';
import { BrowserManager, runScript } from './edge.ts';
import { getAppSettings } from '../settings/store.ts';
import { DEFAULT_SELECTORS } from '../settings/schema.ts';
import { sleep } from '../time.ts';

export type SourceKind = 'foryou' | 'search' | 'hashtag' | 'creator';
export interface Source { kind: SourceKind; value?: string }

export interface VideoInfo {
  key: string; url: string | null; author: string; desc: string; hashtags: string[]; music: string;
  stats: { likes: string; comments: string; shares: string; saves: string };
  duration: number | null; currentTime: number; paused: boolean; readyState: number;
  rect: { x: number; y: number; width: number; height: number };
  isAd: boolean; isLive: boolean; containerFound: boolean;
}
export interface Inspection { url: string; guard: { kind: 'captcha' | 'login'; detail: string } | null; video: VideoInfo | null; gridCount: number }

export const selectors = (): typeof DEFAULT_SELECTORS => {
  const custom = getAppSettings().selectors;
  const out: any = { ...DEFAULT_SELECTORS };
  // Your saved selectors are tried first; built-in ones are added after them, so new defaults from an
  // update still apply even when your saved copy (from an older version) already has that key.
  if (custom && typeof custom === 'object') for (const [k, v] of Object.entries(custom)) {
    if (Array.isArray(v) && v.every(x => typeof x === 'string')) out[k] = [...new Set([...v, ...((DEFAULT_SELECTORS as any)[k] ?? [])])];
  }
  return out;
};

export function sourceUrl(src: Source) {
  const base = getAppSettings().browser.baseUrl.replace(/\/+$/, '');
  const v = encodeURIComponent((src.value ?? '').replace(/^[#@]/, '').trim());
  switch (src.kind) {
    case 'foryou': return `${base}/foryou`;
    case 'search': return `${base}/search/video?q=${v}`;
    case 'hashtag': return `${base}/tag/${v}`;
    case 'creator': return `${base}/@${v}`;
  }
}

/** All tiktok.com page driving lives here. Selectors come from settings. */
export class TikTok {
  browser: BrowserManager;
  constructor(browser: BrowserManager) { this.browser = browser; }

  inspect(): Promise<Inspection> {
    return this.browser.guarded(page => runScript<Inspection>(page, 'inspect', selectors()), 'inspect page', 20_000);
  }

  async open(src: Source, signal?: AbortSignal): Promise<Inspection> {
    const url = sourceUrl(src);
    await this.browser.guarded(page => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }), `open ${url}`, 60_000);
    return this.afterOpen(src, signal);
  }

  /**
   * Type a search into TikTok's own search bar like a person: click the box, type character by
   * character with small random pauses, press Enter. Falls back to the search URL only if no box is found.
   */
  async searchTyped(query: string, signal?: AbortSignal): Promise<{ method: 'typed' | 'url'; inspection: Inspection }> {
    const sel = selectors();
    const findBox = async (page: Page) => {
      for (const s of sel.searchInput) { const l = page.locator(s).first(); if (await l.isVisible().catch(() => false)) return l; }
      return null;
    };
    const typed = await this.browser.guarded(async page => {
      let box = await findBox(page);
      if (!box) { await runScript(page, 'clickFirst', sel.searchOpen); await sleep(800, signal); box = await findBox(page); }
      if (!box) return false;
      await box.click();
      await sleep(250 + Math.random() * 400, signal);
      await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
      for (const ch of query) { await page.keyboard.type(ch); await sleep(60 + Math.random() * 160, signal); }
      await sleep(300 + Math.random() * 500, signal);
      await page.keyboard.press('Enter');
      return true;
    }, 'type search', 90_000);
    if (!typed) return { method: 'url', inspection: await this.open({ kind: 'search', value: query }, signal) };
    await sleep(1500, signal);
    return { method: 'typed', inspection: await this.afterOpen({ kind: 'search', value: query }, signal) };
  }

  /** Wait for a playing video or a grid of results (opening the first result). */
  private async afterOpen(src: Source, signal?: AbortSignal): Promise<Inspection> {
    // Wait for a playing video or a grid of results.
    let last: Inspection | null = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1000, signal);
      last = await this.inspect();
      if (last.guard || last.video) return last;
      if (src.kind !== 'foryou' && last.gridCount > 0) break;
    }
    if (last && !last.video && last.gridCount > 0) {
      await this.browser.guarded(page => runScript(page, 'clickGridItem', { selectors: selectors().gridItem, index: 0 }), 'open first result');
      for (let i = 0; i < 12; i++) {
        await sleep(1000, signal);
        last = await this.inspect();
        if (last.guard || last.video) return last;
      }
    }
    return last ?? await this.inspect();
  }

  /** Wait until a video is in view and has data. */
  async waitForVideo(signal?: AbortSignal, seconds = 12): Promise<Inspection> {
    let last = await this.inspect();
    for (let i = 0; i < seconds * 2 && !last.guard && (!last.video || last.video.readyState < 2); i++) {
      await sleep(500, signal);
      last = await this.inspect();
    }
    return last;
  }

  /** Go to the next video. Tries keyboard, then the "next" button, then scrolling. */
  async next(signal?: AbortSignal): Promise<boolean> {
    const before = (await this.inspect()).video?.key;
    const changed = async () => {
      for (let i = 0; i < 8; i++) {
        await sleep(400, signal);
        const now = (await this.inspect()).video?.key;
        if (now && now !== before) return true;
      }
      return false;
    };
    const attempts: Array<(p: Page) => Promise<unknown>> = [
      p => p.keyboard.press('ArrowDown'),
      p => runScript(p, 'clickFirst', selectors().nextButton),
      async p => { const vp = p.viewportSize() ?? await p.evaluate(() => ({ width: innerWidth, height: innerHeight })); await p.mouse.move(vp.width / 2, vp.height / 2); await p.mouse.wheel(0, vp.height * 0.9); },
    ];
    for (const attempt of attempts) {
      await this.browser.guarded(attempt, 'next video');
      if (await changed()) return true;
    }
    return false;
  }

  /** One JPEG frame of the video element. */
  async frame(rect: VideoInfo['rect']): Promise<Buffer> {
    const q = getAppSettings().browser.frameQuality;
    return this.browser.guarded(() => this.browser.capture({ clip: rect, quality: q, maxWidth: 720 }), 'capture frame', 20_000);
  }

  setPlaying(play: boolean) {
    return this.browser.guarded(page => runScript(page, 'setPlaying', play), play ? 'play' : 'pause', 10_000).catch(() => {});
  }
}
