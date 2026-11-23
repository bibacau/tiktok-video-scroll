// ffmpeg rendering: one segment per scene, then one final pass for audio, subtitles and logo.
import fs from 'node:fs';
import path from 'node:path';
import { getAppSettings } from '../settings/store.ts';
import { defaultFont, listFiles, resolveFile } from '../files.ts';
import { fcolor, ffmpeg, filterScriptArgs, fpath, probeDuration, wrap, writeText } from './ffmpeg.ts';
import { estimateWords, type Word, type Speech } from './tts.ts';
import type { Visual, Scene } from './visuals.ts';

export interface SceneAssets { voice: Speech | null; visual: Visual }
const FPS = 30;

export function frameSize(aspect: string, resolution: string) {
  const sizes: Record<string, [number, number]> = { '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '16:9': [1920, 1080] };
  const [w, h] = sizes[aspect] ?? sizes['9:16'];
  const k = resolution === '720' ? 2 / 3 : 1;
  const even = (n: number) => Math.round(n * k / 2) * 2;
  return { W: even(w), H: even(h), k: Math.min(even(w), even(h)) / 1080 };
}

export function sceneDuration(scene: Scene, a: SceneAssets) {
  if (a.voice) return Math.max(1.5, a.voice.duration + 0.35);
  const words = `${scene.on_screen ?? ''} ${scene.voiceover}`.split(/\s+/).filter(Boolean).length;
  return Math.max(2.5, Math.min(8, words / 2.6));
}

export function fontFile(create: any): string {
  return resolveFile('fonts', create.visuals.font) ?? defaultFont();
}

async function renderSegment(i: number, scene: Scene, a: SceneAssets, d: number, create: any, dir: string, signal?: AbortSignal) {
  const v = create.visuals, { W, H, k } = frameSize(create.basics.aspect, create.basics.resolution);
  const font = fpath(fontFile(create));
  const out = path.join(dir, `seg-${i}.mp4`);
  const inputs: string[] = [];
  let chain: string;
  if (a.visual.kind === 'video' && a.visual.file) {
    inputs.push('-stream_loop', '-1', '-t', d.toFixed(3), '-i', a.visual.file);
    chain = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.18:t=fill`;
  } else if (a.visual.kind === 'image' && a.visual.file) {
    const frames = Math.ceil(d * FPS);
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', d.toFixed(3), '-i', a.visual.file);
    chain = `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='min(1+0.12*on/${frames},1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.12:t=fill`;
  } else {
    inputs.push('-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=${fcolor(v.bgColor1)}:c1=${fcolor(v.bgColor2)}:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.012:rate=${FPS}:duration=${d.toFixed(3)}`);
    chain = `[0:v]format=yuv420p,setsar=1`;
  }
  // Headline text
  const isSlide = a.visual.kind === 'slide';
  const headline = (scene.on_screen || (isSlide ? scene.voiceover : '')).trim();
  if (headline) {
    const size = Math.round(v.headlineSize * k * (isSlide ? 1.15 : 1));
    const txt = writeText(path.join(dir, `head-${i}.txt`), wrap(headline, Math.max(8, Math.floor(W * 0.84 / (size * 0.56))), isSlide ? 7 : 3));
    const y = isSlide ? `(h-text_h)/2+${Math.round(40 * k)}*max(0\\,1-t/0.4)` : `${Math.round(H * 0.13)}`;
    const deco = isSlide ? `shadowcolor=black@0.45:shadowx=${Math.round(4 * k)}:shadowy=${Math.round(4 * k)}` : `box=1:boxcolor=${fcolor(v.accentColor, 0.6)}:boxborderw=${Math.round(size * 0.35)}`;
    chain += `,drawtext=fontfile=${font}:textfile=${fpath(txt)}:expansion=none:fontsize=${size}:fontcolor=${fcolor(v.textColor)}:line_spacing=${Math.round(size * 0.22)}:x=(w-text_w)/2:y=${y}:${deco}:alpha='min(1\\,t/0.35)'`;
  }
  if (v.transition === 'fade' && d > 1) chain += `,fade=t=in:st=0:d=0.25,fade=t=out:st=${(d - 0.25).toFixed(3)}:d=0.25`;
  const script = writeText(path.join(dir, `seg-${i}.filter`), `${chain}[v]`);
  await ffmpeg([...inputs, ...(await filterScriptArgs(script)), '-map', '[v]', '-t', d.toFixed(3), '-r', String(FPS),
    '-c:v', 'libx264', '-preset', getAppSettings().tools.preset, '-crf', '20', '-pix_fmt', 'yuv420p', '-an', out], signal);
  return out;
}

/** Subtitle chunks with absolute times. */
export function subtitleChunks(scenes: Scene[], assets: SceneAssets[], durations: number[], perLine: number) {
  const chunks: Array<{ text: string; start: number; end: number }> = [];
  let offset = 0;
  scenes.forEach((s, i) => {
    const a = assets[i], d = durations[i];
    const text = s.voiceover.trim();
    if (text) {
      const words: Word[] = a.voice?.words?.length ? a.voice.words : estimateWords(text, a.voice ? a.voice.duration : d - 0.3);
      for (let j = 0; j < words.length; j += perLine) {
        const group = words.slice(j, j + perLine);
        const next = words[j + perLine];
        chunks.push({ text: group.map(w => w.text).join(' '), start: offset + group[0].start, end: Math.min(offset + d, offset + (next ? next.start : group[group.length - 1].end + 0.25)) });
      }
    }
    offset += d;
  });
  return chunks;
}

function pickMusic(create: any): string | null {
  const m = create.music;
  if (!m.enabled) return null;
  if (m.file) return resolveFile('music', m.file);
  const all = listFiles('music');
  return all.length ? resolveFile('music', all[Math.floor(Math.random() * all.length)].value) : null;
}

export async function renderVideo(scenes: Scene[], assets: SceneAssets[], create: any, dir: string, signal?: AbortSignal) {
  fs.mkdirSync(dir, { recursive: true });
  const { W, H, k } = frameSize(create.basics.aspect, create.basics.resolution);
  const durations = scenes.map((s, i) => sceneDuration(s, assets[i]));
  const total = durations.reduce((a, b) => a + b, 0);

  // 1. scene segments
  const segs: string[] = [];
  for (let i = 0; i < scenes.length; i++) segs.push(await renderSegment(i, scenes[i], assets[i], durations[i], create, dir, signal));
  const list = writeText(path.join(dir, 'segments.txt'), segs.map(s => `file '${path.basename(s)}'`).join('\n'));
  const joined = path.join(dir, 'video-only.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], signal);

  // 2. voice track (each scene padded to its duration)
  const voiceInputs: string[] = []; const parts: string[] = []; let n = 0;
  scenes.forEach((_, i) => {
    const vo = assets[i].voice;
    if (vo) { voiceInputs.push('-i', vo.file); parts.push(`[${n}:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=${durations[i].toFixed(3)}[a${i}]`); n++; }
    else parts.push(`anullsrc=r=44100:cl=stereo,atrim=0:${durations[i].toFixed(3)}[a${i}]`);
  });
  const voice = path.join(dir, 'voice.wav');
  const vf = writeText(path.join(dir, 'voice.filter'), `${parts.join(';\n')};\n${scenes.map((_, i) => `[a${i}]`).join('')}concat=n=${scenes.length}:v=0:a=1[out]`);
  await ffmpeg([...voiceInputs, ...(await filterScriptArgs(vf)), '-map', '[out]', '-t', total.toFixed(3), voice], signal);

  // 3. final pass: subtitles + logo on video, music under voice
  const inputs = ['-i', joined, '-i', voice];
  const music = pickMusic(create);
  if (music) inputs.push('-stream_loop', '-1', '-i', music);
  const logo = resolveFile('logos', create.visuals.logo);
  if (logo) inputs.push('-loop', '1', '-i', logo);
  const graph: string[] = [];
  let vlabel = '[0:v]';
  const st = create.subtitles;
  if (st.enabled) {
    const size = Math.round(st.size * k);
    const font = fpath(fontFile(create));
    const y = st.position === 'top' ? `${Math.round(H * 0.12)}` : st.position === 'middle' ? '(h-text_h)/2' : st.position === 'bottom' ? `h-text_h-${Math.round(H * 0.1)}` : `${Math.round(H * 0.68)}`;
    const deco = st.style === 'box' ? `box=1:boxcolor=${fcolor(create.visuals.accentColor, 0.65)}:boxborderw=${Math.round(size * 0.3)}` : `borderw=${Math.max(2, Math.round(size * 0.09))}:bordercolor=black`;
    const chunks = subtitleChunks(scenes, assets, durations, st.wordsPerLine);
    const filters = chunks.map((c, j) => {
      const t = writeText(path.join(dir, `sub-${j}.txt`), wrap(st.uppercase ? c.text.toUpperCase() : c.text, Math.max(8, Math.floor(W * 0.86 / (size * 0.56))), 2));
      return `drawtext=fontfile=${font}:textfile=${fpath(t)}:expansion=none:fontsize=${size}:fontcolor=${fcolor(create.visuals.textColor)}:line_spacing=${Math.round(size * 0.2)}:x=(w-text_w)/2:y=${y}:${deco}:enable='between(t\\,${c.start.toFixed(2)}\\,${c.end.toFixed(2)})'`;
    });
    if (filters.length) { graph.push(`${vlabel}${filters.join(',')}[vs]`); vlabel = '[vs]'; }
  }
  if (logo) {
    const li = music ? 3 : 2, v = create.visuals, m = Math.round(36 * k);
    const pos: Record<string, string> = { 'top-left': `${m}:${m}`, 'top-right': `W-w-${m}:${m}`, 'bottom-left': `${m}:H-h-${m}`, 'bottom-right': `W-w-${m}:H-h-${m}` };
    graph.push(`[${li}:v]scale=${Math.round(W * v.logoSize / 100)}:-1,format=rgba,colorchannelmixer=aa=${v.logoOpacity}[lg]`);
    graph.push(`${vlabel}[lg]overlay=${pos[v.logoPosition] ?? pos['top-right']}:format=auto:shortest=0[vl]`); vlabel = '[vl]';
  }
  if (vlabel === '[0:v]') graph.push('[0:v]null[vout]'); else graph.push(`${vlabel}null[vout]`);
  if (music) {
    const vol = create.music.volume;
    graph.push(`[2:a]aresample=44100,aformat=channel_layouts=stereo,volume=${vol},atrim=0:${total.toFixed(3)}[mus]`);
    if (create.music.duck && assets.some(a => a.voice)) {
      graph.push('[1:a]asplit=2[vo][sc]', '[mus][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck]', '[vo][duck]amix=inputs=2:duration=first:normalize=0[aout]');
    } else graph.push('[1:a][mus]amix=inputs=2:duration=first:normalize=0[aout]');
  } else graph.push('[1:a]anull[aout]');
  const ff = writeText(path.join(dir, 'final.filter'), graph.join(';\n'));
  const final = path.join(dir, 'final.mp4');
  await ffmpeg([...inputs, ...(await filterScriptArgs(ff)), '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(3), '-r', String(FPS),
    '-c:v', 'libx264', '-preset', getAppSettings().tools.preset, '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-movflags', '+faststart', final], signal);
  const thumb = path.join(dir, 'thumb.jpg');
  await ffmpeg(['-ss', Math.min(1, total / 2).toFixed(2), '-i', final, '-frames:v', '1', '-q:v', '3', thumb], signal);
  // tidy intermediates
  for (const f of fs.readdirSync(dir)) if (/^(seg-\d+\.(mp4|filter)|head-\d+\.txt|sub-\d+\.txt|segments\.txt|video-only\.mp4|voice\.filter|final\.filter)$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  return { file: final, thumb, duration: await probeDuration(final), durations };
}
