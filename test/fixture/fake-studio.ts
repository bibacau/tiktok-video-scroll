// A fake TikTok Studio (upload page + content list) with the same structure the uploader expects.
import http from 'node:http';

export interface StudioPost { id: string; caption: string; ai: boolean; privacy: string; at: string }
export interface Studio { url: string; posts: StudioPost[]; opts: { aiBroken: boolean; loggedOut: boolean }; close: () => void }

const UPLOAD = `<!doctype html><html><body>
<h1>Upload</h1><input type="file" id="file" accept="video/*">
<div id="editor" style="display:none">
  <div data-e2e="upload-editor-caption"><div contenteditable="true" role="textbox" id="cap" style="min-height:40px;border:1px solid #ccc"></div></div>
  <div class="row"><span>Who can see this post</span><button role="combobox" aria-haspopup="dialog" id="aud"><div>Everyone</div></button></div>
  <div id="opts" role="listbox" style="display:none"><div role="option">Everyone</div><div role="option">Friends</div><div role="option">Only you</div></div>
  <button id="more">Show more</button>
  <div id="adv" style="display:none"><div class="setting"><span>AI-generated content</span><div role="switch" aria-checked="false" id="ai" style="width:40px;height:20px;background:#ccc"></div></div></div>
  <button data-e2e="post_video_button" id="post">Post</button>
</div>
<div id="modal" role="dialog" style="display:none">Label your content as AI-generated? <button id="turnon">Turn on</button><button>Cancel</button></div>
<script>
const AI_BROKEN = __AI_BROKEN__;
file.onchange = () => setTimeout(() => { editor.style.display = 'block'; }, 400);
aud.onclick = () => { opts.style.display = 'block'; };
opts.onclick = e => { if (e.target.getAttribute('role') === 'option') { aud.firstChild.textContent = e.target.textContent; opts.remove(); } };
more.onclick = () => { adv.style.display = 'block'; };
ai.onclick = () => { if (ai.getAttribute('aria-checked') === 'true') { ai.setAttribute('aria-checked', 'false'); return; } modal.style.display = 'block'; };
turnon.onclick = () => { modal.style.display = 'none'; if (!AI_BROKEN) ai.setAttribute('aria-checked', 'true'); };
post.onclick = async () => {
  const r = await fetch('/aweme/v1/web/aweme/post/', { method: 'POST', body: JSON.stringify({ caption: cap.innerText, ai: ai.getAttribute('aria-checked') === 'true', privacy: aud.textContent.trim() }) });
  if ((await r.json()).status_code === 0) setTimeout(() => location.href = '/tiktokstudio/content', 300);
};
</script></body></html>`;

export function startFakeStudio(): Promise<Studio> {
  const posts: StudioPost[] = [];
  const opts = { aiBroken: false, loggedOut: false };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    let body = ''; for await (const c of req) body += c;
    if (opts.loggedOut && u.pathname.startsWith('/tiktokstudio')) { res.writeHead(302, { location: '/login' }); res.end(); return; }
    if (u.pathname === '/tiktokstudio/upload') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(UPLOAD.replace('__AI_BROKEN__', String(opts.aiBroken))); return; }
    if (u.pathname === '/aweme/v1/web/aweme/post/') {
      const j = JSON.parse(body);
      posts.push({ id: String(7500000000000000000n + BigInt(posts.length + 1)), caption: j.caption, ai: j.ai, privacy: j.privacy, at: new Date().toISOString() });
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status_code":0}'); return;
    }
    if (u.pathname === '/tiktokstudio/content') {
      const rows = posts.map((p, i) => `<div class="row"><a href="/@me/video/${p.id}">${p.caption}</a><div><span>${(i + 1) * 1200}</span><span>${(i + 1) * 80}</span><span>${i * 3}</span></div><button>${p.privacy}</button></div>`).join('');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><body><h1>Posts</h1>${rows}</body>`); return;
    }
    if (u.pathname === '/login') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<div data-e2e="login-modal" style="width:300px;height:300px">Log in to TikTok</div>'); return; }
    res.writeHead(404); res.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${(server.address() as any).port}`, posts, opts, close: () => server.close() });
  }));
}
