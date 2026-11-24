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

// ------------------------------------------------------------------ TikTok Studio (posting)

/** Find the "AI-generated content" switch; turn it on if asked. Reads state only from aria-checked / checked. */
function aiLabel(arg) {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const lower = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const labels = [...document.querySelectorAll('label,span,div,p,h1,h2,h3,h4,strong')]
    .filter(el => el.children.length <= 3 && vis(el) && arg.texts.some(t => lower(el.textContent).startsWith(t.toLowerCase())));
  if (!labels.length) return { found: false, checked: null };
  for (const lab of labels) {
    let node = lab;
    for (let i = 0; i < 7 && node; i++, node = node.parentElement) {
      const sw = node.querySelector('[role="switch"], input[type="checkbox"], [aria-checked]');
      if (!sw) continue;
      const state = () => sw.getAttribute('aria-checked') === 'true' || sw.checked === true;
      let clicked = false;
      if (!state() && arg.turnOn) { sw.click(); clicked = true; }
      return { found: true, checked: state(), clicked };
    }
  }
  return { found: true, checked: null };
}

/** Click the first visible button whose text is one of `texts` (case-insensitive, exact). Optionally only inside dialogs. */
function clickByText(arg) {
  const roots = arg.inDialog ? [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.TUXModal,[class*="modal" i]')] : [document];
  const want = arg.texts.map(t => t.toLowerCase());
  for (const root of roots) {
    for (const b of root.querySelectorAll('button,[role="button"],a')) {
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && want.includes(t) && !b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); return t; }
    }
  }
  return null;
}

/** Dismiss intro / consent overlays (ported from 0xArtex/tiktok-mcp dismissBlockingModal). */
function dismissModals(arg) {
  const ovs = [...document.querySelectorAll('.TUXModal-overlay,.react-joyride__overlay,[role="dialog"]')].filter(o => o.getClientRects().length > 0);
  if (!ovs.length) return { open: 0 };
  for (const id of ['button-skip', 'button-close']) {
    const el = document.querySelector('[data-test-id="' + id + '"]');
    if (el && el.getClientRects().length) { el.click(); return { open: ovs.length, clicked: id }; }
  }
  // Never dismiss the AI-label confirmation or schedule consent: those are handled explicitly.
  const text = ovs.map(o => o.textContent || '').join(' ');
  if (arg.keep.some(k => text.includes(k))) return { open: ovs.length, kept: true };
  for (const o of ovs) for (const b of o.querySelectorAll('button,[role="button"]')) {
    const t = (b.textContent || '').trim().toLowerCase();
    if (b.getClientRects().length && arg.labels.includes(t)) { b.click(); return { open: ovs.length, clicked: t }; }
  }
  return { open: ovs.length, clicked: null };
}

/** Rows of TikTok Studio's content list (ported from 0xArtex/tiktok-mcp analyzePosts). */
function studioRows() {
  const parseNum = t => {
    if (t == null) return null;
    const m = String(t).trim().replace(/,/g, '').match(/^([\d.]+)\s*([KMB])?$/i);
    if (!m) return null;
    let n = parseFloat(m[1]); const u = (m[2] || '').toUpperCase();
    if (u === 'K') n *= 1e3; else if (u === 'M') n *= 1e6; else if (u === 'B') n *= 1e9;
    return Math.round(n);
  };
  const seen = new Set(), rows = [];
  for (const a of document.querySelectorAll('a[href*="/video/"]')) {
    const href = a.getAttribute('href') || '';
    const m = /\/video\/(\d+)/.exec(href); if (!m || seen.has(m[1])) continue; seen.add(m[1]);
    let row = a;
    for (let i = 0; i < 8 && row; i++) { if (row.querySelector && row.querySelector('button')) break; row = row.parentElement; }
    const nums = [];
    if (row) for (const el of row.querySelectorAll('*')) {
      if (el.children.length === 0) { const t = (el.textContent || '').trim(); if (/^[\d.,]+\s*[KMB]?$/i.test(t) && t.length <= 8) nums.push(t); }
    }
    rows.push({ id: m[1], caption: (a.textContent || '').trim(), video_url: href.startsWith('http') ? href : location.origin + href, views: parseNum(nums[0]), likes: parseNum(nums[1]), comments: parseNum(nums[2]) });
  }
  return rows;
}

/** Click an engagement button (like / follow / favourite) belonging to the video in view. Never un-presses. */
function engageClick(arg) {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  const q = (root, list) => { for (const s of list) { let els = []; try { els = [...root.querySelectorAll(s)]; } catch (e) { continue; } const el = els.find(vis); if (el) return el; } return null; };
  let best = null, area = 0;
  for (const v of document.querySelectorAll('video')) { const r = v.getBoundingClientRect(); const a = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)); if (a > area) { area = a; best = v; } }
  let el = null, node = best && best.parentElement;
  for (let i = 0; node && i < 18 && !el; i++, node = node.parentElement) el = q(node, arg.selectors);
  if (!el) el = q(document, arg.selectors);
  if (!el) return { found: false };
  const btn = el.closest('button,[role="button"]') || el;
  const pressed = btn.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-pressed') === 'true' || /^(following|friends|mengikuti)$/i.test((btn.textContent || '').trim());
  if (pressed) return { found: true, already: true };
  btn.click();
  return { found: true, clicked: true };
}

// ------------------------------------------------------------------ Share → Send to (main account)

/** Click the Share button belonging to the video in view. */
function shareOpen(arg) {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  const q = (root, list) => { for (const s of list) { let els = []; try { els = [...root.querySelectorAll(s)]; } catch (e) { continue; } const el = els.find(vis); if (el) return el; } return null; };
  let best = null, area = 0;
  for (const v of document.querySelectorAll('video')) { const r = v.getBoundingClientRect(); const a = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)); if (a > area) { area = a; best = v; } }
  let el = null, node = best && best.parentElement;
  for (let i = 0; node && i < 18 && !el; i++, node = node.parentElement) el = q(node, arg.selectors);
  if (!el) el = q(document, arg.selectors);
  if (!el) return { found: false };
  (el.closest('button,[role="button"]') || el).click();
  return { found: true };
}

function shareRoots(arg) {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const roots = [];
  for (const s of arg.dialog) { try { roots.push(...[...document.querySelectorAll(s)].filter(vis)); } catch (e) { /* invalid */ } }
  return roots;
}

/** Read the share panel: is it open, does it say "sent", "can't send" or "no results"? */
function shareState(arg) {
  const roots = shareRoots(arg);
  const text = roots.map(r => r.innerText || '').join('\n');
  const low = text.toLowerCase();
  const has = list => list.find(t => low.includes(t.toLowerCase())) || null;
  const toast = [...document.querySelectorAll('[role="alert"],[role="status"],[class*="toast" i]')].map(e => e.innerText || '').join(' ').toLowerCase();
  return { open: roots.length > 0, blocked: has(arg.blocked) || arg.blocked.find(t => toast.includes(t.toLowerCase())) || null, notFound: has(arg.notFound),
    sent: has(arg.sent) || arg.sent.find(t => toast.includes(t.toLowerCase())) || null, text: text.slice(0, 600) };
}

/** Click a tab/button like "Send to" inside the share panel (if there is one). */
function shareClickText(arg) {
  for (const root of shareRoots(arg)) for (const b of root.querySelectorAll('button,[role="button"],[role="tab"],a,div,span')) {
    const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
    if (b.children.length <= 2 && arg.texts.some(x => t.toLowerCase() === x.toLowerCase())) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && !b.disabled && b.getAttribute('aria-disabled') !== 'true') { (b.closest('button,[role="button"],[role="tab"]') || b).click(); return t; }
    }
  }
  return null;
}

/** Find the recipient (@username) in the share panel and select them. */
function shareSelect(arg) {
  const u = arg.username.toLowerCase().replace(/^@/, '');
  for (const root of shareRoots(arg)) {
    const cands = [...root.querySelectorAll('*')].filter(el => {
      if (el.children.length > 3) return false;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return t === u || t === '@' + u || t.split(/[\s·|]+/).includes('@' + u) || t.split(/[\s·|]+/).includes(u);
    }).filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!cands.length) continue;
    const el = cands.sort((a, b) => a.textContent.length - b.textContent.length)[0];
    const row = el.closest('[role="option"],[role="checkbox"],[role="button"],li,label,button,[data-e2e*="user" i],[class*="item" i]') || el;
    const box = row.querySelector('input[type="checkbox"],[role="checkbox"]');
    const selected = () => row.getAttribute('aria-selected') === 'true' || row.getAttribute('aria-checked') === 'true' || (box && (box.checked || box.getAttribute('aria-checked') === 'true'));
    if (!selected()) (box || row).click();
    return { found: true, selected: !!selected() || true };
  }
  return { found: false };
}
