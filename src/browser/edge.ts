// Dedicated Edge profiles, started as NORMAL browser processes and attached over CDP
// (like LockyBee/dsh-douyin-agent). Playwright never launches the browser itself, so none of its
// automation switches (--enable-automation etc.) are present — sites see an ordinary Edge window.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import { paths } from '../paths.ts';
import { getAppSettings } from '../settings/store.ts';
import { log } from '../log.ts';
import { browserCall, cdpVersion } from './cdp.ts';

const SCRIPTS = fs.readFileSync(path.join(paths.root, 'src', 'browser', 'page-scripts.js'), 'utf8');

/** Run a function from page-scripts.js inside the page. */
export function runScript<T = any>(page: Page, name: string, arg: unknown = null): Promise<T> {
  return page.evaluate(`(() => { ${SCRIPTS}\n return ${name}(${JSON.stringify(arg)}); })()`) as Promise<T>;
}

export class HungError extends Error { code = 'BROWSER_HUNG'; }
/** The profile folder is held by a browser we cannot talk to (opened by hand, or a leftover process). */
export class ProfileBusyError extends Error {
  code = 'PROFILE_IN_USE'; statusCode = 409; profile: string; pids: number[];
  constructor(profile: string, pids: number[]) {
    super(`The Edge profile "${profile}" is already open in another window (or a leftover Edge process is holding it). Close that window, or press "Close it for me".`);
    this.profile = profile; this.pids = pids;
  }
}

export const profileDirFor = (name: string) => path.join(paths.profiles, name.replace(/[^\w.-]/g, '_') || 'watcher');

// ------------------------------------------------------------------ processes
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise(resolve => execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 20_000 }, (_e, out) => resolve(String(out ?? ''))));
}

/** PIDs of browser processes whose command line uses this profile folder (and nothing else). */
export async function profileProcesses(dir: string): Promise<number[]> {
  const needle = path.resolve(dir).toLowerCase();
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"]);
    return out.split(/\r?\n/).map(l => l.split('\t')).filter(([pid, cmd]) => pid && cmd && userDataDirOf(cmd) === needle).map(([pid]) => Number(pid));
  }
  const out = await run('ps', ['-eo', 'pid=,args=']);
  return out.split('\n').map(l => l.trim().match(/^(\d+)\s+(.*)$/)).filter((m): m is RegExpMatchArray => !!m && userDataDirOf(m[2]) === needle && Number(m[1]) !== process.pid).map(m => Number(m[1]));
}
function userDataDirOf(cmd: string): string | null {
  const m = cmd.match(/--user-data-dir=(?:"([^"]+)"|(\S+))/i);
  return m ? path.resolve(m[1] ?? m[2]).toLowerCase() : null;
}

/** Kill only the processes that use THIS profile folder (never your normal Edge). */
export async function killProfileProcesses(dir: string): Promise<number> {
  const pids = await profileProcesses(dir);
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  if (process.platform === 'win32' && pids.length) await run('taskkill.exe', ['/F', '/T', ...pids.flatMap(p => ['/PID', String(p)])]);
  try { fs.rmSync(path.join(dir, 'DevToolsActivePort'), { force: true }); } catch { /* */ }
  return pids.length;
}

export function findBrowserExecutable(): string {
  const b = getAppSettings().browser;
  if (b.channel === 'custom' || process.env.BROWSER_PATH) {
    const p = b.executablePath || process.env.BROWSER_PATH || '';
    if (p && fs.existsSync(p)) return p;
    throw new Error(`Browser not found at "${p}". Fix the path in Settings → Browser.`);
  }
  const env = process.env;
  const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean) as string[];
  const rel = b.channel === 'chrome' ? ['Google', 'Chrome', 'Application', 'chrome.exe'] : ['Microsoft', 'Edge', 'Application', 'msedge.exe'];
  const candidates = process.platform === 'win32' ? roots.map(r => path.join(r, ...rel))
    : b.channel === 'chrome' ? ['/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  const found = candidates.find(c => fs.existsSync(c));
  if (!found) throw new Error(`${b.channel === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'} not found. Install it, or set a custom browser path in Settings → Browser.`);
  return found;
}

/** Port of the DevTools endpoint of a browser already running on this profile, if it answers. */
export async function livePort(dir: string): Promise<number | null> {
  try {
    const port = Number(fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    if (port > 0 && await cdpVersion(port)) return port;
  } catch { /* none */ }
  return null;
}

/**
 * Start the profile as an ordinary browser window (or reuse it if it is already running with
 * our debugging port). Returns the DevTools port. Throws ProfileBusyError if something else holds the profile.
 */
export async function startNormalBrowser(profileName: string, url = 'about:blank'): Promise<number> {
  const dir = profileDirFor(profileName);
  fs.mkdirSync(dir, { recursive: true });
  const existing = await livePort(dir);
  if (existing) {
    if (url !== 'about:blank') await browserCall(existing, 'Target.createTarget', { url }).catch(() => {});
    return existing;
  }
  const holders = await profileProcesses(dir);
  if (holders.length) throw new ProfileBusyError(profileName, holders);
  try { fs.rmSync(path.join(dir, 'DevToolsActivePort'), { force: true }); } catch { /* */ }
  const b = getAppSettings().browser;
  const exe = findBrowserExecutable();
  const args = [
    `--user-data-dir=${dir}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-features=msEdgeSidebarV2', `--window-size=${b.windowWidth},${b.windowHeight}`,
    '--autoplay-policy=no-user-gesture-required',
  ];
  if (b.muteAudio) args.push('--mute-audio');
  if (b.headless) args.push('--headless=new');
  if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox');
  args.push(url);
  log('info', 'browser', `Starting ${path.basename(exe)} normally with profile "${profileName}"`);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
  let exited: number | null = null;
  child.on('exit', code => { exited = code ?? 0; });
  child.unref();
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 200));
    const port = await livePort(dir);
    if (port) return port;
    if (exited !== null && i > 10) {
      // The new process handed over to an existing one (profile already open) and quit.
      const pids = await profileProcesses(dir);
      if (pids.length) throw new ProfileBusyError(profileName, pids);
      throw new Error(`The browser exited right away (code ${exited}). Check Settings → Browser.`);
    }
  }
  const pids = await profileProcesses(dir);
  if (pids.length) throw new ProfileBusyError(profileName, pids);
  throw new Error('The browser did not open its debugging port within 20 seconds.');
}

/** Close a profile's browser nicely (Browser.close), then make sure no process is left. */
export async function closeProfile(profileName: string) {
  const dir = profileDirFor(profileName);
  const port = await livePort(dir);
  if (port) {
    await browserCall(port, 'Browser.close').catch(() => {});
    for (let i = 0; i < 25 && (await profileProcesses(dir)).length; i++) await new Promise(r => setTimeout(r, 200));
  }
  return killProfileProcesses(dir);
}

/**
 * The agent's connection to one profile. Survives crashes: `ensure()` relaunches if the browser
 * died, and `guarded()` turns a hang into a HungError so the caller can restart.
 */
export class BrowserManager {
  browser: Browser | null = null;
  ctx: BrowserContext | null = null;
  page: Page | null = null;
  private cdp: CDPSession | null = null;
  private launching: Promise<Page> | null = null;
  restarts = 0;
  closedByUs = false;
  private crashed = false;

  profile: () => string;
  constructor(profile: () => string = () => getAppSettings().browser.profileName) { this.profile = profile; }

  profileDir() { return profileDirFor(this.profile()); }
  isOpen() { return !!this.browser?.isConnected() && !!this.page && !this.page.isClosed(); }

  async ensure(): Promise<Page> {
    if (this.isOpen()) return this.page!;
    if (!this.launching) this.launching = this.launch().finally(() => { this.launching = null; });
    return this.launching;
  }

  private async launch(): Promise<Page> {
    const dir = this.profileDir();
    if (this.crashed) {
      this.crashed = false; this.restarts++;
      log('warn', 'watchdog', `Relaunching browser after crash (restart #${this.restarts})`);
      if (!(await livePort(dir))) await killProfileProcesses(dir);
    }
    const port = await startNormalBrowser(this.profile());
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30_000 });
    this.closedByUs = false;
    browser.on('disconnected', () => {
      if (!this.closedByUs) { this.crashed = true; log('warn', 'watchdog', 'Browser closed or crashed unexpectedly'); }
      this.browser = null; this.ctx = null; this.page = null; this.cdp = null;
    });
    this.browser = browser;
    this.ctx = browser.contexts()[0] ?? await browser.newContext();
    // Use the first ordinary tab (keep any other tabs the user opened).
    this.page = this.ctx.pages().find(p => !p.url().startsWith('edge://') && !p.url().startsWith('chrome://')) ?? await this.ctx.newPage();
    this.page.setDefaultTimeout(30_000);
    this.page.on('close', () => { if (this.page?.isClosed()) { this.page = null; this.cdp = null; } });
    this.cdp = null;
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

  /** Disconnect Playwright but leave the window open (e.g. so you can keep using it). */
  async detach() {
    this.closedByUs = true;
    const b = this.browser; this.browser = null; this.ctx = null; this.page = null; this.cdp = null;
    if (b) await Promise.race([b.close().catch(() => {}), new Promise(r => setTimeout(r, 5000))]); // connectOverCDP: close() only disconnects
  }

  async close() {
    await this.detach();
    await closeProfile(this.profile());
  }

  /** Watchdog restart: kill and relaunch. */
  async restart(reason: string): Promise<Page> {
    this.restarts++;
    log('warn', 'watchdog', `Restarting browser (${reason})`);
    await this.close();
    await new Promise(r => setTimeout(r, 2000));
    return this.ensure();
  }

  /**
   * Screenshot straight from the compositor via CDP. Unlike page.screenshot it never changes the
   * window's size/zoom (which made the window jitter on Windows display scaling).
   */
  async capture(opts: { clip?: { x: number; y: number; width: number; height: number }; quality?: number; maxWidth?: number } = {}): Promise<Buffer> {
    const page = await this.ensure();
    if (!this.cdp) this.cdp = await this.ctx!.newCDPSession(page);
    const vp = await page.evaluate('({ w: innerWidth, h: innerHeight })') as { w: number; h: number };
    const clip = opts.clip ?? { x: 0, y: 0, width: vp.w, height: vp.h };
    const scale = opts.maxWidth ? Math.min(1, opts.maxWidth / Math.max(1, clip.width)) : 1;
    const r = await this.cdp.send('Page.captureScreenshot', {
      format: 'jpeg', quality: opts.quality ?? 60, fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true,
      clip: { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.max(16, Math.round(clip.width)), height: Math.max(16, Math.round(clip.height)), scale },
    } as any);
    return Buffer.from((r as any).data, 'base64');
  }

  async screenshot(): Promise<Buffer | null> {
    if (!this.isOpen()) return null;
    try { return await Promise.race([this.capture({ quality: 45, maxWidth: 640 }), new Promise<null>(r => setTimeout(() => r(null), 5000))]); } catch { return null; }
  }
}
