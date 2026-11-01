/* Zovo cards, kit v2.1 (sprint 1030).
 * 1. Rating card for the toolbar popup. One honest ask with two equal links, shown after a real
 *    success signal, never in the first 3 days, never after the user opened a support link,
 *    90 days quiet after "Not now". No gift, no offer, no network call.
 * 2. Share entry for the Settings page. A quiet link to the Share for Lifetime terms on the
 *    What's new page. It never mounts in the popup, so it never shares a view with the rating card.
 * State lives under one key, zovo_rate_card, in chrome.storage.local (or localStorage of the
 * extension origin when the item has no "storage" permission).
 * Load after zovo-whats-new/config.js. Mount with the attributes of this script tag.
 *   <script src="zovo-whats-new/zovo-cards.js" data-zovo-mount="popup"></script>
 *   <script src="zovo-whats-new/zovo-cards.js" data-zovo-mount="settings" data-zovo-anchor="#main"></script>
 * data-zovo-anchor is a CSS selector. The card goes at the END of that element (default body),
 * so no existing control moves. data-zovo-whats-new="off" leaves out the popup "What's new" link.
 * data-zovo-skip-if is a selector. If it matches (for example a membership card), no rating card shows.
 * Kit v2.1. Colors are --zc-* variables on an element inside the shadow root, the theme comes from the
 * first painted background behind the card (then body, then html, then the OS setting), and in a
 * fixed-height popup the card goes at the end of the scroll area, so existing content keeps its height. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.ZovoCards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var KEY = 'zovo_rate_card';
  var DAY_MS = 864e5;
  var QUIET_DAYS = 3;
  var SNOOZE_DAYS = 90;
  var MAX_SHOWS = 2;
  var MAX_COUNT = 1e7;
  var CAMPAIGN = 'whats-new-1030';
  var ID_RE = /^[a-p]{32}$/;
  var CHOICES = ['rate', 'tell'];
  /* Another card already at the bottom of the popup (membership note, older rating prompt). */
  var SKIP_DEFAULT = '.ztm-card, #zovo-rate-prompt, .zrp-card';
  var MOUNT_DELAY_MS = 400;

  var TEXT = Object.freeze({
    from: 'A note from Michael, the developer',
    ask: "If {name} has earned five stars from you, please give them. If it hasn't, tell me what's missing.",
    thanks: 'Thank you.',
    note: 'The second button opens a mail. I read every one.',
    rate: 'Rate it on the Chrome Web Store',
    tell: "Tell me what's missing",
    later: 'Not now',
    laterLabel: 'Not now. Hide this note.',
    whatsNew: "What's new in {version}",
    shareKicker: 'Zovo Share for Lifetime',
    shareTitle: 'Get Zovo Lifetime free for 5 public posts',
    shareText: 'Make 5 public posts about any Zovo extension on your own social accounts, at most 2 on one platform. Say what you really think. A critical post counts the same.',
    shareWhat: 'A Lifetime key turns on Pro in each Zovo extension that accepts Zovo keys.',
    shareHow: "Each post needs 'I get a free Zovo membership for sharing this' or #ad. Send me the links in Zovo Chat on Telegram or by mail. I'm Michael, the developer, and I check each one myself.",
    shareRule: "Store reviews and ratings don't count and never earn a gift.",
    shareLink: 'See the 3 steps and full terms',
    mailSubject: '{name} feedback'
  });

  /* ---------- small helpers ---------- */
  function toCount(v) {
    var n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(Math.floor(n), MAX_COUNT);
  }
  function toTime(v) {
    if (typeof v === 'string' && v && !/^\d+$/.test(v)) v = Date.parse(v);
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }
  function fill(s, map) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return map[k] != null ? String(map[k]) : m; });
  }
  function slugOf(cfg) {
    var s = cfg && typeof cfg.slug === 'string' && /^[a-z0-9-]{2,60}$/.test(cfg.slug) ? cfg.slug : '';
    if (s) return s;
    var n = cfg && typeof cfg.name === 'string' ? cfg.name : '';
    return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'zovo';
  }
  /* Adds the sprint utm tags to an http(s) link. Other links come back unchanged. */
  function tag(url, cfg, cta) {
    try {
      var u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return url;
      u.searchParams.set('utm_source', slugOf(cfg));
      u.searchParams.set('utm_medium', 'extension');
      u.searchParams.set('utm_campaign', CAMPAIGN);
      u.searchParams.set('utm_content', cta);
      return u.toString();
    } catch (e) { return url; }
  }
  function storeUrl(cfg, cta) {
    var id = cfg && ID_RE.test(cfg.id) ? cfg.id : null;
    return id ? tag('https://chromewebstore.google.com/detail/' + id + '/reviews', cfg, cta) : null;
  }
  function mailUrl(cfg, cta) {
    var name = cfg && cfg.name ? cfg.name : 'Zovo extension';
    var subject = fill(TEXT.mailSubject, { name: name }) + ' (' + slugOf(cfg) + ', ' + cta + ')';
    return 'mailto:support@zovo.one?subject=' + encodeURIComponent(subject);
  }

  /* Reads "a.b.c" from an object. A "#" segment counts an array or the keys of an object. */
  function readPath(obj, path) {
    if (typeof path !== 'string' || !path) return obj;
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      if (parts[i] === '#') {
        if (Array.isArray(cur)) cur = cur.length;
        else if (typeof cur === 'object') cur = Object.keys(cur).length;
        else return undefined;
      } else {
        cur = cur[parts[i]];
      }
    }
    return cur;
  }

  /* ---------- storage ---------- */
  /* Promise wrapper over chrome.storage.<area>, or localStorage of the extension origin. */
  function storageArea(area) {
    var c = root.chrome;
    var a = c && c.storage && c.storage[area === 'sync' ? 'sync' : 'local'];
    if (a) {
      return {
        kind: 'chrome',
        get: function (keys) {
          return new Promise(function (ok) {
            try { a.get(keys, function (r) { ok(c.runtime && c.runtime.lastError ? {} : (r || {})); }); } catch (e) { ok({}); }
          });
        },
        set: function (obj) {
          return new Promise(function (ok) {
            try { a.set(obj, function () { ok(!(c.runtime && c.runtime.lastError)); }); } catch (e) { ok(false); }
          });
        }
      };
    }
    var ls = null;
    try { ls = root.localStorage || null; } catch (e) { ls = null; }
    return {
      kind: ls ? 'localStorage' : 'none',
      get: function (keys) {
        var out = {};
        if (!ls) return Promise.resolve(out);
        [].concat(keys).forEach(function (k) {
          try { var v = ls.getItem(k); if (v != null) out[k] = JSON.parse(v); } catch (e) { /* ignore */ }
        });
        return Promise.resolve(out);
      },
      set: function (obj) {
        if (!ls) return Promise.resolve(false);
        try { Object.keys(obj).forEach(function (k) { ls.setItem(k, JSON.stringify(obj[k])); }); return Promise.resolve(true); } catch (e) { return Promise.resolve(false); }
      }
    };
  }

  function normalize(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    return {
      v: 1,
      firstSeenAt: toTime(s.firstSeenAt),
      opens: toCount(s.opens),
      shows: Math.min(toCount(s.shows), 10),
      lastShownAt: toTime(s.lastShownAt),
      dismissedAt: toTime(s.dismissedAt),
      supportAt: toTime(s.supportAt),
      choice: CHOICES.indexOf(s.choice) !== -1 ? s.choice : null,
      choiceAt: toTime(s.choiceAt)
    };
  }

  /* inputs = { installedAt, count, min }. Pure. Returns { show, reason }. */
  function decide(state, inputs, now) {
    if (!isFinite(now)) return { show: false, reason: 'bad-clock' };
    if (state.choice !== null) return { show: false, reason: 'chosen' };
    if (state.supportAt) return { show: false, reason: 'support-opened' };
    if (state.shows >= MAX_SHOWS) return { show: false, reason: 'max-shows' };
    var min = toCount(inputs.min);
    if (min < 1) return { show: false, reason: 'no-signal' };
    var anchor = Math.max(toTime(inputs.installedAt), 0) || state.firstSeenAt || now;
    if (anchor > now) return { show: false, reason: 'bad-clock' };
    if (now - anchor < QUIET_DAYS * DAY_MS) return { show: false, reason: 'quiet-days' };
    if (toCount(inputs.count) < min) return { show: false, reason: 'below-signal' };
    var last = Math.max(state.lastShownAt, state.dismissedAt);
    if (last) {
      if (last > now) return { show: false, reason: 'bad-clock' };
      if (now - last < SNOOZE_DAYS * DAY_MS) return { show: false, reason: 'snoozed' };
    }
    return { show: true, reason: 'eligible' };
  }

  function isFinal(state) {
    return state.choice !== null || state.supportAt > 0 || state.shows >= MAX_SHOWS;
  }

  function readState(store) {
    return store.get(KEY).then(function (d) { return normalize(d && d[KEY]); });
  }
  function writeState(store, state) {
    var o = {}; o[KEY] = state;
    return store.set(o).then(function () { return state; });
  }
  function change(store, fn, clock) {
    var now = clock ? clock() : Date.now();
    return readState(store).then(function (s) { fn(s, now); return writeState(store, s); });
  }

  /* Reads a number described by { area, key, path } from storage. */
  function readNumber(spec, getArea) {
    if (!spec || typeof spec.key !== 'string' || !spec.key) return Promise.resolve(null);
    var area = (getArea || storageArea)(spec.area);
    return area.get(spec.key).then(function (d) {
      var v = readPath(d && d[spec.key], spec.path);
      return v === undefined || v === null ? null : toCount(v);
    });
  }
  function readTime(spec, getArea) {
    if (!spec || typeof spec.key !== 'string' || !spec.key) return Promise.resolve(0);
    var area = (getArea || storageArea)(spec.area);
    return area.get(spec.key).then(function (d) { return toTime(readPath(d && d[spec.key], spec.path)); });
  }

  /* Every { area, key, path, equals } in the list must match. An empty list matches. */
  function requireAll(list, getArea) {
    if (!Array.isArray(list) || !list.length) return Promise.resolve(true);
    return Promise.all(list.slice(0, 5).map(function (r) {
      if (!r || typeof r.key !== 'string') return Promise.resolve(false);
      return (getArea || storageArea)(r.area).get(r.key).then(function (d) {
        return readPath(d && d[r.key], r.path) === r.equals;
      });
    })).then(function (all) { return all.every(Boolean); });
  }

  /* One popup open. Seeds firstSeenAt, counts the open, reads the signal, decides.
   * signal = { area, key, path, min, require?, line? } or { builtin: 'popupOpens', min, require?, line? }.
   * installedAt = { area, key, path } of a stored install time (ms or ISO), optional. */
  function evaluate(cfg, opts) {
    opts = opts || {};
    var store = opts.store || storageArea('local');
    var getArea = opts.getArea || storageArea;
    var now = opts.clock ? opts.clock() : Date.now();
    var signal = cfg && cfg.signal && typeof cfg.signal === 'object' ? cfg.signal : null;
    return readState(store).then(function (state) {
      if (isFinal(state)) return { show: false, reason: 'final', state: state };
      var dirty = false;
      if (!state.firstSeenAt) { state.firstSeenAt = now; dirty = true; }
      if (state.opens < 1000) { state.opens += 1; dirty = true; }
      var countP = !signal ? Promise.resolve(0)
        : signal.builtin === 'popupOpens' ? Promise.resolve(state.opens)
        : readNumber(signal, getArea);
      var reqP = signal ? requireAll(signal.require, getArea) : Promise.resolve(false);
      return Promise.all([countP, readTime(cfg && cfg.installedAt, getArea), reqP]).then(function (r) {
        var inputs = { count: r[2] ? (r[0] || 0) : 0, installedAt: r[1], min: signal ? signal.min : 0 };
        var verdict = decide(state, inputs, now);
        var out = { show: verdict.show, reason: verdict.reason, state: state, count: inputs.count };
        return (dirty ? writeState(store, state) : Promise.resolve()).then(function () { return out; });
      });
    });
  }

  function markShown(store, clock) {
    return change(store || storageArea('local'), function (s, now) { s.shows = Math.min(s.shows + 1, 10); s.lastShownAt = now; }, clock);
  }
  function dismiss(store, clock) {
    return change(store || storageArea('local'), function (s, now) { s.dismissedAt = now; }, clock);
  }
  function choose(store, choice, clock) {
    if (CHOICES.indexOf(choice) === -1) return Promise.reject(new Error('bad choice'));
    return change(store || storageArea('local'), function (s, now) {
      if (s.choice === null) { s.choice = choice; s.choiceAt = now; }
      if (choice === 'tell' && !s.supportAt) s.supportAt = now;
    }, clock);
  }
  function markSupport(store, clock) {
    return change(store || storageArea('local'), function (s, now) { if (!s.supportAt) s.supportAt = now; }, clock);
  }

  /* Any click on a support mail link in this document ends the rating card for good. */
  function trackSupportLinks(doc, store) {
    if (!doc || doc.__zovoSupportTracked) return;
    doc.__zovoSupportTracked = true;
    doc.addEventListener('click', function (ev) {
      var t = ev.target;
      var a = t && t.closest ? t.closest('a[href]') : null;
      if (!a) return;
      var href = String(a.getAttribute('href') || '').toLowerCase();
      if (href.indexOf('mailto:support@zovo.one') === 0 || /^https?:\/\/(www\.)?zovo\.one\/(support|contact)/.test(href)) {
        markSupport(store).catch(function () {});
      }
    }, true);
  }

  /* ---------- DOM ---------- */
  function cssUrl() {
    var c = root.chrome;
    try { if (c && c.runtime && c.runtime.getURL) return c.runtime.getURL('zovo-whats-new/zovo-cards.css'); } catch (e) { /* ignore */ }
    var s = root.document && root.document.querySelector('script[src*="zovo-cards.js"]');
    return s ? s.src.replace(/zovo-cards\.js(\?.*)?$/, 'zovo-cards.css') : 'zovo-cards.css';
  }
  function pageUrl(hash) {
    var c = root.chrome;
    var u = 'zovo-whats-new/index.html';
    try { if (c && c.runtime && c.runtime.getURL) u = c.runtime.getURL(u); } catch (e) { /* ignore */ }
    return u + (hash || '');
  }
  function el(doc, tagName, cls, text) {
    var n = doc.createElement(tagName);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  /* ---------- theme (kit v2.1) ---------- */
  /* Parses "rgb(a)" text. Returns [r, g, b, a] or null. */
  function parseRgb(s) {
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(s || '');
    if (!m) return null;
    var a = m[4] === undefined ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : Number(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }
  /* The color an element paints behind its content. The background color if it is not
   * transparent, else the first solid color of a background gradient. null = transparent. */
  function paintOf(cs) {
    if (!cs) return null;
    var c = parseRgb(cs.backgroundColor);
    if (c && c[3] >= 0.5) return c;
    var img = String(cs.backgroundImage || '');
    if (img && img !== 'none') {
      var re = /rgba?\([^)]*\)/g, t;
      while ((t = re.exec(img))) { c = parseRgb(t[0]); if (c && c[3] >= 0.5) return c; }
    }
    return null;
  }
  function luminance(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  /* Dark when the first painted background behind node is dark. The walk goes up from node
   * (the card's parent) to body, then html. With no painted background it uses the OS setting. */
  function themeAt(doc, node) {
    var gcs = root.getComputedStyle ? function (e) { try { return root.getComputedStyle(e); } catch (x) { return null; } } : function () { return null; };
    var chain = [];
    for (var n = node || doc.body; n && n.nodeType === 1 && n !== doc.documentElement; n = n.parentElement) chain.push(n);
    if (doc.body && chain.indexOf(doc.body) === -1) chain.push(doc.body);
    if (doc.documentElement) chain.push(doc.documentElement);
    for (var i = 0; i < chain.length; i++) {
      var c = paintOf(gcs(chain[i]));
      if (c) return luminance(c) < 0.45 ? 'dark' : 'light';
    }
    return root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function isDark(doc, node) { return themeAt(doc, node) === 'dark'; }

  /* ---------- placement (kit v2.1) ---------- */
  /* The host gets inline !important styles. Popup CSS that matches the host (a div) cannot
   * give it a size, a flex grow or shrink, a margin or colors. */
  function hostStyle(host, display) {
    var st = host.style;
    try { st.setProperty('all', 'initial', 'important'); } catch (e) { /* ignore */ }
    st.setProperty('display', display, 'important');
    st.setProperty('flex', 'none', 'important');
    st.setProperty('position', 'static', 'important');
    if (display !== 'none') st.setProperty('visibility', 'hidden', 'important');
  }
  var KIT_HOSTS = { 'zovo-rate-card': 1, 'zovo-whats-new-link': 1, 'zovo-share-entry': 1 };
  var MAX_NODES = 600;
  var POPUP_MAX_H = 600;
  function isKitHost(e) { return !!(e && e.id && KIT_HOSTS[e.id]); }
  function ownElements(anchor) {
    var all = anchor.getElementsByTagName ? anchor.getElementsByTagName('*') : [];
    var out = [anchor];
    for (var i = 0; i < all.length && out.length < MAX_NODES; i++) {
      var e = all[i];
      if (isKitHost(e) || (e.closest && e.closest('#zovo-rate-card, #zovo-whats-new-link, #zovo-share-entry'))) continue;
      out.push(e);
    }
    return out;
  }
  function heightOf(e) {
    try { return e.getBoundingClientRect().height; } catch (x) { return 0; }
  }
  /* Scroll areas inside the anchor, biggest first. In a fixed-height popup the card goes there. */
  function scrollAreas(anchor, els) {
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e === anchor) continue;
      var cs = null;
      try { cs = root.getComputedStyle(e); } catch (x) { cs = null; }
      if (!cs || !/^(auto|scroll|overlay)$/.test(cs.overflowY)) continue;
      var r = e.getBoundingClientRect();
      if (r.height < 60 || r.width < 120) continue;
      out.push({ el: e, area: r.width * r.height });
    }
    out.sort(function (a, b) { return b.area - a.area; });
    return out.slice(0, 3).map(function (x) { return x.el; });
  }
  /* False when an ancestor with hidden overflow cuts the host off. Inside a scroll area the
   * host can be scrolled to, so from there on the scroll area itself must be in view. */
  function reachable(doc, host) {
    var target = host;
    for (var a = host.parentElement; a; a = a.parentElement) {
      var cs = null;
      try { cs = root.getComputedStyle(a); } catch (x) { cs = null; }
      if (!cs) continue;
      if (/^(auto|scroll|overlay)$/.test(cs.overflowY)) { target = a; continue; }
      if (/^(hidden|clip)$/.test(cs.overflowY)) {
        var t = target.getBoundingClientRect();
        var r = a.getBoundingClientRect();
        if (t.top < r.top - 1 || t.bottom > r.bottom + 1) return false;
      }
    }
    // The page itself cannot scroll when html, or body with a visible html, hides overflow.
    // Then nothing below the popup height (600 px at most) can be seen.
    var hs = null, bs = null;
    try { hs = root.getComputedStyle(doc.documentElement); bs = doc.body ? root.getComputedStyle(doc.body) : null; } catch (x) { /* ignore */ }
    var hidden = function (cs) { return !!(cs && /^(hidden|clip)$/.test(cs.overflowY)); };
    if (hidden(hs) || (hs && hs.overflowY === 'visible' && hidden(bs))) {
      var limit = Math.max(Number(root.innerHeight) || 0, POPUP_MAX_H);
      if (target.getBoundingClientRect().bottom > limit + 1) return false;
    }
    return true;
  }
  /* Puts the host where it takes no height from existing content. First the end of the anchor,
   * then the end of the biggest scroll area. Returns the parent it stays in, or null (no room,
   * the host is removed). The host must be in the anchor with display none when this runs. */
  function place(doc, host, anchor) {
    var els = ownElements(anchor);
    var before = els.map(heightOf);
    var spots = [anchor].concat(scrollAreas(anchor, els));
    hostStyle(host, 'block');
    for (var i = 0; i < spots.length; i++) {
      if (host.parentNode !== spots[i]) spots[i].appendChild(host);
      var squeezed = false;
      for (var j = 0; j < els.length && !squeezed; j++) {
        if (els[j] === spots[i]) continue;
        if (before[j] - heightOf(els[j]) > 1) squeezed = true;
      }
      if (!squeezed && reachable(doc, host)) return spots[i];
    }
    host.remove();
    return null;
  }

  /* A shadow host at the END of the anchor. Returns { host, box, ready } or null.
   * ready resolves true once the host is placed and visible, false when there was no room. */
  function shell(doc, anchorSel, id) {
    if (doc.getElementById(id)) return null;
    var anchor = (anchorSel && doc.querySelector(anchorSel)) || doc.body;
    if (!anchor) return null;
    var host = el(doc, 'div');
    host.id = id;
    hostStyle(host, 'none');
    var sh = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var link = el(doc, 'link');
    link.rel = 'stylesheet';
    link.href = cssUrl();
    var box = el(doc, 'div', 'zc');
    box.setAttribute('data-zc-theme', themeAt(doc, anchor));
    var done = false;
    var ready = new Promise(function (ok) {
      var show = function () {
        if (done) return;
        done = true;
        if (!host.isConnected) { ok(false); return; }
        var spot = place(doc, host, anchor);
        if (!spot) { ok(false); return; }
        box.setAttribute('data-zc-theme', themeAt(doc, spot));
        host.style.setProperty('visibility', 'visible', 'important');
        ok(true);
      };
      link.addEventListener('load', show, { once: true });
      link.addEventListener('error', show, { once: true });
      setTimeout(show, 3000);
    });
    sh.appendChild(link);
    sh.appendChild(box);
    anchor.appendChild(host);
    return { host: host, box: box, ready: ready };
  }
  function openLink(a, href) {
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  function buildRating(doc, cfg, count, store) {
    var s = shell(doc, cfg.__anchor, 'zovo-rate-card');
    if (!s) return null;
    var box = s.box;
    box.classList.add('zc-rate');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', TEXT.from);
    var head = el(doc, 'div', 'zc-head');
    head.appendChild(el(doc, 'p', 'zc-from', TEXT.from));
    var later = el(doc, 'button', 'zc-later', TEXT.later);
    later.type = 'button';
    later.setAttribute('aria-label', TEXT.laterLabel);
    head.appendChild(later);
    box.appendChild(head);
    var sig = cfg.signal && typeof cfg.signal.line === 'string' ? cfg.signal.line : '';
    if (sig && count > 0) box.appendChild(el(doc, 'p', 'zc-signal', fill(sig, { n: count.toLocaleString('en-US') }) + ' ' + TEXT.thanks));
    box.appendChild(el(doc, 'p', 'zc-ask', fill(TEXT.ask, { name: cfg.name || 'this extension' })));
    var pair = el(doc, 'div', 'zc-pair');
    var rate = openLink(el(doc, 'a', 'zc-btn', TEXT.rate), storeUrl(cfg, 'rate-card-rate'));
    var tell = openLink(el(doc, 'a', 'zc-btn', TEXT.tell), mailUrl(cfg, 'rate-card-tell'));
    pair.appendChild(rate);
    pair.appendChild(tell);
    box.appendChild(pair);
    box.appendChild(el(doc, 'p', 'zc-note', TEXT.note));
    var close = function () { s.host.remove(); };
    rate.addEventListener('click', function () { choose(store, 'rate').catch(function () {}); setTimeout(close, 0); });
    tell.addEventListener('click', function () { choose(store, 'tell').catch(function () {}); setTimeout(close, 0); });
    later.addEventListener('click', function () { dismiss(store).catch(function () {}); close(); });
    return s;
  }

  function buildWhatsNewLink(doc, cfg) {
    var s = shell(doc, cfg.__anchor, 'zovo-whats-new-link');
    if (!s) return null;
    var v = cfg.version || '';
    try { v = root.chrome.runtime.getManifest().version || v; } catch (e) { /* ignore */ }
    var a = openLink(el(doc, 'a', 'zc-wn', fill(TEXT.whatsNew, { version: v })), pageUrl(''));
    s.box.classList.add('zc-wn-row');
    s.box.appendChild(a);
    return s.host;
  }

  function buildShareEntry(doc, cfg) {
    var s = shell(doc, cfg.__anchor, 'zovo-share-entry');
    if (!s) return null;
    var box = s.box;
    box.classList.add('zc-share');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', TEXT.shareKicker);
    box.appendChild(el(doc, 'p', 'zc-kicker', TEXT.shareKicker));
    box.appendChild(el(doc, 'p', 'zc-title', TEXT.shareTitle));
    box.appendChild(el(doc, 'p', 'zc-text', TEXT.shareWhat));
    box.appendChild(el(doc, 'p', 'zc-text', TEXT.shareText));
    box.appendChild(el(doc, 'p', 'zc-text', TEXT.shareHow));
    box.appendChild(el(doc, 'p', 'zc-text zc-muted', TEXT.shareRule));
    box.appendChild(openLink(el(doc, 'a', 'zc-btn zc-btn-quiet', TEXT.shareLink), pageUrl('#share')));
    return s.host;
  }

  function mountPopup(cfg, opts) {
    opts = opts || {};
    var doc = opts.document || root.document;
    var store = opts.store || storageArea('local');
    var c = Object.assign({}, cfg, { __anchor: opts.anchor || null });
    var skip = typeof opts.skipIf === 'string' ? opts.skipIf : SKIP_DEFAULT;
    var wait = typeof opts.delay === 'number' ? opts.delay : MOUNT_DELAY_MS;
    trackSupportLinks(doc, store);
    return evaluate(c, opts).then(function (r) {
      // Wait a moment, so a card that the popup adds by itself is already there.
      return new Promise(function (ok) { setTimeout(ok, wait); }).then(function () { return r; });
    }).then(function (r) {
      var taken = false;
      try { taken = !!(skip && doc.querySelector(skip)); } catch (e) { taken = false; }
      if (taken && r.show) { r.show = false; r.reason = 'slot-taken'; }
      // The card first, then the link, both at the end of the anchor.
      var card = r.show && storeUrl(c, 'x') ? buildRating(doc, c, r.count, store) : null;
      if (opts.whatsNew !== false) buildWhatsNewLink(doc, c);
      if (!card) return r;
      // Count the show only when the card is on screen. No room in the popup means no show.
      return card.ready.then(function (shown) {
        if (!shown) { r.show = false; r.reason = 'no-room'; return r; }
        return markShown(store, opts.clock).then(function () { return r; });
      });
    });
  }

  function mountSettings(cfg, opts) {
    opts = opts || {};
    var doc = opts.document || root.document;
    trackSupportLinks(doc, opts.store || storageArea('local'));
    return Promise.resolve(buildShareEntry(doc, Object.assign({}, cfg, { __anchor: opts.anchor || null })));
  }

  /* Auto mount from the script tag. */
  (function auto() {
    var doc = root.document;
    if (!doc || !doc.currentScript) return;
    var ds = doc.currentScript.dataset || {};
    var mode = ds.zovoMount;
    if (mode !== 'popup' && mode !== 'settings') return;
    var run = function () {
      var cfg = root.ZOVO_WHATS_NEW && typeof root.ZOVO_WHATS_NEW === 'object' ? root.ZOVO_WHATS_NEW : null;
      if (!cfg) return;
      var o = { anchor: ds.zovoAnchor || null, whatsNew: ds.zovoWhatsNew !== 'off' };
      if (typeof ds.zovoSkipIf === 'string') o.skipIf = ds.zovoSkipIf;
      var p = mode === 'popup' ? mountPopup(cfg, o) : mountSettings(cfg, o);
      p.catch(function (e) { try { console.warn('[ZovoCards]', e && e.message ? e.message : e); } catch (x) { /* ignore */ } });
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  })();

  return Object.freeze({
    KEY: KEY, DAY_MS: DAY_MS, QUIET_DAYS: QUIET_DAYS, SNOOZE_DAYS: SNOOZE_DAYS, MAX_SHOWS: MAX_SHOWS,
    CAMPAIGN: CAMPAIGN, TEXT: TEXT,
    toCount: toCount, toTime: toTime, fill: fill, slugOf: slugOf, tag: tag, storeUrl: storeUrl, mailUrl: mailUrl,
    SKIP_DEFAULT: SKIP_DEFAULT, readPath: readPath, storageArea: storageArea, requireAll: requireAll, normalize: normalize, decide: decide, isFinal: isFinal,
    readState: readState, readNumber: readNumber, readTime: readTime, evaluate: evaluate,
    markShown: markShown, dismiss: dismiss, choose: choose, markSupport: markSupport,
    trackSupportLinks: trackSupportLinks, mountPopup: mountPopup, mountSettings: mountSettings,
    parseRgb: parseRgb, paintOf: paintOf, themeAt: themeAt, isDark: isDark, place: place, shell: shell
  });
});
