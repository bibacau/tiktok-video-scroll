import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { getAppSettings } from '../settings/store.ts';

const bin = () => getAppSettings().tools;

export function run(cmd: string, args: string[], opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, signal: opts.signal });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d; if (stdout.length > 2e6) stdout = stdout.slice(-1e6); });
    p.stderr.on('data', d => { stderr += d; if (stderr.length > 2e6) stderr = stderr.slice(-1e6); });
    const timer = opts.timeoutMs ? setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs) : null;
    p.on('error', e => {
      if (timer) clearTimeout(timer);
      reject((e as any).code === 'ENOENT' ? new Error(`${cmd} not found. Install ffmpeg (winget install Gyan.FFmpeg) or set its path in Settings → Video tools.`) : e);
    });
    p.on('close', code => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd.split(/[\\/]/).pop()} failed (code ${code}): ${stderr.split('\n').filter(Boolean).slice(-6).join(' | ')}`));
    });
  });
}

export const ffmpeg = (args: string[], signal?: AbortSignal) => run(bin().ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { signal, timeoutMs: 30 * 60_000 });

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run(bin().ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeoutMs: 60_000 });
  const d = Number(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`Could not read duration of ${file}`);
  return d;
}

export async function probeStreams(file: string): Promise<Array<{ codec_type: string; width?: number; height?: number }>> {
  const { stdout } = await run(bin().ffprobePath, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', file], { timeoutMs: 60_000 });
  return JSON.parse(stdout).streams ?? [];
}

let versionCache: { path: string; major: number; minor: number } | null = null;
async function version(): Promise<{ path: string; major: number; minor: number }> {
  const p = bin().ffmpegPath;
  if (versionCache && versionCache.path === p) return versionCache;
  const { stdout } = await run(p, ['-hide_banner', '-version'], { timeoutMs: 20_000 });
  const m = stdout.match(/ffmpeg version (?:n)?(\d+)\.(\d+)/);
  const v = { path: p, major: m ? Number(m[1]) : 99, minor: m ? Number(m[2]) : 0 };
  versionCache = v;
  return v;
}
/** Args that load a filter graph from a file (avoids Windows command-line length limits). */
export async function filterScriptArgs(file: string): Promise<string[]> {
  const v = await version();
  return v.major > 7 || (v.major === 7 && v.minor >= 1) ? ['-/filter_complex', file] : ['-filter_complex_script', file];
}

/** Quote a file path for use inside an ffmpeg filter option. */
export function fpath(p: string) {
  return `'${p.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:')}'`;
}
/** '#rrggbb' → '0xrrggbb' (ffmpeg colour syntax), with optional alpha. */
export function fcolor(hex: string, alpha?: number) {
  const h = /^#?[0-9a-f]{6}$/i.test(hex) ? hex.replace('#', '') : 'ffffff';
  return `0x${h}${alpha !== undefined ? `@${alpha}` : ''}`;
}

export function writeText(file: string, text: string) { fs.writeFileSync(file, text, 'utf8'); return file; }

/** Wrap text to lines of at most `maxChars` characters. */
export function wrap(text: string, maxChars: number, maxLines = 6): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
  return lines.join('\n');
}
