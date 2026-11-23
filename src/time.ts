import type { Day } from './settings/dsl.js';
import { getAppSettings } from './settings/store.js';

export const tz = () => { try { const t = getAppSettings().general.timezone; new Intl.DateTimeFormat('en', { timeZone: t }); return t; } catch { return 'Asia/Kuala_Lumpur'; } };

/** Calendar parts of `date` in the dashboard timezone. */
export function zoned(date = new Date(), zone = tz()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(date).map(p => [p.type, p.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}`,
    weekday: parts.weekday.toLowerCase().slice(0, 3) as Day,
    minutes: Number(parts.hour) * 60 + Number(parts.minute), seconds: Number(parts.second),
  };
}
export const today = () => zoned().day;
export const hhmmToMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const minToHhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

/** Absolute Date for minute-of-day `m` on the zoned day of `ref`. */
export function dateAtMinute(m: number, ref = new Date(), zone = tz()) {
  const z = zoned(ref, zone);
  return new Date(ref.getTime() + ((m - z.minutes) * 60 - z.seconds) * 1000 - ref.getMilliseconds());
}
export const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(signal!.reason); };
  signal?.addEventListener('abort', onAbort, { once: true });
});
export const rand = (min: number, max: number) => min + Math.random() * Math.max(0, max - min);
