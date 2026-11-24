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
  let idMatch = url && url.match(/\/video\/(\d+)/);
  // The For You feed often has no /video/ link: TikTok's player wrapper carries the id in its element id
  // (e.g. "xgwrapper-0-7300000000000000000") or a data attribute. Build the link from author + id.
  if (!idMatch) {
    for (let n = best, i = 0; n && i < 14 && !idMatch; n = n.parentElement, i++) {
      const attrs = [n.id || '', ...Array.from(n.attributes || []).filter(a => /^data-/.test(a.name)).map(a => a.value)];
      for (const a of attrs) { const m = String(a).match(/(?:^|\D)(\d{17,21})(?:\D|$)/); if (m) { idMatch = [null, m[1]]; break; } }
    }
    if (idMatch && author) url = location.origin + '/@' + author + '/video/' + idMatch[1];
  }
  let key = idMatch ? idMatch[1] : null;
  if (!key) {
    // Stable fallback identity: creator + caption (not the player's stream address, which changes).
    let h = 0; const s = author + '|' + desc;
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

// ------------------------------------------------------------------ Share (main account)
// Real TikTok (2026): the share icon is an svg with no text/data-e2e; the panel is
// <div class="TUXModal" role="dialog"> titled "Share to"; each recipient is <div data-e2e="share-<username>">
// with a div[tabindex="0"] inside; other entries are share-copy ("Copy"), share-repost, share-whatsapp, ...

/** Nearest element that can really be clicked (svg/path icons → their button / tabindex / role parent). */
function clickableOf(el) {
  let n = el;
  for (let i = 0; n && i < 8; i++, n = n.parentElement) {
    if (n.matches && n.matches('button,a[href],[role="button"],[tabindex]:not([tabindex="-1"]),[onclick]')) return n;
    if (n instanceof HTMLElement && !(n instanceof SVGElement) && getComputedStyle(n).cursor === 'pointer') return n;
  }
  return el.closest && el.closest('div,span') || el;
}

/** Click the Share button belonging to the video in view (or the first visible one). */
function shareOpen(arg) {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  const q = (root, list) => { for (const s of list) { let els = []; try { els = [...root.querySelectorAll(s)]; } catch (e) { continue; } const el = els.find(vis); if (el) return el; } return null; };
  let best = null, area = 0;
  for (const v of document.querySelectorAll('video')) { const r = v.getBoundingClientRect(); const a = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)); if (a > area) { area = a; best = v; } }
  let el = null, node = best && best.parentElement;
  for (let i = 0; node && i < 18 && !el; i++, node = node.parentElement) el = q(node, arg.selectors);
  if (!el) el = q(document, arg.selectors);
  if (!el) return { found: false };
  const target = clickableOf(el);
  target.click();
  return { found: true, clicked: target.tagName.toLowerCase() + (target.className && typeof target.className === 'string' ? '.' + target.className.split(' ')[0] : '') };
}

function shareRoots(arg) {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const roots = [];
  for (const s of arg.dialog) { try { roots.push(...[...document.querySelectorAll(s)].filter(vis)); } catch (e) { /* invalid */ } }
  return roots.filter((r, i) => !roots.some((o, j) => j !== i && o.contains(r) && o !== r));
}

/** Panel state: open? "sent"? "can't send"? "no results"? a Send button showing? */
function shareState(arg) {
  const roots = shareRoots(arg);
  const text = roots.map(r => r.innerText || '').join('\n');
  const low = text.toLowerCase();
  const has = (list, hay) => (list || []).find(t => hay.includes(t.toLowerCase())) || null;
  const toasts = [...document.querySelectorAll('[role="alert"],[role="status"],[class*="toast" i],[class*="Toast" i],[class*="snackbar" i]')]
    .filter(e => e.getBoundingClientRect().height > 0).map(e => e.innerText || '').join(' ').toLowerCase();
  let sendButton = false;
  for (const r of roots) for (const b of r.querySelectorAll('button,[role="button"]')) {
    const t = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if ((arg.send || []).some(x => x.toLowerCase() === t) && b.getBoundingClientRect().height > 0 && !b.disabled) sendButton = true;
  }
  let recipientSent = false;
  if (arg.user) for (const r of roots) for (const s of arg.recipient || []) {
    let el = null; try { el = r.querySelector(s.replace(/\{user\}/g, arg.user)); } catch (e) { /* invalid */ }
    if (el && has(arg.sent, (el.innerText || '').toLowerCase())) recipientSent = true;
  }
  return { open: roots.length > 0, blocked: has(arg.blocked, low) || has(arg.blocked, toasts), notFound: has(arg.notFound, low),
    sent: has(arg.sent, toasts) || (recipientSent ? 'shown on the recipient' : null) || (low.split('\n').some(l => (arg.sent || []).some(t => l.trim().toLowerCase() === t.toLowerCase())) ? 'in panel' : null),
    sendButton, text: text.slice(0, 1500), toast: toasts.slice(0, 300) };
}

/** Click a button-like element with exactly one of `texts` inside the panel. */
function shareClickText(arg) {
  // Real buttons first, so a wrapper div whose text is also "Send" is never clicked instead of the button.
  for (const kinds of ['button,[role="button"],[role="tab"],a,[tabindex="0"]', 'div,span,p']) {
    for (const root of shareRoots(arg)) for (const b of root.querySelectorAll(kinds)) {
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (b.children.length <= 3 && arg.texts.some(x => t.toLowerCase() === x.toLowerCase())) {
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && !b.disabled && b.getAttribute('aria-disabled') !== 'true') { clickableOf(b).click(); return t; }
      }
    }
  }
  return null;
}

/** Click the first visible element (inside the panel) matching a selector list. */
function shareClickSel(arg) {
  for (const root of shareRoots(arg)) for (const s of arg.selectors) {
    let el = null; try { el = [...root.querySelectorAll(s)].find(e => e.getBoundingClientRect().height > 0); } catch (e) { continue; }
    if (el) { const target = el.querySelector('[tabindex="0"],button,[role="button"]') || clickableOf(el); target.click(); return s; }
  }
  return null;
}

/** Find the recipient: data-e2e="share-<username>" first, then visible text / avatar alt. Clicks it. */
function shareSelect(arg) {
  const u = arg.username.toLowerCase().replace(/^@/, '');
  for (const root of shareRoots(arg)) {
    for (const s of arg.recipient || []) {
      let el = null; try { el = [...root.querySelectorAll(s.replace(/\{user\}/g, u))].find(e => e.getBoundingClientRect().height > 0); } catch (e) { continue; }
      if (el) { (el.querySelector('[tabindex="0"]') || el.querySelector('button,[role="button"]') || clickableOf(el)).click(); return { found: true, how: `matched ${s.replace(/\{user\}/g, u)}` }; }
    }
    const cands = [...root.querySelectorAll('p,span,div,img')].filter(el => {
      if (el.tagName === 'IMG') return (el.getAttribute('alt') || '').toLowerCase() === u;
      if (el.children.length > 2) return false;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return t === u || t === '@' + u;
    }).filter(el => el.getBoundingClientRect().height > 0);
    if (cands.length) {
      const el = cands[0];
      const row = el.closest('[data-e2e^="share-"]') || el.closest('[role="option"],[role="checkbox"],li,label') || el;
      (row.querySelector('[tabindex="0"]') || clickableOf(row)).click();
      return { found: true, how: 'matched by name' };
    }
  }
  return { found: false };
}

/** Remember what the page copies (TikTok's "Copy"), then click the copy entry. */
function shareCopyLink(arg) {
  if (!window.__ttaCopyHooked) {
    window.__ttaCopyHooked = true;
    try {
      const orig = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;
      if (navigator.clipboard) navigator.clipboard.writeText = t => { window.__ttaCopied = String(t); return orig ? orig(t).catch(() => {}) : Promise.resolve(); };
    } catch (e) { /* read-only */ }
    document.addEventListener('copy', () => { const s = String(document.getSelection() || ''); if (s) window.__ttaCopied = s; }, true);
  }
  if (arg.read) return window.__ttaCopied || null;
  window.__ttaCopied = null;
  return shareClickSel({ dialog: arg.dialog, selectors: arg.copy || [] }) || shareClickText({ dialog: arg.dialog, texts: arg.texts });
}

// ------------------------------------------------------------------ Messages (private chats)

/** Conversations in the left list: name, username (if a profile link is inside), unread flag. */
function msgList(sel) {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let items = [];
  for (const s of sel.msgConversation) { try { items = [...document.querySelectorAll(s)].filter(vis); } catch (e) { items = []; } if (items.length) break; }
  const q = (root, list) => { for (const s of list) { try { const el = root.querySelector(s); if (el && (el.textContent || '').trim()) return el; } catch (e) { /* invalid */ } } return null; };
  const has = (root, list) => list.some(s => { try { return [...root.querySelectorAll(s)].some(vis); } catch (e) { return false; } });
  return items.map((el, index) => {
    const link = el.querySelector('a[href*="/@"]');
    const username = link ? (link.getAttribute('href').match(/@([^/?#]+)/) || [])[1] || null : (el.getAttribute('data-username') || null);
    const nameEl = q(el, sel.msgConversationName);
    return { index, username, name: ((nameEl || el).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80), unread: has(el, sel.msgUnread) };
  });
}

/** Click conversation number `arg.index` in the list. */
function msgOpen(arg) {
  let items = [];
  for (const s of arg.sel.msgConversation) { try { items = [...document.querySelectorAll(s)].filter(e => e.getBoundingClientRect().height > 0); } catch (e) { items = []; } if (items.length) break; }
  const el = items[arg.index];
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  el.click();
  return true;
}

/** The open chat: who it is with and its messages (mine / theirs), oldest first. */
function msgChat(sel) {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let header = null;
  for (const s of sel.msgHeaderLink) { try { header = [...document.querySelectorAll(s)].find(vis); } catch (e) { header = null; } if (header) break; }
  const href = header && (header.getAttribute('href') || '');
  const username = href ? ((href.match(/@([^/?#]+)/) || [])[1] || null) : header ? (header.textContent || '').replace(/^@/, '').trim() : null;
  let items = [];
  for (const s of sel.msgItem) { try { items = [...document.querySelectorAll(s)].filter(vis); } catch (e) { items = []; } if (items.length) break; }
  const isMine = el => sel.msgMine.some(s => { try { return el.matches(s) || !!el.querySelector(s) || !!el.closest(s); } catch (e) { return false; } });
  const textOf = el => { for (const s of sel.msgText) { try { const t = el.querySelector(s); if (t && t.textContent.trim()) return t.textContent.replace(/\s+/g, ' ').trim(); } catch (e) { /* invalid */ } } return (el.textContent || '').replace(/\s+/g, ' ').trim(); };
  return { username, messages: items.map(el => ({ mine: isMine(el), text: textOf(el).slice(0, 2000) })).filter(m => m.text) };
}
