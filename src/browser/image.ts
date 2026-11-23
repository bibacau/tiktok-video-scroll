// Crop / shrink JPEGs in Node so the browser never has to change its viewport or emulation.
import jpeg from 'jpeg-js';

export interface Rect { x: number; y: number; width: number; height: number }

/** Crop `rect` (in CSS pixels; `dpr` = image pixels per CSS pixel) and shrink to at most `maxWidth`. */
export function cropResize(input: Buffer, rect: Rect | null, dpr: number, maxWidth: number, quality: number): Buffer {
  const img = jpeg.decode(input, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 40, maxMemoryUsageInMB: 512 });
  const sx = Math.max(0, Math.round((rect?.x ?? 0) * dpr)), sy = Math.max(0, Math.round((rect?.y ?? 0) * dpr));
  const sw = Math.max(1, Math.min(img.width - sx, Math.round((rect?.width ?? img.width / dpr) * dpr)));
  const sh = Math.max(1, Math.min(img.height - sy, Math.round((rect?.height ?? img.height / dpr) * dpr)));
  const scale = Math.min(1, maxWidth / sw);
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const fy = sy + Math.min(sh - 1, (y + 0.5) / scale - 0.5), y0 = Math.max(sy, Math.floor(fy)), y1 = Math.min(sy + sh - 1, y0 + 1), ty = Math.max(0, fy - y0);
    for (let x = 0; x < w; x++) {
      const fx = sx + Math.min(sw - 1, (x + 0.5) / scale - 0.5), x0 = Math.max(sx, Math.floor(fx)), x1 = Math.min(sx + sw - 1, x0 + 1), tx = Math.max(0, fx - x0);
      for (let c = 0; c < 3; c++) {
        const a = img.data[(y0 * img.width + x0) * 3 + c] * (1 - tx) + img.data[(y0 * img.width + x1) * 3 + c] * tx;
        const b = img.data[(y1 * img.width + x0) * 3 + c] * (1 - tx) + img.data[(y1 * img.width + x1) * 3 + c] * tx;
        out[(y * w + x) * 4 + c] = Math.round(a * (1 - ty) + b * ty);
      }
      out[(y * w + x) * 4 + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ width: w, height: h, data: out }, quality).data);
}
