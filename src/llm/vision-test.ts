import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { paths } from '../paths.ts';
import { describeFrames } from './client.ts';
import { getAppSettings } from '../settings/store.ts';

/** A sample frame: the newest saved storyboard if there is one, otherwise a generated test card. */
export function sampleFrame(): { jpeg: Buffer; source: string } {
  try {
    const files = fs.readdirSync(paths.media).filter(f => /^video-\d+\.jpg$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(paths.media, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    if (files[0]) return { jpeg: fs.readFileSync(path.join(paths.media, files[0].f)), source: `last saved storyboard (${files[0].f})` };
  } catch { /* none */ }
  // Test card: coloured bars over a checkerboard — easy to describe.
  const w = 360, h = 640, data = Buffer.alloc(w * h * 4);
  const bars = [[230, 40, 40], [250, 200, 30], [40, 180, 60], [40, 90, 220], [240, 240, 240], [20, 20, 20]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const c = y < h * 0.6 ? bars[Math.floor(x / (w / bars.length))] : ((Math.floor(x / 40) + Math.floor(y / 40)) % 2 ? [255, 255, 255] : [0, 0, 0]);
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { jpeg: Buffer.from(jpeg.encode({ width: w, height: h, data }, 80).data), source: 'generated test card (colour bars + checkerboard)' };
}

export async function testVision() {
  const v = getAppSettings().vision;
  if (!v.baseUrl || !v.model) throw Object.assign(new Error('Set the vision provider, base URL and model first (and press Save).'), { statusCode: 400 });
  const { jpeg: img, source } = sampleFrame();
  const started = Date.now();
  const r = await describeFrames([{ mime: 'image/jpeg', base64: img.toString('base64') }], undefined, true);
  return { ok: !!r, model: v.model, source, description: r?.text ?? '(empty reply)', ms: Date.now() - started, image: `data:image/jpeg;base64,${img.toString('base64')}`, enabled: v.enabled };
}
