// User uploads (fonts, logos, music) and system fonts.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.ts';

export type FileKind = 'fonts' | 'logos' | 'music';
const EXT: Record<FileKind, RegExp> = { fonts: /\.(ttf|otf)$/i, logos: /\.(png|jpe?g|webp)$/i, music: /\.(mp3|m4a|aac|wav|ogg|flac)$/i };
export const kindDir = (k: FileKind) => k === 'music' ? paths.music : path.join(paths.uploads, k);
export const isKind = (k: string): k is FileKind => k === 'fonts' || k === 'logos' || k === 'music';

const SYSTEM_FONT_DIRS = process.platform === 'win32'
  ? [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')]
  : ['/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/truetype/liberation', '/usr/share/fonts/truetype/freefont', '/System/Library/Fonts/Supplemental'];
const DEFAULT_FONTS = ['arialbd.ttf', 'seguisb.ttf', 'segoeuib.ttf', 'verdanab.ttf', 'DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf', 'FreeSansBold.ttf', 'Arial Bold.ttf'];

export function safeName(name: string) {
  const base = path.basename(name).replace(/[^\w.\- ]+/g, '_').trim();
  if (!base || base.startsWith('.')) throw Object.assign(new Error('Bad file name'), { statusCode: 400 });
  return base.slice(0, 120);
}

export function listFiles(kind: FileKind) {
  const dir = kindDir(kind);
  fs.mkdirSync(dir, { recursive: true });
  const own = fs.readdirSync(dir).filter(f => EXT[kind].test(f)).map(f => ({ value: f, label: f, size: fs.statSync(path.join(dir, f)).size, own: true }));
  if (kind !== 'fonts') return own;
  const sys = SYSTEM_FONT_DIRS.flatMap(d => { try { return fs.readdirSync(d).filter(f => EXT.fonts.test(f)).map(f => ({ value: `system:${f}`, label: `${f} (system)`, size: 0, own: false })); } catch { return []; } });
  return [...own, ...sys];
}

export function saveUpload(kind: FileKind, name: string, data: Buffer) {
  const n = safeName(name);
  if (!EXT[kind].test(n)) throw Object.assign(new Error(`Wrong file type for ${kind}`), { statusCode: 400 });
  fs.mkdirSync(kindDir(kind), { recursive: true });
  fs.writeFileSync(path.join(kindDir(kind), n), data);
  return n;
}
export function deleteUpload(kind: FileKind, name: string) {
  const f = path.join(kindDir(kind), safeName(name));
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

/** Absolute path for a value from a 'file' setting ('' → null). */
export function resolveFile(kind: FileKind, value: string): string | null {
  if (!value) return null;
  if (kind === 'fonts' && value.startsWith('system:')) {
    for (const d of SYSTEM_FONT_DIRS) { const f = path.join(d, safeName(value.slice(7))); if (fs.existsSync(f)) return f; }
    return null;
  }
  const f = path.join(kindDir(kind), safeName(value));
  return fs.existsSync(f) ? f : null;
}

export function defaultFont(): string {
  for (const d of SYSTEM_FONT_DIRS) for (const f of DEFAULT_FONTS) { const p = path.join(d, f); if (fs.existsSync(p)) return p; }
  for (const d of SYSTEM_FONT_DIRS) { try { const f = fs.readdirSync(d).find(x => EXT.fonts.test(x)); if (f) return path.join(d, f); } catch { /* */ } }
  throw new Error('No font found. Upload a .ttf font in Create → Visuals → Font.');
}
