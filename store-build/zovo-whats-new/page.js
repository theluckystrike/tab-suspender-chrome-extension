'use strict';
// Zovo what's new page, kit v2 (sprint 1030). Fills the page from config.js and this browser's
// own storage. No network request. Links open only on click.
// config.js (globalThis.ZOVO_WHATS_NEW) fields, all optional except name and id:
//   name, id, slug, version, date (YYYY-MM-DD), icon,
//   changes   [{ type: 'fixed'|'new'|'improved', text }]   3 to 5 real changes from the diff
//   stats     [{ area, key, path, label }]                  measured numbers in chrome.storage
//   tips      [text, text, text]                            shown when there are no numbers
//   plan      { area, key, path, pro: [...], free: [...], lapsed: [...] }  prices only on "free"
//   shareInvite  Zovo Chat invite link for this surface (ext:share-1030)
//   signal, installedAt  used by zovo-cards.js in the popup
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else if (root.document) api.run();
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const ID_RE = /^[a-p]{32}$/;
  const ICON_RE = /^[A-Za-z0-9._-]+$/;
  const SHARE_INVITE_FALLBACK = 'https://t.me/+0gptvkTOUL1hODM8';
  const MAX_STAT = 1e7;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const TAGS = { fixed: 'Fixed', new: 'New', improved: 'Improved' };
  const TEXT = Object.freeze({
    title: "What's new in {name}",
    optSaved: "Saved. This page won't open by itself again.",
    optUndone: 'Saved. The page can open again after a future update, at most once in 30 days.',
    tipsTitle: 'Three things worth trying',
    statsTitle: 'In this browser so far'
  });
  // Sample data, used only in preview mode (file:// or http://localhost), never in the extension.
  const PREVIEW = Object.freeze({
    stats: [1284, 37, 12],
    states: ['free', 'pro', 'lapsed', 'fresh']
  });

  const fill = (s, map) => String(s).replace(/\{(\w+)\}/g, (m, k) => (map[k] != null ? String(map[k]) : m));

  function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === 'string' ? iso : '');
    if (!m) return '';
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return `${d} ${MONTHS[mo - 1]} ${m[1]}`;
  }

  function cleanChanges(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((c) => c && TAGS[c.type] && typeof c.text === 'string' && c.text.trim().length >= 8 && c.text.length <= 220)
      .slice(0, 5)
      .map((c) => ({ type: c.type, label: TAGS[c.type], text: c.text.trim() }));
  }

  function cleanTips(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((t) => typeof t === 'string' && t.trim().length >= 8 && t.length <= 240).slice(0, 3).map((t) => t.trim());
  }

  // A stat is shown only when it is a whole number from 1 to 10,000,000.
  function statValue(v) {
    const n = typeof v === 'number' ? v : NaN;
    if (!Number.isFinite(n) || n < 1 || n > MAX_STAT) return null;
    return Math.floor(n);
  }

  // Plan state from storage. Anything that is not a confirmed match is "unknown", and unknown shows no price.
  function planState(value, plan) {
    if (!plan || value === undefined) return 'unknown';
    const has = (list) => Array.isArray(list) && list.some((x) => x === value);
    if (has(plan.pro)) return 'pro';
    if (has(plan.lapsed)) return 'lapsed';
    if (has(plan.free)) return 'free';
    return 'unknown';
  }

  function slugOf(cfg) {
    if (typeof cfg.slug === 'string' && /^[a-z0-9-]{2,60}$/.test(cfg.slug)) return cfg.slug;
    const n = typeof cfg.name === 'string' ? cfg.name : '';
    return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'zovo';
  }

  function tagUrl(href, cfg, cta) {
    try {
      const u = new URL(href);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return href;
      u.searchParams.set('utm_source', slugOf(cfg));
      u.searchParams.set('utm_medium', 'extension');
      u.searchParams.set('utm_campaign', 'whats-new-1030');
      u.searchParams.set('utm_content', cta);
      return u.toString();
    } catch (_) {
      return href;
    }
  }

  function mailTo(cfg, what, cta) {
    const subject = `${cfg.name || 'Zovo extension'} ${what} (${slugOf(cfg)}, ${cta})`;
    return `mailto:support@zovo.one?subject=${encodeURIComponent(subject)}`;
  }

  // Height of the break, so the review card and the share card never share one viewport.
  function breakHeight(reviewBottom, shareTop, currentBreak, viewport) {
    const gapWithout = shareTop - reviewBottom - currentBreak;
    return Math.max(32, Math.ceil(viewport + 32 - gapWithout));
  }

  function run() {
    const doc = root.document;
    const $ = (id) => doc.getElementById(id);
    const raw = root.ZOVO_WHATS_NEW;
    const cfg = raw && typeof raw === 'object' ? raw : {};
    const chromeApi = root.chrome;
    const isExt = root.location && root.location.protocol === 'chrome-extension:';
    const preview = !isExt;
    const query = new URLSearchParams(root.location ? root.location.search : '');
    const previewState = preview && PREVIEW.states.includes(query.get('state')) ? query.get('state') : 'free';
    const local = isExt && chromeApi && chromeApi.storage && chromeApi.storage.local ? chromeApi.storage.local : null;
    const area = (name) => (isExt && chromeApi && chromeApi.storage ? chromeApi.storage[name === 'sync' ? 'sync' : 'local'] : null);
    const get = (name, key) => new Promise((ok) => {
      const a = area(name);
      if (!a) { ok(undefined); return; }
      try { a.get(key, (r) => ok(chromeApi.runtime.lastError || !r ? undefined : r[key])); } catch (_) { ok(undefined); }
    });
    const readPath = (obj, path) => (root.ZovoCards ? root.ZovoCards.readPath(obj, path) : undefined);

    // 1. Header.
    const name = typeof cfg.name === 'string' && cfg.name.trim() ? cfg.name.trim() : '';
    if (name) {
      doc.querySelectorAll('.js-name').forEach((n) => { n.textContent = name; });
      doc.title = fill(TEXT.title, { name });
    }
    let version = typeof cfg.version === 'string' ? cfg.version : '';
    try {
      const live = chromeApi.runtime.getManifest().version;
      if (typeof live === 'string' && live) version = live;
    } catch (_) { /* preview */ }
    if (version) doc.querySelectorAll('.js-version').forEach((n) => { n.textContent = version; });
    else $('version-pill').hidden = true;
    const icon = $('app-icon');
    if (typeof cfg.icon === 'string' && ICON_RE.test(cfg.icon)) {
      icon.addEventListener('error', () => { icon.hidden = true; }, { once: true });
      icon.src = cfg.icon;
      icon.hidden = false;
    }

    // 2. What changed.
    const date = formatDate(cfg.date);
    if (date) doc.querySelectorAll('.js-date').forEach((n) => { n.textContent = date; });
    else doc.querySelectorAll('.js-date-part').forEach((n) => { n.remove(); });
    const changes = cleanChanges(cfg.changes);
    const list = $('change-list');
    if (changes.length) {
      changes.forEach((c) => {
        const li = doc.createElement('li');
        const t = doc.createElement('span');
        t.className = `tag tag-${c.type}`;
        t.textContent = c.label;
        const s = doc.createElement('span');
        s.textContent = c.text;
        li.append(t, s);
        list.append(li);
      });
    } else {
      list.remove();
    }

    // 4. Review card. Both links have the same weight. Without a valid id the card is not shown.
    const hasId = typeof cfg.id === 'string' && ID_RE.test(cfg.id);
    const rate = $('rate-link');
    const tell = $('tell-link');
    if (hasId) rate.href = tagUrl(`https://chromewebstore.google.com/detail/${cfg.id}/reviews`, cfg, 'rate');
    else $('review').hidden = true;
    tell.href = mailTo(cfg, "what's missing", 'tell');
    const cards = root.ZovoCards;
    const store = cards ? cards.storageArea('local') : null;
    if (cards && isExt) {
      rate.addEventListener('click', () => { cards.choose(store, 'rate').catch(() => {}); });
      tell.addEventListener('click', () => { cards.choose(store, 'tell').catch(() => {}); });
      cards.trackSupportLinks(doc, store);
    }
    doc.querySelectorAll('a[data-cta^="support"]').forEach((a) => { a.href = mailTo(cfg, 'support', a.dataset.cta); });
    doc.querySelectorAll('a[data-cta="share-mail"]').forEach((a) => { a.href = mailTo(cfg, 'share links', 'share-mail'); });
    // A mail link hands off to the mail app. A new tab for it would stay empty.
    doc.querySelectorAll('a[href^="mailto:"]').forEach((a) => { a.removeAttribute('target'); });

    // 6. Share card link. The named invite for this surface, else the What's new invite.
    const invite = typeof cfg.shareInvite === 'string' && /^https:\/\/t\.me\/\+[A-Za-z0-9_-]{6,}$/.test(cfg.shareInvite)
      ? cfg.shareInvite : SHARE_INVITE_FALLBACK;
    $('share-chat').href = tagUrl(invite, cfg, 'share-chat');

    // utm tags on every other http(s) link.
    doc.querySelectorAll('a[href^="http"][data-cta]').forEach((a) => {
      if (a.id !== 'rate-link' && a.id !== 'share-chat') a.href = tagUrl(a.href, cfg, a.dataset.cta);
    });

    // Preview bar.
    if (preview) $('preview-bar').hidden = false;

    // 5. Value block and plan state. Both read only this browser's storage.
    const statsSpec = Array.isArray(cfg.stats) ? cfg.stats.filter((s) => s && typeof s.key === 'string' && typeof s.label === 'string').slice(0, 3) : [];
    const statsP = preview
      ? Promise.resolve(previewState === 'fresh' ? [] : statsSpec.map((s, i) => ({ n: PREVIEW.stats[i % PREVIEW.stats.length], label: s.label })))
      : Promise.all(statsSpec.map((s) => get(s.area, s.key).then((v) => ({ n: statValue(readPath(v, s.path)), label: s.label }))));
    const planP = preview
      ? Promise.resolve(previewState === 'fresh' ? 'free' : previewState)
      : (cfg.plan && typeof cfg.plan.key === 'string' ? get(cfg.plan.area, cfg.plan.key).then((v) => planState(readPath(v, cfg.plan.path), cfg.plan)) : Promise.resolve('unknown'));

    const layoutBreak = () => {
      const review = $('review');
      const share = $('share');
      const br = $('break');
      if (review.hidden || share.hidden) { br.style.height = ''; return; }
      const rb = review.getBoundingClientRect().bottom;
      const st = share.getBoundingClientRect().top;
      const cur = br.getBoundingClientRect().height;
      br.style.height = `${breakHeight(rb, st, cur, root.innerHeight || 900)}px`;
    };

    Promise.all([statsP, planP]).then(([stats, plan]) => {
      const shown = stats.filter((s) => s.n !== null && s.n !== undefined);
      const value = $('value');
      if (shown.length) {
        const ul = $('stats');
        shown.forEach((s) => {
          const li = doc.createElement('li');
          const n = doc.createElement('span');
          n.className = 'stat-n';
          n.textContent = s.n.toLocaleString('en-US');
          const l = doc.createElement('span');
          l.className = 'stat-l';
          l.textContent = s.label;
          li.append(n, l);
          ul.append(li);
        });
        value.hidden = false;
      } else {
        const tips = cleanTips(cfg.tips);
        if (tips.length) {
          $('value-title').textContent = TEXT.tipsTitle;
          $('stats').remove();
          $('stats-note').remove();
          const ol = $('tips');
          tips.forEach((t) => { const li = doc.createElement('li'); li.textContent = t; ol.append(li); });
          ol.hidden = false;
          value.hidden = false;
        }
      }
      // Prices only in a confirmed free state.
      if (plan === 'free') doc.querySelectorAll('.js-price-free').forEach((n) => { n.hidden = false; });
      doc.documentElement.dataset.plan = plan;
      layoutBreak();
      if (root.location && root.location.hash === '#share') $('share').scrollIntoView();
    });
    root.addEventListener('resize', layoutBreak);
    root.addEventListener('load', layoutBreak);

    // 8. Opt-out. Needs chrome.storage.local, else the row stays hidden.
    if (local) {
      const box = $('optout');
      const note = $('optout-saved');
      $('optout-row').hidden = false;
      local.get('zovoWhatsNewOptOut', (r) => { if (!chromeApi.runtime.lastError && r) box.checked = r.zovoWhatsNewOptOut === true; });
      box.addEventListener('change', () => {
        local.set({ zovoWhatsNewOptOut: box.checked }, () => {
          if (chromeApi.runtime.lastError) return;
          note.textContent = box.checked ? TEXT.optSaved : TEXT.optUndone;
          note.hidden = false;
        });
      });
    } else if (preview) {
      $('optout-row').hidden = false;
    } else {
      // No storage permission. The hook never opens a tab, so the lines about stopping it do not apply.
      $('why-open').remove();
      $('faq-stop').remove();
    }

    // Close.
    const showClosedNote = () => { $('page').hidden = true; $('closed-note').hidden = false; };
    $('close-button').addEventListener('click', () => {
      try { root.close(); } catch (_) { /* ignore */ }
      setTimeout(() => {
        const tabs = chromeApi && chromeApi.tabs;
        if (!tabs || typeof tabs.getCurrent !== 'function') { showClosedNote(); return; }
        try {
          tabs.getCurrent((tab) => {
            if (chromeApi.runtime.lastError || !tab) { showClosedNote(); return; }
            tabs.remove(tab.id, () => { if (chromeApi.runtime.lastError) showClosedNote(); });
          });
        } catch (_) { showClosedNote(); }
      }, 150);
    });
  }

  return Object.freeze({ TEXT, PREVIEW, formatDate, cleanChanges, cleanTips, statValue, planState, slugOf, tagUrl, mailTo, breakHeight, run });
});
