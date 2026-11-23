// Functions here run INSIDE the TikTok page (via page.evaluate). Plain JS on purpose.
// Each one is self-contained and takes a single JSON argument.

/** Inspect the page: blocking screens (captcha/login) + the video currently in view. */
function inspect(sel) {
  const visRect = el => {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return null;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return null;
    return r;
  };
  const all = (root, list) => { const out = []; for (const s of list || []) { try { out.push(...root.querySelectorAll(s)); } catch (e) { /* invalid selector */ } } return out; };
  const first = (root, list) => { for (const s of list || []) { try { const el = root.querySelector(s); if (el) return el; } catch (e) { /* invalid */ } } return null; };
  const firstVisible = (root, list) => all(root, list).find(visRect) || null;
  const text = el => (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
  const hasExactText = (root, words, limit = 600) => {
    if (!words || !words.length) return false;
    const nodes = root.querySelectorAll('span,div,p,strong,em,small,label');
    for (let i = 0; i < nodes.length && i < limit; i++) {
      const n = nodes[i];
      if (n.children.length > 1) continue;
      const t = text(n);
      if (t && t.length <= 14 && words.includes(t) && visRect(n)) return true;
    }
    return false;
  };

  // ---- guard: captcha / login / verification ----
  let guard = null;
  const cap = all(document, sel.captcha).find(el => { const r = visRect(el); return r && r.width >= 40 && r.height >= 40; });
  if (cap) guard = { kind: 'captcha', detail: 'Captcha / verification shown' };
  const dialogs = all(document, ['[role="dialog"]', '[aria-modal="true"]', '[class*="modal" i]']).filter(visRect);
  const dialogText = dialogs.map(text).join(' \n ').slice(0, 5000);
  if (!guard && (sel.captchaTexts || []).some(t => dialogText.includes(t))) guard = { kind: 'captcha', detail: 'Verification dialog shown' };
  if (!guard) {
    const loginEl = firstVisible(document, sel.loginModal);
    if (loginEl || (sel.loginTexts || []).some(t => dialogText.includes(t)) || /^\/login/.test(location.pathname)) guard = { kind: 'login', detail: 'Login prompt shown' };
  }

  // ---- the video in view (largest visible area) ----
  let best = null, bestArea = 0;
  for (const v of all(document, sel.activeVideo)) {
    const r = visRect(v);
    if (!r) continue;
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0), h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    const area = Math.max(0, w) * Math.max(0, h);
    if (area > bestArea) { bestArea = area; best = v; }
  }
  const gridCount = all(document, sel.gridItem).filter(visRect).length;
  if (!best || bestArea < 20000) return { url: location.href, guard, video: null, gridCount };

  // Climb from the <video> to the nearest ancestor that also holds a caption.
  let container = null, node = best.parentElement;
  for (let i = 0; node && i < 18; i++, node = node.parentElement) {
    if (first(node, sel.desc)) { container = node; break; }
  }
  const root = container || document;
  const descEl = first(root, sel.desc);
  const desc = text(descEl);
  const hashtags = Array.from(new Set((desc.match(/#[\p{L}\p{N}_]+/gu) || []).map(h => h.slice(1))));
  let author = text(first(root, sel.author)).replace(/^@/, '').split(' ')[0] || '';
  const authorLink = first(root, ['a[href^="/@"]', 'a[href*="tiktok.com/@"]']);
  if (!author && authorLink) { const m = authorLink.getAttribute('href').match(/@([^/?]+)/); if (m) author = m[1]; }
  const linkEl = first(root, sel.videoLink);
  let url = linkEl ? linkEl.href : null;
  if (!url && /\/video\/\d+/.test(location.pathname)) url = location.origin + location.pathname;
  const idMatch = url && url.match(/\/video\/(\d+)/);
  let key = idMatch ? idMatch[1] : null;
  if (!key) {
    let h = 0; const s = author + '|' + desc + '|' + (best.currentSrc || '').slice(0, 60);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    key = 'h' + (h >>> 0).toString(36);
  }
  const r = best.getBoundingClientRect();
  const isAd = !!first(root, sel.adMarkers) || hasExactText(root, sel.adTexts);
  const isLive = !!first(root, sel.liveMarkers) || hasExactText(root, sel.liveTexts) || /\/live(\/|$)/.test(location.pathname);
  return {
    url: location.href, guard, gridCount,
    video: {
      key, url, author, desc: desc.slice(0, 2200), hashtags,
      music: text(first(root, sel.music)).slice(0, 200),
      stats: { likes: text(first(root, sel.likeCount)), comments: text(first(root, sel.commentCount)), shares: text(first(root, sel.shareCount)), saves: text(first(root, sel.saveCount)) },
      duration: Number.isFinite(best.duration) ? best.duration : null,
      currentTime: best.currentTime, paused: best.paused, readyState: best.readyState,
      rect: { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(r.width, innerWidth - Math.max(0, r.left)), height: Math.min(r.height, innerHeight - Math.max(0, r.top)) },
      isAd, isLive, containerFound: !!container,
    },
  };
}

/** Pause or play every video (used by pause/resume and the captcha guard). */
function setPlaying(play) {
  document.querySelectorAll('video').forEach(v => { try { play ? v.play().catch(() => {}) : v.pause(); } catch (e) { /* ignore */ } });
  return true;
}

/** Click a grid item (search/hashtag/creator pages) to open the player. */
function clickGridItem(arg) {
  const items = [];
  for (const s of arg.selectors) { try { items.push(...document.querySelectorAll(s)); } catch (e) { /* invalid */ } }
  const visible = items.filter(el => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 20; });
  const el = visible[Math.min(arg.index, visible.length - 1)];
  if (!el) return false;
  const target = el.querySelector('a[href*="/video/"]') || el.querySelector('a') || el;
  target.scrollIntoView({ block: 'center' });
  target.click();
  return true;
}

/** Click the first visible element from a selector list. */
function clickFirst(selectors) {
  for (const s of selectors) {
    let els = [];
    try { els = Array.from(document.querySelectorAll(s)); } catch (e) { continue; }
    const el = els.find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (el) { el.click(); return s; }
  }
  return null;
}
