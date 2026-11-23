// Text-to-speech providers. Stock voices only — no voice cloning (fixed safety rule).
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { getAppSettings } from '../settings/store.ts';
import { recordCost } from '../llm/budget.ts';
import { probeDuration, run } from './ffmpeg.ts';

export interface Word { text: string; start: number; end: number }
export interface Speech { file: string; duration: number; words: Word[] | null }
export interface VoiceSettings { voice: string; rate: number; pitch: number; volume: number }
export interface TtsProvider { synth(text: string, v: VoiceSettings, outBase: string): Promise<Speech> }

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const signed = (n: number, unit: string) => `${n >= 0 ? '+' : ''}${Math.round(n)}${unit}`;

// ---------------------------------------------------------------- Microsoft Edge (free)
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
function secMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + 11644473600;
  ticks -= ticks % 300;
  return createHash('sha256').update(`${BigInt(ticks) * 10_000_000n}${TRUSTED_CLIENT_TOKEN}`, 'ascii').digest('hex').toUpperCase();
}

export const edgeTts: TtsProvider = {
  synth(text, v, outBase) {
    const tools = getAppSettings().tools;
    const ver = tools.edgeTtsVersion;
    const url = `${tools.edgeTtsUrl}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${encodeURIComponent(ver)}&ConnectionId=${randomUUID().replace(/-/g, '')}`;
    const chromeMajor = ver.split('-')[1]?.split('.')[0] ?? '130';
    const file = `${outBase}.mp3`;
    return new Promise<Speech>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: {
          Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold', Pragma: 'no-cache', 'Cache-Control': 'no-cache',
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36 Edg/${chromeMajor}.0.0.0`,
        },
      });
      const chunks: Buffer[] = []; const words: Word[] = [];
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('Edge voice timed out')); }, 60_000);
      const fail = (e: Error) => { clearTimeout(timer); reject(e); };
      ws.on('error', e => fail(new Error(`Edge voice connection failed: ${e.message}. If this keeps happening, update the "Edge voices client version" in Settings → Video tools, or choose Windows voices.`)));
      ws.on('unexpected-response', (_req, res) => fail(new Error(`Edge voice service refused (HTTP ${res.statusCode}). Update "Edge voices client version" in Settings → Video tools.`)));
      ws.on('open', () => {
        const ts = new Date().toString();
        ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}');
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${xml(v.voice)}'><prosody pitch='${signed(v.pitch, 'Hz')}' rate='${signed(v.rate, '%')}' volume='${signed(v.volume, '%')}'>${xml(text)}</prosody></voice></speak>`;
        ws.send(`X-RequestId:${randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`);
      });
      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          const headerLen = data.readUInt16BE(0);
          const header = data.subarray(2, 2 + headerLen).toString();
          if (header.includes('Path:audio')) chunks.push(data.subarray(2 + headerLen));
          return;
        }
        const msg = data.toString();
        if (msg.includes('Path:audio.metadata')) {
          try {
            const body = JSON.parse(msg.slice(msg.indexOf('\r\n\r\n') + 4));
            for (const m of body.Metadata ?? []) if (m.Type === 'WordBoundary') {
              const start = m.Data.Offset / 1e7; words.push({ text: m.Data.text.Text, start, end: start + m.Data.Duration / 1e7 });
            }
          } catch { /* ignore */ }
        } else if (msg.includes('Path:turn.end')) {
          clearTimeout(timer); ws.close();
          if (!chunks.length) return reject(new Error(`Edge voice returned no audio — is "${v.voice}" a valid voice name?`));
          fs.writeFileSync(file, Buffer.concat(chunks));
          probeDuration(file).then(duration => { recordCost('edge-tts', v.voice, 'voice', 0, { units: text.length }); resolve({ file, duration, words: words.length ? words : null }); }, reject);
        }
      });
    });
  },
};

// ---------------------------------------------------------------- Windows built-in voices (offline)
export const windowsTts: TtsProvider = {
  async synth(text, v, outBase) {
    if (process.platform !== 'win32') throw new Error('Windows voices only work on Windows');
    const file = `${outBase}.wav`, txt = `${outBase}.txt`;
    fs.writeFileSync(txt, text, 'utf8');
    const rate = Math.max(-10, Math.min(10, Math.round(v.rate / 10)));
    const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      try { if ('${v.voice.replace(/'/g, "''")}' -notmatch 'Neural') { $s.SelectVoice('${v.voice.replace(/'/g, "''")}') } } catch {}
      $s.Rate = ${rate}; $s.Volume = ${Math.max(0, Math.min(100, 100 + v.volume))}; $s.SetOutputToWaveFile('${file.replace(/'/g, "''")}');
      $s.Speak([IO.File]::ReadAllText('${txt.replace(/'/g, "''")}', [Text.Encoding]::UTF8)); $s.Dispose()`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeoutMs: 120_000 });
    recordCost('windows-tts', v.voice, 'voice', 0, { units: text.length });
    return { file, duration: await probeDuration(file), words: null };
  },
};

export async function listWindowsVoices(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo.Name }'], { timeoutMs: 30_000 });
  return stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- registry (pluggable)
export const ttsProviders: Record<string, TtsProvider> = { edge: edgeTts, windows: windowsTts };

/** Estimated word timings when a provider doesn't give them. */
export function estimateWords(text: string, duration: number): Word[] {
  const words = text.split(/\s+/).filter(Boolean);
  const total = words.reduce((a, w) => a + w.length + 1, 0) || 1;
  let t = 0;
  return words.map(w => { const d = duration * (w.length + 1) / total; const r = { text: w, start: t, end: t + d }; t += d; return r; });
}
export const outBase = (dir: string, name: string) => path.join(dir, name);
