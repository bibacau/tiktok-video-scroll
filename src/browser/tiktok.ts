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
  if (custom && typeof custom === 'object') for (const [k, v] of Object.entries(custom)) if (Array.isArray(v) && v.every(x => typeof x === 'string')) out[k] = v;
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
