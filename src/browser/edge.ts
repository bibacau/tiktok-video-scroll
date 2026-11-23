import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { paths } from '../paths.ts';
import { getAppSettings } from '../settings/store.ts';
import { log } from '../log.ts';

const SCRIPTS = fs.readFileSync(path.join(paths.root, 'src', 'browser', 'page-scripts.js'), 'utf8');

/** Run a function from page-scripts.js inside the page. */
export function runScript<T = any>(page: Page, name: string, arg: unknown = null): Promise<T> {
  return page.evaluate(`(() => { ${SCRIPTS}\n return ${name}(${JSON.stringify(arg)}); })()`) as Promise<T>;
}

export class HungError extends Error { code = 'BROWSER_HUNG'; }

/** Kill only the browser processes that use OUR profile folder (never the user's normal Edge). */
function killProfileProcesses(profileDir: string): Promise<void> {
  return new Promise(resolve => {
    if (process.platform === 'win32') {
      const escaped = profileDir.replace(/'/g, "''");
      const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escaped}*' -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], () => resolve());
    } else execFile('pkill', ['-f', `--user-data-dir=${profileDir}`], () => resolve());
  });
}

/**
 * One dedicated, persistent browser profile. Survives crashes: `ensure()` relaunches if the
 * browser died, and `guarded()` turns a hang into a HungError so the caller can restart.
 */
export class BrowserManager {
  ctx: BrowserContext | null = null;
  page: Page | null = null;
  private launching: Promise<Page> | null = null;
  restarts = 0;
  closedByUs = false;
  private crashed = false;

  profile: () => string;
  constructor(profile: () => string = () => getAppSettings().browser.profileName) { this.profile = profile; }

  profileDir() { return path.join(paths.profiles, this.profile().replace(/[^\w.-]/g, '_') || 'watcher'); }
  isOpen() { return !!this.ctx && !!this.page && !this.page.isClosed(); }

  async ensure(): Promise<Page> {
    if (this.isOpen()) return this.page!;
    if (!this.launching) this.launching = this.launch().finally(() => { this.launching = null; });
    return this.launching;
  }

  private async launch(): Promise<Page> {
    const b = getAppSettings().browser;
    const dir = this.profileDir();
    if (this.crashed) {
      this.crashed = false; this.restarts++;
      log('warn', 'watchdog', `Relaunching browser after crash (restart #${this.restarts})`);
      await killProfileProcesses(dir);
    }
    fs.mkdirSync(dir, { recursive: true });
    const args = [`--window-size=${b.windowWidth},${b.windowHeight}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'];
    if (b.muteAudio) args.push('--mute-audio');
    log('info', 'browser', `Opening ${b.channel === 'custom' ? 'custom browser' : b.channel} with profile "${path.basename(dir)}"`);
    const ctx = await chromium.launchPersistentContext(dir, {
      channel: b.channel === 'custom' ? undefined : b.channel,
      executablePath: b.channel === 'custom' ? (b.executablePath || process.env.BROWSER_PATH) : undefined,
      headless: b.headless,
      viewport: b.headless ? { width: b.windowWidth, height: b.windowHeight } : null,
      args,
      ignoreDefaultArgs: ['--enable-automation'],
      locale: 'en-US',
      timezoneId: getAppSettings().general.timezone,
    });
    this.closedByUs = false;
    ctx.on('close', () => {
      if (!this.closedByUs) { this.crashed = true; log('warn', 'watchdog', 'Browser closed or crashed unexpectedly'); }
      this.ctx = null; this.page = null;
    });
    this.ctx = ctx;
    this.page = ctx.pages()[0] ?? await ctx.newPage();
    for (const extra of ctx.pages().slice(1)) await extra.close().catch(() => {});
    this.page.setDefaultTimeout(30_000);
    return this.page;
  }

  /** Run `fn` with a hang timeout. On timeout the browser is considered hung. */
  async guarded<T>(fn: (page: Page) => Promise<T>, label: string, timeoutMs = getAppSettings().browser.hangTimeoutSeconds * 1000): Promise<T> {
    const page = await this.ensure();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(page),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new HungError(`Browser did not respond during "${label}"`)), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async close() {
    this.closedByUs = true;
    const ctx = this.ctx; this.ctx = null; this.page = null;
    if (ctx) await Promise.race([ctx.close().catch(() => {}), new Promise(r => setTimeout(r, 8000))]);
    await killProfileProcesses(this.profileDir());
  }

  /** Watchdog restart: kill and relaunch. */
  async restart(reason: string): Promise<Page> {
    this.restarts++;
    log('warn', 'watchdog', `Restarting browser (${reason})`);
    await this.close();
    await new Promise(r => setTimeout(r, 2000));
    return this.ensure();
  }

  async screenshot(): Promise<Buffer | null> {
    if (!this.isOpen()) return null;
    try { return await this.page!.screenshot({ type: 'jpeg', quality: 45, scale: 'css', timeout: 5000 }); } catch { return null; }
  }
}
