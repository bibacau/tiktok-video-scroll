// Frame sampling → one numbered storyboard image. Design and helpers ported from
// LockyBee/dsh-douyin-agent (MIT) video-storyboard.mjs; layout code vendored from SAOS-3624/dsh-video-storyboard (MIT).
import jpeg from 'jpeg-js';
// @ts-ignore vendored JS
import { bestLayout } from './vendor/plan.mjs';
// @ts-ignore vendored JS
import { composeSheet, layoutCanvas } from './vendor/sheet.mjs';

export interface Frame { jpeg: Buffer; time: number }

function fitRgb(image: { width: number; height: number; data: Uint8Array }, width: number, height: number) {
  const output = Buffer.alloc(width * height * 3, 18);
  const ratio = Math.min(width / image.width, height / image.height);
  const w = Math.max(1, Math.floor(image.width * ratio)), h = Math.max(1, Math.floor(image.height * ratio));
  const left = Math.floor((width - w) / 2), top = Math.floor((height - h) / 2);
  for (let y = 0; y < h; y++) {
    const sy = Math.max(0, Math.min(image.height - 1, (y + 0.5) / ratio - 0.5)), y0 = Math.floor(sy), y1 = Math.min(image.height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.max(0, Math.min(image.width - 1, (x + 0.5) / ratio - 0.5)), x0 = Math.floor(sx), x1 = Math.min(image.width - 1, x0 + 1), fx = sx - x0;
      for (let c = 0; c < 3; c++) {
        const a = image.data[(y0 * image.width + x0) * 3 + c] * (1 - fx) + image.data[(y0 * image.width + x1) * 3 + c] * fx;
        const b = image.data[(y1 * image.width + x0) * 3 + c] * (1 - fx) + image.data[(y1 * image.width + x1) * 3 + c] * fx;
        output[((top + y) * width + left + x) * 3 + c] = Math.round(a * (1 - fy) + b * fy);
      }
    }
  }
  return output;
}

/** Combine frames into one numbered grid image (cheaper than sending each frame). */
export function storyboard(frames: Frame[], pixelBudget = 640_000): { jpeg: Buffer; note: string } {
  if (frames.length === 0) throw new Error('no frames');
  const decoded = frames.map(f => jpeg.decode(f.jpeg, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 8, maxMemoryUsageInMB: 128 }));
  const note = frames.length === 1
    ? `One frame sampled at ${frames[0].time.toFixed(1)}s.`
    : `A numbered storyboard of ${frames.length} frames sampled from the same video. ${frames.map((f, i) => `Cell ${i + 1} = ${f.time.toFixed(1)}s`).join('; ')}. Grey cells are empty. Sampled frames do not prove the whole video was seen, and there is no audio.`;
  if (frames.length === 1) return { jpeg: frames[0].jpeg, note };
  const aspect = decoded[0].width / decoded[0].height;
  const { cols, rows } = bestLayout(frames.length, aspect);
  const layout = layoutCanvas(cols, rows, aspect, pixelBudget);
  const tiles = decoded.map((img, index) => ({ index: index + 1, buffer: fitRgb(img as any, layout.cellW, layout.cellH) }));
  const sheet = (composeSheet as any)({ frames: tiles, cols, rows, cellAspect: aspect, budget: pixelBudget, badgeRatio: 0.13 });
  const rgba = Buffer.alloc(sheet.width * sheet.height * 4);
  for (let i = 0, j = 0; i < sheet.buffer.length; i += 3, j += 4) { rgba[j] = sheet.buffer[i]; rgba[j + 1] = sheet.buffer[i + 1]; rgba[j + 2] = sheet.buffer[i + 2]; rgba[j + 3] = 255; }
  return { jpeg: Buffer.from(jpeg.encode({ width: sheet.width, height: sheet.height, data: rgba }, 72).data), note };
}
