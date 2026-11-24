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
  <div class="media" __WRAP_${v.id}__><video src="/clip${i % 6}.webm" muted loop playsinline preload="auto"></video></div>
  <div class="side">
    <a href="/@${v.user}" data-e2e="video-author-uniqueid">${v.user}</a>
    <div data-e2e="video-desc">${v.caption}</div>
    <a href="/music/x" data-e2e="video-music">${v.music}</a>
    ${v.ad ? '<span>Sponsored</span>' : ''}${v.live ? '<span data-e2e="live-tag">LIVE</span>' : ''}
    <strong data-e2e="like-count">${(i + 1) * 1234}</strong><strong data-e2e="comment-count">${i * 12}</strong><strong data-e2e="share-count">${i * 3}</strong>
    __LINK_${v.id}_${v.user}__
    <button data-e2e="like-icon" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true');fetch('/engage?kind=like&id=${v.id}')">♥</button>
    <button data-e2e="favorite-icon" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true');fetch('/engage?kind=favourite&id=${v.id}')">🔖</button>
    <button data-e2e="share-icon" onclick="openShare('${v.id}','${v.user}')">Share</button>
    <button data-e2e="feed-follow" onclick="this.textContent='Following';fetch('/engage?kind=follow&id=${v.user}')">Follow</button>
  </div>
</article>`;

const PAGE = (captchaAfter: number, loops: number) => `<!doctype html><html><head><meta charset="utf-8"><title>Fake TikTok</title>
<style>body{margin:0;font-family:sans-serif} .feed{height:100vh;overflow-y:scroll;scroll-snap-type:y mandatory}
.item{height:100vh;scroll-snap-align:start;display:flex;gap:20px;align-items:center;justify-content:center;border-bottom:1px solid #ccc}
video{height:85vh;aspect-ratio:9/16;background:#000} .side{width:300px}
#captcha-verify-container{position:fixed;inset:30% 35%;background:#fff;border:3px solid red;z-index:9;padding:20px}</style></head>
<body>__SHARE_UI__<input data-e2e="search-user-input" id="sq" placeholder="Search" style="position:fixed;top:4px;left:4px;z-index:5;width:200px">
<div class="feed" id="feed">${Array.from({ length: loops }, () => VIDEOS).flat().map(item).join('')}</div>
<script>
const feed = document.getElementById('feed'); let idx = 0, moves = 0; const items = [...document.querySelectorAll('.item')];
function show(i){ idx = Math.max(0, Math.min(items.length-1, i)); items[idx].scrollIntoView(); document.querySelectorAll('video').forEach((v,j)=>{ if(j===idx){v.play().catch(()=>{})} else v.pause(); }); }
let keys = 0;
sq.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') location.href = '/search/video?q=' + encodeURIComponent(sq.value) + '&keys=' + keys; else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) keys++; });
document.addEventListener('keydown', e => { if (document.activeElement === sq) return; if (e.key === 'ArrowDown') { moves++; show(idx+1); if (${captchaAfter} > 0 && moves === ${captchaAfter}) { const c = document.createElement('div'); c.id='captcha-verify-container'; c.textContent='Drag the slider'; document.body.appendChild(c); } } if (e.key === 'ArrowUp') show(idx-1); });
setTimeout(() => show(0), 300);
if (__AUTO_ADVANCE__ > 0) { let lastIdx = -1, since = Date.now(); setInterval(() => { if (idx !== lastIdx) { lastIdx = idx; since = Date.now(); } else if (Date.now() - since > __AUTO_ADVANCE__) { show(idx + 1); } }, 200); }
</script></body></html>`;

export const engaged: Array<{ kind: string; id: string }> = [];
export const searchesSeen: Array<{ q: string; keys: number }> = [];
export const sharesSeen: Array<{ id: string; to: string }> = [];
/** Fake TikTok Messages inbox. */
export const inbox: { convs: Array<{ user: string; name: string; unread: boolean; messages: Array<{ mine: boolean; text: string }> }> } = { convs: [] };
export const dmSent: Array<{ to: string; text: string; keys: number }> = [];
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function messagesPage(current: string | null) {
  const c = inbox.convs.find(x => x.user === current);
  if (c) c.unread = false;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div id="list" data-e2e="chat-list">${inbox.convs.map(x => `<div data-e2e="chat-list-item" style="padding:6px;cursor:pointer" onclick="location.href='/messages?c=${x.user}'"><p data-e2e="chat-list-item-name">${escHtml(x.name)}</p>${x.unread ? '<span data-e2e="chat-list-item-unread">1</span>' : ''}</div>`).join('')}</div>
  ${c ? `<div id="chat"><div data-e2e="chat-header"><a href="/@${c.user}">${escHtml(c.name)}</a></div>
    ${c.messages.map(m => `<div data-e2e="chat-item">${m.mine ? '<span data-e2e="chat-item-mine"></span>' : ''}<p data-e2e="chat-item-text">${escHtml(m.text)}</p></div>`).join('')}
    <div data-e2e="message-input-area"><div contenteditable="true" id="mi" style="min-height:30px;border:1px solid #999"></div></div>
    <button data-e2e="message-send" id="ms">Send</button></div>
  <script>let keys = 0; mi.addEventListener('keydown', e => { if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) keys++; });
    ms.onclick = () => fetch('/dm?to=${c.user}&keys=' + keys, { method: 'POST', body: mi.innerText }).then(() => location.reload());</script>` : ''}
  </body></html>`;
}
/** Share panel like TikTok's: Share → Send to → recent contact list (1 shown) + search box → Send. */
export const shareOpts = { recipients: ['kawan1', 'bibacau', 'kawan2'], notMutual: false };
const SHARE_UI = () => `
<div role="dialog" id="sharebox" style="display:none;position:fixed;top:15%;left:30%;background:#fff;border:2px solid #333;z-index:20;padding:10px;width:320px">
  <div>Share to</div><button id="copylink">Copy link</button><button id="sendto">Send to</button>
  <div id="friends" style="display:none"><input placeholder="Search" id="fs"><div id="flist"></div><div id="fmsg"></div><button id="fsend" disabled>Send</button></div>
</div>
<script>
(() => {
  const RECIP = ${JSON.stringify(shareOpts.recipients)}, NOT_MUTUAL = ${shareOpts.notMutual};
  let shareId = null, chosen = null;
  const reset = () => { sharebox.style.display = 'none'; friends.style.display = 'none'; fs.value = ''; chosen = null; fsend.disabled = true; fmsg.textContent = ''; };
  let shareUser = '';
  window.openShare = (id, user) => { reset(); shareId = id; shareUser = user || 'someone'; sharebox.style.display = 'block'; };
  copylink.onclick = () => { navigator.clipboard.writeText(location.origin + '/@' + shareUser + '/video/' + shareId).catch(() => {}); reset(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') reset(); }, true);
  const render = q => {
    const list = RECIP.filter(r => !q || r.includes(q.toLowerCase())).slice(0, q ? 10 : 1);
    flist.innerHTML = list.map(r => '<div role="option" aria-selected="false" data-u="' + r + '" style="padding:4px"><span>' + r + '</span> <small>@' + r + '</small></div>').join('');
    fmsg.textContent = q && !list.length ? 'No results' : '';
    flist.querySelectorAll('[role=option]').forEach(o => o.onclick = () => { o.setAttribute('aria-selected', 'true'); chosen = o.dataset.u; fsend.disabled = false; });
  };
  sendto.onclick = () => { friends.style.display = 'block'; render(''); };
  fs.addEventListener('keydown', e => e.stopPropagation());
  fs.oninput = () => render(fs.value);
  fsend.onclick = async () => {
    if (NOT_MUTUAL) { fmsg.textContent = "You can't send messages to this account"; return; }
    await fetch('/share?id=' + shareId + '&to=' + chosen);
    fmsg.textContent = 'Sent'; setTimeout(reset, 700);
  };
})();
</script>`;
export const commentsPosted: Array<{ video: string; text: string }> = [];
/** feedIds: where the video id is visible in the feed — 'link' (an <a href=/video/…>), 'wrapper' (only the
 *  player wrapper's element id, like the real For You feed) or 'none'. autoAdvanceMs: move to the next video by itself. */
export function startFakeTikTok(port = 0, opts: { captchaAfter?: number; noSearchBox?: boolean; feedIds?: 'link' | 'wrapper' | 'none'; autoAdvanceMs?: number } = {}): Promise<{ url: string; close: () => void }> {
  let pageLoads = 0;
  const server = http.createServer(async (req, res) => {
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
    if (u.pathname === '/search/video') {
      searchesSeen.push({ q: u.searchParams.get('q') ?? '', keys: Number(u.searchParams.get('keys') ?? -1) });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><body><h1>Results</h1>${VIDEOS.slice(0, 4).map(v => `<div data-e2e="search_video-item" style="width:200px;height:300px;display:inline-block"><a href="/@${v.user}/video/${v.id}">${v.caption}</a></div>`).join('')}</body>`);
      return;
    }
    if (u.pathname === '/messages') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(messagesPage(u.searchParams.get('c'))); return; }
    if (u.pathname === '/dm' && req.method === 'POST') {
      let b = ''; for await (const x of req) b += x;
      const to = u.searchParams.get('to')!;
      dmSent.push({ to, text: b, keys: Number(u.searchParams.get('keys')) });
      inbox.convs.find(x => x.user === to)?.messages.push({ mine: true, text: b });
      res.end('ok'); return;
    }
    if (u.pathname === '/share') { sharesSeen.push({ id: u.searchParams.get('id')!, to: u.searchParams.get('to')! }); res.end('ok'); return; }
    if (u.pathname === '/engage') { engaged.push({ kind: u.searchParams.get('kind')!, id: u.searchParams.get('id')! }); res.end('ok'); return; }
    const vid = u.pathname.match(/^\/@[^/]+\/video\/(\d+)$/);
    if (vid && req.method === 'POST') { let b = ''; for await (const c of req) b += c; commentsPosted.push({ video: vid[1], text: b }); res.end('ok'); return; }
    if (vid) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><body><video src="/clip0.webm" muted autoplay loop style="height:400px"></video><div data-e2e="browse-video-desc">video ${vid[1]}</div>
        <div id="list"></div><div data-e2e="comment-input"><div contenteditable="true" role="textbox" id="ci" style="min-height:30px;border:1px solid #ccc"></div></div>
        <button data-e2e="browse-share-icon" onclick="openShare('${vid[1]}')">Share</button>${SHARE_UI()}
        <button data-e2e="comment-post" onclick="fetch(location.pathname,{method:'POST',body:ci.innerText}).then(()=>{const d=document.createElement('p');d.textContent=ci.innerText;list.appendChild(d);ci.textContent='';})">Post</button></body>`);
      return;
    }
    if (u.pathname === '/foryou' || u.pathname === '/') {
      const ids = opts.feedIds ?? 'link';
      const html = PAGE(pageLoads++ === 0 ? opts.captchaAfter ?? 0 : 0, 4).replace('__SHARE_UI__', SHARE_UI())
        .replace(/__WRAP_(\d+)__/g, (_m, id) => ids === 'wrapper' ? `id="xgwrapper-0-${id}"` : '')
        .replace(/__LINK_(\d+)_([\w.]+)__/g, (_m, id, user) => ids === 'link' ? `<a href="/@${user}/video/${id}">link</a>` : '')
        .replace('__AUTO_ADVANCE__ > 0', `${opts.autoAdvanceMs ?? 0} > 0`).replace('Date.now() - since > __AUTO_ADVANCE__', `Date.now() - since > ${opts.autoAdvanceMs ?? 0}`);
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(opts.noSearchBox ? html.replace(/<input data-e2e="search-user-input"[^>]*>/, '').replace(/let keys = 0;[\s\S]*?\+ keys; else if[^\n]*\n/, '') : html); return;
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
    if (sys.includes('You may ALSO choose "action": "search"') && !stats.byKind.search) {
      stats.byKind.search = 1;
      out = { action: 'search', query: 'resepi kuih raya mudah', reason: 'The feed is drifting off topic; looking for easy kuih recipes', interest: 10, topics: [] };
    } else if (sys.includes('Decide if this video')) {
      stats.byKind.decide = (stats.byKind.decide ?? 0) + 1;
      const recipe = /Caption: [^\n]*recipe/i.test(sys);
      out = { action: recipe ? 'watch' : 'skip', interest: recipe ? 85 : 20, reason: recipe ? 'A Malaysian recipe, on topic' : 'Off topic', is_ad: false, is_live: false, language: 'English', topics: [{ topic: recipe ? 'malaysian recipes' : 'other', signal: recipe ? 'like' : 'dislike' }] };
    } else if (sys.includes('Analyse it')) {
      stats.byKind.analyze = (stats.byKind.analyze ?? 0) + 1;
      out = { save: true, score: 88, topic: 'Malaysian recipe', hook: 'Shows the finished dish in the first second', format: 'recipe tutorial', reason: 'Strong hook, easy to remake', audio: 'original sound', summary: 'A quick recipe.', topics: [{ topic: 'malaysian recipes', signal: 'like' }] };
    } else if (sys.includes('You are planning ORIGINAL')) {
      stats.byKind.plan = (stats.byKind.plan ?? 0) + 1;
      out = { ideas: [{ title: 'Nasi lemak in 3 steps', angle: 'Fast home version', why: 'Trending', inspired_by: [] }, { title: 'Roti canai myths', angle: 'Myth vs fact', why: 'Fun', inspired_by: [] }] };
    } else if (sys.includes('Write the script for an ORIGINAL')) {
      stats.byKind.script = (stats.byKind.script ?? 0) + 1;
      const retry = typeof user === 'string' && user.includes('banned words');
      out = {
        title: 'Nasi lemak 3 langkah', hook: 'Tahukah anda?',
        scenes: [
          { voiceover: retry ? 'Tahukah anda nasi lemak boleh siap dalam sepuluh minit?' : 'Nasi lemak paling sedap siap dalam sepuluh minit!', on_screen: 'Nasi lemak 10 minit', keywords: 'nasi lemak plate', image_prompt: 'a plate of nasi lemak' },
          { voiceover: 'Masak nasi dengan santan dan daun pandan.', on_screen: 'Langkah 1', keywords: 'coconut rice cooking', image_prompt: 'coconut rice in a pot' },
          { voiceover: 'Goreng ikan bilis dan kacang sampai rangup.', on_screen: 'Langkah 2', keywords: 'fried anchovies', image_prompt: 'crispy fried anchovies' },
          { voiceover: 'Apa lauk kegemaran anda? Komen di bawah!', on_screen: 'Komen!', keywords: 'food table', image_prompt: 'malaysian food table' },
        ],
        caption: 'Nasi lemak cepat 🍛 Anda suka pedas? #food', hashtags: ['#nasilemak', 'resepi', 'fyp', 'masakan', 'malaysianfood', 'extra1', 'extra2'],
      };
    } else if (sys.includes('Write ONE short TikTok comment')) {
      stats.byKind.comment = (stats.byKind.comment ?? 0) + 1;
      out = { comment: 'Nampak sedap! Nak cuba resepi ni hujung minggu 😋' };
    } else if (sys.includes('Reply to this private TikTok message')) {
      stats.byKind.dm = (stats.byKind.dm ?? 0) + 1;
      out = sys.includes('LINKTEST') ? { reply: 'Tengok sini https://example.com/resepi', flag: 'none', reason: 'share link' }
        : { reply: 'Terima kasih! Nanti saya kongsi resepi baru 😊', flag: 'none', reason: 'friendly reply' };
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

// ---------------------------------------------------------------- media mocks for video creation
import { WebSocketServer } from 'ws';
import jpeg from 'jpeg-js';

function makeFile(name: string, args: string[]) {
  const f = path.join(DIR, name);
  if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, f]);
  return f;
}
export function testAssets() {
  return {
    stock: makeFile('stock.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:d=6:r=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']),
    music: makeFile('music.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=20', '-c:a', 'libmp3lame', '-b:a', '64k']),
    logo: makeFile('logo.png', ['-f', 'lavfi', '-i', 'color=c=red:s=200x80:d=1', '-frames:v', '1']),
  };
}
function speechMp3(seconds: number) {
  const s = Math.max(1, Math.round(seconds * 2) / 2);
  return makeFile(`speech-${s}.mp3`, ['-f', 'lavfi', '-i', `sine=frequency=520:duration=${s}`, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k']);
}

export interface MediaStats { edgeRequests: number; edgeBadAuth: number; pexels: number; images: number; lastVoice: string }

/** Fake Edge TTS (same websocket protocol), fake Pexels and a fake OpenAI images API. */
export function startMediaMocks(): Promise<{ url: string; ws: string; stats: MediaStats; close: () => void }> {
  const stats: MediaStats = { edgeRequests: 0, edgeBadAuth: 0, pexels: 0, images: 0, lastVoice: '' };
  const assets = testAssets();
  let base = '';
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    let body = ''; for await (const c of req) body += c;
    if (u.pathname === '/videos/search') {
      stats.pexels++;
      const q = u.searchParams.get('query') ?? '';
      const link = q.includes('tiktok') ? 'https://v16-webapp.tiktokcdn.com/someone-elses-video.mp4' : `${base}/stock.mp4`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ videos: [{ duration: 6, user: { name: 'Test Shooter' }, video_files: [{ file_type: 'video/mp4', link, height: 1280, width: 720 }] }] }));
      return;
    }
    if (u.pathname === '/stock.mp4') { res.writeHead(200, { 'content-type': 'video/mp4' }); fs.createReadStream(assets.stock).pipe(res); return; }
    if (u.pathname === '/v1/images/generations') {
      stats.images++;
      const j = JSON.parse(body || '{}');
      const w = 256, h = 384, data = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) { data[i * 4] = (i % w) & 255; data[i * 4 + 1] = 120; data[i * 4 + 2] = Math.floor(i / w) & 255; data[i * 4 + 3] = 255; }
      const b64 = Buffer.from(jpeg.encode({ width: w, height: h, data }, 80).data).toString('base64');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: b64, revised_prompt: j.prompt }] }));
      return;
    }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url!, 'http://x');
    const ok = /^[0-9A-F]{64}$/.test(u.searchParams.get('Sec-MS-GEC') ?? '') && u.searchParams.get('TrustedClientToken') && String(req.headers.origin).startsWith('chrome-extension://');
    if (!ok) { stats.edgeBadAuth++; socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      ws.on('message', (data: Buffer) => {
        const msg = data.toString();
        if (!msg.includes('Path:ssml')) return;
        stats.edgeRequests++;
        stats.lastVoice = msg.match(/voice name='([^']+)'/)?.[1] ?? '';
        const text = (msg.match(/<prosody[^>]*>([\s\S]*?)<\/prosody>/)?.[1] ?? '').trim();
        const words = text.split(/\s+/).filter(Boolean);
        const meta = { Metadata: words.map((w, i) => ({ Type: 'WordBoundary', Data: { Offset: Math.round(i * 0.3 * 1e7), Duration: 2.5e6, text: { Text: w } } })) };
        ws.send(`X-RequestId:x\r\nContent-Type:application/json; charset=utf-8\r\nPath:audio.metadata\r\n\r\n${JSON.stringify(meta)}`);
        const audio = fs.readFileSync(speechMp3(words.length * 0.3 + 0.2));
        const header = Buffer.from('X-RequestId:x\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n');
        for (let o = 0; o < audio.length; o += 4096) {
          const len = Buffer.alloc(2); len.writeUInt16BE(header.length);
          ws.send(Buffer.concat([len, header, audio.subarray(o, o + 4096)]));
        }
        ws.send('X-RequestId:x\r\nPath:turn.end\r\n\r\n{}');
      });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const a = server.address() as any;
    base = `http://127.0.0.1:${a.port}`;
    resolve({ url: base, ws: `ws://127.0.0.1:${a.port}/edge`, stats, close: () => { wss.close(); server.close(); } });
  }));
}
