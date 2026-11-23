// Test doubles: a fake tiktok.com (same data-e2e structure) and a fake OpenAI/DeepSeek API.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

export function ensureClips() {
  for (let i = 0; i < 6; i++) {
    const f = path.join(DIR, `clip${i}.webm`);
    if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:d=12:r=15', '-vf', `hue=h=${i * 60}`, '-c:v', 'libvpx-vp9', '-b:v', '200k', '-deadline', 'realtime', '-an', f]);
  }
}

const VIDEOS = [
  { id: '7400000000000000001', user: 'makcikcooks', caption: 'Nasi lemak recipe in 60 seconds #nasilemak #recipe #malaysianfood', music: 'original sound - makcikcooks' },
  { id: '7400000000000000002', user: 'dancequeen', caption: 'New dance trend!! #dance #fyp', music: 'Viral Song - DJ' },
  { id: '7400000000000000003', user: 'brandx', caption: 'Buy now, 50% off', music: 'Promoted Music', ad: true },
  { id: '7400000000000000004', user: 'streetfoodkl', caption: 'Char kuey teow street food recipe Penang style #streetfood #recipe', music: 'original sound - streetfoodkl' },
  { id: '7400000000000000005', user: 'livehost', caption: 'Come join my live!', music: '', live: true },
  { id: '7400000000000000006', user: 'rotiman', caption: 'Roti canai recipe from scratch #roticanai #recipe', music: 'Lagu Raya - Siti' },
  { id: '7400000000000000007', user: 'catvids', caption: 'my cat is funny #cat', music: 'Funny sound' },
  { id: '7400000000000000008', user: 'laksalady', caption: 'Assam laksa recipe that went viral #laksa #recipe', music: 'original sound - laksalady' },
];

const item = (v: typeof VIDEOS[number], i: number) => `
<article data-e2e="recommend-list-item-container" class="item">
  <div class="media"><video src="/clip${i % 6}.webm" muted loop playsinline preload="auto"></video></div>
  <div class="side">
    <a href="/@${v.user}" data-e2e="video-author-uniqueid">${v.user}</a>
    <div data-e2e="video-desc">${v.caption}</div>
    <a href="/music/x" data-e2e="video-music">${v.music}</a>
    ${v.ad ? '<span>Sponsored</span>' : ''}${v.live ? '<span data-e2e="live-tag">LIVE</span>' : ''}
    <strong data-e2e="like-count">${(i + 1) * 1234}</strong><strong data-e2e="comment-count">${i * 12}</strong><strong data-e2e="share-count">${i * 3}</strong>
    <a href="/@${v.user}/video/${v.id}">link</a>
  </div>
</article>`;

const PAGE = (captchaAfter: number, loops: number) => `<!doctype html><html><head><meta charset="utf-8"><title>Fake TikTok</title>
<style>body{margin:0;font-family:sans-serif} .feed{height:100vh;overflow-y:scroll;scroll-snap-type:y mandatory}
.item{height:100vh;scroll-snap-align:start;display:flex;gap:20px;align-items:center;justify-content:center;border-bottom:1px solid #ccc}
video{height:85vh;aspect-ratio:9/16;background:#000} .side{width:300px}
#captcha-verify-container{position:fixed;inset:30% 35%;background:#fff;border:3px solid red;z-index:9;padding:20px}</style></head>
<body><div class="feed" id="feed">${Array.from({ length: loops }, () => VIDEOS).flat().map(item).join('')}</div>
<script>
const feed = document.getElementById('feed'); let idx = 0, moves = 0; const items = [...document.querySelectorAll('.item')];
function show(i){ idx = Math.max(0, Math.min(items.length-1, i)); items[idx].scrollIntoView(); document.querySelectorAll('video').forEach((v,j)=>{ if(j===idx){v.play().catch(()=>{})} else v.pause(); }); }
document.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { moves++; show(idx+1); if (${captchaAfter} > 0 && moves === ${captchaAfter}) { const c = document.createElement('div'); c.id='captcha-verify-container'; c.textContent='Drag the slider'; document.body.appendChild(c); } } if (e.key === 'ArrowUp') show(idx-1); });
setTimeout(() => show(0), 300);
</script></body></html>`;

export function startFakeTikTok(port = 0, opts: { captchaAfter?: number } = {}): Promise<{ url: string; close: () => void }> {
  let pageLoads = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    const clip = u.pathname.match(/^\/clip(\d)\.webm$/);
    if (clip) {
      const f = path.join(DIR, `clip${clip[1]}.webm`), stat = fs.statSync(f), range = req.headers.range;
      if (range) {
        const [s, e] = range.replace('bytes=', '').split('-'); const start = Number(s), end = e ? Number(e) : stat.size - 1;
        res.writeHead(206, { 'content-type': 'video/webm', 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
        fs.createReadStream(f, { start, end }).pipe(res);
      } else { res.writeHead(200, { 'content-type': 'video/webm', 'content-length': stat.size, 'accept-ranges': 'bytes' }); fs.createReadStream(f).pipe(res); }
      return;
    }
    if (u.pathname === '/foryou' || u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE(pageLoads++ === 0 ? opts.captchaAfter ?? 0 : 0, 4)); return;
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    const a = server.address() as any;
    resolve({ url: `http://127.0.0.1:${a.port}`, close: () => server.close() });
  }));
}

export interface MockStats { calls: number; imageRejects: number; byKind: Record<string, number>; visionCalls: number; lastUserText: string; lastVisionAuth: string }

/** Fake OpenAI-compatible API. Rejects images like a text-only model would. */
export function startMockLlm(port = 0): Promise<{ url: string; stats: MockStats; close: () => void }> {
  const stats: MockStats = { calls: 0, imageRejects: 0, byKind: {}, visionCalls: 0, lastUserText: '', lastVisionAuth: '' };
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    if (req.url?.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })); return; }
    const j = JSON.parse(body || '{}');
    if (j.model === 'mock-vision') {
      // A vision model (like Gemini/OpenAI/Ollama): accepts images, returns a description.
      stats.visionCalls++; stats.lastVisionAuth = String(req.headers.authorization ?? '');
      const parts = j.messages?.[0]?.content ?? [];
      const n = Array.isArray(parts) ? parts.filter((p: any) => p.type === 'image_url' && String(p.image_url?.url).startsWith('data:image/jpeg;base64,')).length : 0;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: `I see ${n} image(s): a plate of nasi lemak with sambal; on-screen text "RESEPI MUDAH".` } }], usage: { prompt_tokens: 900, completion_tokens: 40 } }));
      return;
    }
    if (j.model === 'missing-vision') { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":{"message":"model not found"}}'); return; }
    if (req.headers.authorization !== 'Bearer sk-test-123456789') { res.writeHead(401); res.end('{"error":"bad key"}'); return; }
    const user = j.messages?.[1]?.content;
    if (Array.isArray(user) && user.some((p: any) => p.type === 'image_url')) {
      stats.imageRejects++;
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to deserialize the JSON body into the target type: messages[1]: unknown variant `image_url`, expected `text`' } }));
      return;
    }
    stats.calls++;
    stats.lastUserText = typeof user === 'string' ? user : JSON.stringify(user);
    const sys: string = j.messages?.[0]?.content ?? '';
    let out: any;
    if (sys.includes('Decide if this video')) {
      stats.byKind.decide = (stats.byKind.decide ?? 0) + 1;
      const recipe = /Caption: [^\n]*recipe/i.test(sys);
      out = { action: recipe ? 'watch' : 'skip', interest: recipe ? 85 : 20, reason: recipe ? 'A Malaysian recipe, on topic' : 'Off topic', is_ad: false, is_live: false, language: 'English', topics: [{ topic: recipe ? 'malaysian recipes' : 'other', signal: recipe ? 'like' : 'dislike' }] };
    } else if (sys.includes('Analyse it')) {
      stats.byKind.analyze = (stats.byKind.analyze ?? 0) + 1;
      out = { save: true, score: 88, topic: 'Malaysian recipe', hook: 'Shows the finished dish in the first second', format: 'recipe tutorial', reason: 'Strong hook, easy to remake', audio: 'original sound', summary: 'A quick recipe.', topics: [{ topic: 'malaysian recipes', signal: 'like' }] };
    } else if (sys.includes("Today's picks")) {
      stats.byKind.picks = (stats.byKind.picks ?? 0) + 1;
      const ids = [...sys.matchAll(/"id": (\d+)/g)].map(m => Number(m[1]));
      out = { summary: 'Recipes are trending.', picks: ids.slice(0, 3).map(id => ({ id, why: 'Strong hook', idea: 'Make your own 30s version' })) };
    } else out = { ok: true, hello: 'hai' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 1500, completion_tokens: 120, prompt_cache_hit_tokens: 500, prompt_cache_miss_tokens: 1000 } }));
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    const a = server.address() as any;
    resolve({ url: `http://127.0.0.1:${a.port}`, stats, close: () => server.close() });
  }));
}
