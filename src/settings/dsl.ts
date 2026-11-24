/**
 * A tiny schema language. One definition gives us:
 *  - default values
 *  - validation / coercion of anything stored or posted (unknown keys dropped, bad values → default)
 *  - a JSON description the dashboard renders as forms
 * Adding a setting = adding one line here; the dashboard picks it up automatically.
 */

export interface Option { value: string; label: string }
interface Base { label: string; help?: string; phase?: number; showIf?: { field: string; equals: unknown } }

export type Field =
  | (Base & { type: 'text' | 'textarea' | 'secret' | 'time' | 'color'; default: string; placeholder?: string; rows?: number; maxLength?: number })
  | (Base & { type: 'number' | 'slider'; default: number; min: number; max: number; step?: number; unit?: string; warn?: { above?: number; below?: number; message: string } })
  | (Base & { type: 'bool'; default: boolean; warnWhenOn?: string })
  | (Base & { type: 'locked'; default: true; note: string })
  | (Base & { type: 'select'; default: string; options: Option[]; allowCustom?: boolean; fills?: Record<string, Record<string, unknown>> })
  | (Base & { type: 'checkboxes'; default: string[]; options: Option[] })
  | (Base & { type: 'list'; default: string[]; placeholder?: string; maxItems?: number })
  | (Base & { type: 'weights'; default: Record<string, number>; options: Option[] })
  | (Base & { type: 'windows'; default: Record<string, Array<{ start: string; end: string }>> })
  | (Base & { type: 'json'; default: unknown; rows?: number })
  | (Base & { type: 'file'; default: string; kind: 'fonts' | 'logos' | 'music' })
  | (Base & { type: 'account'; default: string })
  | (Base & { type: 'group'; fields: Record<string, Field>; collapsed?: boolean });

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = typeof DAYS[number];

// ---- builders -------------------------------------------------------------
type Opts = Partial<Base> & Record<string, any>;
export const s = {
  text: (label: string, def = '', o: Opts = {}): Field => ({ type: 'text', label, default: def, ...o } as Field),
  textarea: (label: string, def = '', o: Opts = {}): Field => ({ type: 'textarea', label, default: def, rows: 4, ...o } as Field),
  secret: (label: string, o: Opts = {}): Field => ({ type: 'secret', label, default: '', ...o } as Field),
  time: (label: string, def: string, o: Opts = {}): Field => ({ type: 'time', label, default: def, ...o } as Field),
  color: (label: string, def: string, o: Opts = {}): Field => ({ type: 'color', label, default: def, ...o } as Field),
  number: (label: string, def: number, min: number, max: number, o: Opts = {}): Field => ({ type: 'number', label, default: def, min, max, ...o } as Field),
  slider: (label: string, def: number, min: number, max: number, o: Opts = {}): Field => ({ type: 'slider', label, default: def, min, max, ...o } as Field),
  bool: (label: string, def: boolean, o: Opts = {}): Field => ({ type: 'bool', label, default: def, ...o } as Field),
  locked: (label: string, note: string, o: Opts = {}): Field => ({ type: 'locked', label, default: true, note, ...o } as Field),
  select: (label: string, def: string, options: Array<Option | string>, o: Opts = {}): Field => ({ type: 'select', label, default: def, options: options.map(opt), ...o } as Field),
  checkboxes: (label: string, def: string[], options: Array<Option | string>, o: Opts = {}): Field => ({ type: 'checkboxes', label, default: def, options: options.map(opt), ...o } as Field),
  list: (label: string, def: string[] = [], o: Opts = {}): Field => ({ type: 'list', label, default: def, ...o } as Field),
  weights: (label: string, def: Record<string, number>, options: Array<Option | string>, o: Opts = {}): Field => ({ type: 'weights', label, default: def, options: options.map(opt), ...o } as Field),
  windows: (label: string, def: Record<string, Array<{ start: string; end: string }>>, o: Opts = {}): Field => ({ type: 'windows', label, default: def, ...o } as Field),
  account: (label: string, o: Opts = {}): Field => ({ type: 'account', label, default: '', ...o } as Field),
  file: (label: string, kind: 'fonts' | 'logos' | 'music', o: Opts = {}): Field => ({ type: 'file', label, default: '', kind, ...o } as Field),
  json: (label: string, def: unknown, o: Opts = {}): Field => ({ type: 'json', label, default: def, rows: 10, ...o } as Field),
  group: (label: string, fields: Record<string, Field>, o: Opts = {}): Field => ({ type: 'group', label, fields, ...o } as Field),
};
function opt(o: Option | string): Option { return typeof o === 'string' ? { value: o, label: o } : o; }

// ---- defaults & coercion -----------------------------------------------------
export function defaults(field: Field): any {
  if (field.type === 'group') return Object.fromEntries(Object.entries(field.fields).map(([k, f]) => [k, defaults(f)]));
  return structuredClone(field.default);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Returns a value that is guaranteed valid for `field`, falling back to defaults piece by piece. */
export function coerce(field: Field, value: unknown): any {
  switch (field.type) {
    case 'group': {
      const src = plain(value) ? value : {};
      return Object.fromEntries(Object.entries(field.fields).map(([k, f]) => [k, coerce(f, src[k])]));
    }
    case 'text': case 'textarea': case 'secret': case 'color': {
      if (typeof value !== 'string') return field.default;
      return field.maxLength ? value.slice(0, field.maxLength) : value.slice(0, 50_000);
    }
    case 'account': return typeof value === 'string' && /^[\w-]{0,40}$/.test(value) ? value : '';
    case 'file': return typeof value === 'string' && !/[\\/]|\.\./.test(value) ? value.slice(0, 200) : '';
    case 'time': return typeof value === 'string' && TIME.test(value) ? value : field.default;
    case 'number': case 'slider': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return field.default;
      return Math.min(field.max, Math.max(field.min, n));
    }
    case 'bool': return typeof value === 'boolean' ? value : field.default;
    case 'locked': return true;
    case 'select':
      if (typeof value !== 'string') return field.default;
      return field.allowCustom || field.options.some(o => o.value === value) ? value : field.default;
    case 'checkboxes':
      if (!Array.isArray(value)) return structuredClone(field.default);
      return [...new Set(value.filter(v => typeof v === 'string' && field.options.some(o => o.value === v)))];
    case 'list': {
      if (!Array.isArray(value)) return structuredClone(field.default);
      const re = (field as any).pattern ? new RegExp((field as any).pattern) : null;
      const items = value.filter(v => typeof v === 'string').map(v => v.trim()).filter(v => v && (!re || re.test(v)));
      return [...new Set(items)].slice(0, field.maxItems ?? 500);
    }
    case 'weights': {
      const src = plain(value) ? value : field.default;
      return Object.fromEntries(field.options.map(o => {
        const n = Number((src as any)[o.value]);
        return [o.value, Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : (field.default[o.value] ?? 0)];
      }));
    }
    case 'windows': {
      const src = plain(value) ? value : field.default;
      return Object.fromEntries(DAYS.map(d => {
        const list = Array.isArray((src as any)[d]) ? (src as any)[d] : (field.default[d] ?? []);
        return [d, list.filter((w: any) => w && TIME.test(w.start) && TIME.test(w.end) && w.start < w.end)
          .map((w: any) => ({ start: w.start, end: w.end })).slice(0, 12)];
      }));
    }
    case 'json': {
      if (value === undefined) return structuredClone(field.default);
      if (typeof value === 'string') { try { return JSON.parse(value); } catch { return structuredClone(field.default); } }
      return value;
    }
  }
}

/** Human warnings for the current values (e.g. long daily watch time). */
export function warnings(field: Field, value: any, path = ''): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  if (field.type === 'group') {
    for (const [k, f] of Object.entries(field.fields)) out.push(...warnings(f, value?.[k], path ? `${path}.${k}` : k));
  } else if ((field.type === 'number' || field.type === 'slider') && field.warn) {
    if ((field.warn.above !== undefined && value > field.warn.above) || (field.warn.below !== undefined && value < field.warn.below)) out.push({ path, message: field.warn.message });
  } else if (field.type === 'bool' && field.warnWhenOn && value === true) out.push({ path, message: field.warnWhenOn });
  else if (field.type === 'select' && (field as any).warnValues?.[value]) out.push({ path, message: (field as any).warnValues[value] });
  return out;
}

/** Collect the paths of every secret field (they are stored in secrets.json, never in the DB). */
export function secretPaths(field: Field, path = ''): string[] {
  if (field.type === 'secret') return [path];
  if (field.type !== 'group') return [];
  return Object.entries(field.fields).flatMap(([k, f]) => secretPaths(f, path ? `${path}.${k}` : k));
}

export function getPath(obj: any, path: string) { return path.split('.').reduce((o, k) => o?.[k], obj); }
export function setPath(obj: any, path: string, value: unknown) {
  const keys = path.split('.'); let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys[keys.length - 1]] = value;
}
