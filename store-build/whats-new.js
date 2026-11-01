/* Tab Suspender Pro - What's new page logic.
 * Loaded after membership-state.js. No network calls: every number on the page
 * comes from this browser's own chrome.storage and chrome.tabs. */
(() => {
  'use strict';

  const RELEASE = '1.0.37';
  const CAMPAIGN = 'whats-new-1-0-37';
  const EST_MB_PER_TAB = 50;          // background.js updateMemoryStats() uses the same constant
  const FREE_WHITELIST_LIMIT = 5;     // background.js MAX_BASIC_WHITELIST
  const MAX_SANE_TABS = 5000000;      // guards against corrupted counters
  const MAX_SANE_DAYS = 3650;

  const hasChrome = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id && chrome.storage);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const nf = new Intl.NumberFormat(undefined);
  const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  /* ---------------- data sources ---------------- */

  const PREVIEW_STATES = {
    free: { kind: 'free', tabsSuspended: 1284, asleepNow: 23, installDate: Date.now() - 214 * 864e5, whitelist: 4, intent: false },
    pro: { kind: 'protected', tabsSuspended: 3911, asleepNow: 41, installDate: Date.now() - 402 * 864e5, whitelist: 12, intent: false },
    fresh: { kind: 'free', tabsSuspended: 0, asleepNow: 0, installDate: null, whitelist: 0, intent: false },
    lapsed: { kind: 'lapsed', tabsSuspended: 512, asleepNow: 9, installDate: Date.now() - 160 * 864e5, whitelist: 7, intent: false }
  };

  function previewState() {
    const p = new URLSearchParams(location.search).get('state');
    return PREVIEW_STATES[p] ? p : 'free';
  }

  const withTimeout = (p, ms = 2500) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  async function readState() {
    if (!hasChrome) return { preview: previewState(), ...PREVIEW_STATES[previewState()] };

    const out = { kind: 'unknown', tabsSuspended: null, asleepNow: null, installDate: null, whitelist: null, intent: false };
    try {
      const M = globalThis.ZovoTabMembership;
      if (M) {
        const snap = await withTimeout(M.initial);
        out.kind = snap.kind === 'free' ? (await withTimeout(M.read())).kind : snap.kind;
      }
      // "protected" means any license trace. Only a live isPro flag earns the
      // thank-you; a saved key with Pro off gets help re-activating instead.
      if (out.kind === 'protected') {
        const { isPro, licenseKey } = await chrome.storage.local.get(['isPro', 'licenseKey']);
        if (isPro === true) out.kind = 'protected';
        else if (typeof licenseKey === 'string' && licenseKey.trim()) out.kind = 'lapsed';
        else out.kind = 'unknown';
      }
    } catch { out.kind = 'unknown'; }

    try {
      const local = await chrome.storage.local.get(['memoryStats', 'installDate', 'upgradeIntentAt']);
      out.intent = Number.isFinite(Number(local.upgradeIntentAt)) && Number(local.upgradeIntentAt) > 0;
      const s = local.memoryStats;
      const n = s ? parseInt(s.tabsSuspended, 10) : NaN;
      if (Number.isFinite(n) && n >= 0 && n <= MAX_SANE_TABS) out.tabsSuspended = n;
      const d = Number(local.installDate);
      const days = (Date.now() - d) / 864e5;
      if (Number.isFinite(d) && days >= 0 && days <= MAX_SANE_DAYS) out.installDate = d;
    } catch { /* stats stay hidden */ }

    try {
      const tabs = await chrome.tabs.query({});
      const base = chrome.runtime.getURL('suspended.html');
      out.asleepNow = tabs.filter(t => (t.url || t.pendingUrl || '').startsWith(base)).length;
    } catch { /* leave null */ }

    try {
      // The whitelist lives in its own storage key since 1.0.37; the
      // background returns the merged settings object.
      const reply = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      const saved = reply && reply.settings;
      if (!saved || saved.whitelistedDomains === undefined) out.whitelist = 0;
      else if (Array.isArray(saved.whitelistedDomains)) out.whitelist = saved.whitelistedDomains.length;
    } catch { /* leave null */ }

    return out;
  }

  /* ---------------- rendering ---------------- */

  function setText(sel, text) { const el = $(sel); if (el) el.textContent = text; }

  function formatGB(mb) {
    if (mb < 1024) return { num: nf.format(Math.round(mb)), unit: 'MB' };
    return { num: nf1.format(mb / 1024), unit: 'GB' };
  }

  function renderVersion() {
    let v = RELEASE;
    try { if (hasChrome) v = chrome.runtime.getManifest().version || RELEASE; } catch { /* keep RELEASE */ }
    $$('[data-version]').forEach(el => {
      if (el.dataset.version === 'release') el.textContent = RELEASE;
      else el.textContent = el.dataset.version === 'v' ? 'v' + v : v;
    });
  }

  function renderHero(state) {
    const n = state.tabsSuspended;
    if (Number.isFinite(n) && n > 0) {
      if (n === 1) setText('#heroLine2Count', 'It has put a tab to sleep once.');
      else {
        setText('#heroCount', nf.format(n));
        setText('#heroCountNoun', 'times');
      }
      $('#heroLine2Count').hidden = false;
      $('#heroLine2Plain').hidden = true;
    }
  }

  function renderStats(state) {
    const cards = [];
    const n = state.tabsSuspended;
    if (Number.isFinite(n) && n > 0) {
      setText('#statTotal', nf.format(n));
      setText('#statTotalLabel', n === 1 ? 'Time a tab went to sleep' : 'Times a tab went to sleep');
      if (state.installDate) {
        setText('#statTotalNote', 'since ' + new Date(state.installDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
      }
      cards.push('#cardTotal');
    }
    if (Number.isFinite(state.asleepNow) && state.asleepNow > 0) {
      const g = formatGB(state.asleepNow * EST_MB_PER_TAB);
      setText('#statNow', g.num + ' ' + g.unit);
      setText('#statNowNote', nf.format(state.asleepNow) + (state.asleepNow === 1 ? ' sleeping tab' : ' sleeping tabs') + ' at about ' + EST_MB_PER_TAB + ' MB each');
      cards.push('#cardNow');
    }
    if (Number.isFinite(state.whitelist)) {
      setText('#statAwake', nf.format(state.whitelist));
      setText('#statAwakeLabel', state.whitelist === 1 ? 'Site kept awake' : 'Sites kept awake');
      if (state.kind === 'free') setText('#statAwakeNote', 'of ' + FREE_WHITELIST_LIMIT + ' on the free plan');
      else if (state.kind === 'protected') setText('#statAwakeNote', 'no limit with Pro');
      cards.push('#cardAwake');
    }
    if (cards.length >= 2 && cards.includes('#cardTotal')) {
      cards.forEach(sel => { $(sel).hidden = false; });
      $('#stats').hidden = false;
    } else {
      // No numbers to show yet, so the release notes are the main content.
      $('#changes').open = true;
    }
  }

  function renderWhitelistHint(state) {
    const el = $('#whitelistHint');
    if (!el || !Number.isFinite(state.whitelist)) return;
    if (state.kind === 'free') {
      const left = Math.max(0, FREE_WHITELIST_LIMIT - state.whitelist);
      if (state.whitelist === 0) el.textContent = 'All ' + FREE_WHITELIST_LIMIT + ' free slots are open.';
      else if (left === 0) el.textContent = "You've used all " + FREE_WHITELIST_LIMIT + ' free slots.';
      else el.textContent = "You're using " + nf.format(state.whitelist) + ' of ' + FREE_WHITELIST_LIMIT + ' free slots.';
    } else if (state.kind === 'protected') {
      el.textContent = 'You keep ' + nf.format(state.whitelist) + (state.whitelist === 1 ? ' site' : ' sites') + ' awake. Pro has no cap.';
    } else return;
    el.hidden = false;
  }

  async function renderShortcuts() {
    if (!hasChrome || !chrome.commands || !chrome.commands.getAll) return;
    try {
      const cmds = await chrome.commands.getAll();
      cmds.forEach(c => {
        $$('[data-cmd="' + c.name + '"]').forEach(el => {
          if (c.shortcut) { el.textContent = c.shortcut; el.removeAttribute('data-unset'); }
          else { el.textContent = 'Not set'; el.setAttribute('data-unset', ''); }
        });
      });
    } catch { /* keep manifest defaults in the markup */ }
  }

  function applyKind(kind) {
    document.documentElement.dataset.member = kind;
    $$('[data-for]').forEach(el => {
      const allowed = el.dataset.for.split(/\s+/);
      el.hidden = !allowed.includes(kind);
    });
  }

  /* ---------------- links and actions ---------------- */

  function markNewTabLinks() {
    $$('a[target="_blank"]').forEach(a => {
      const hint = document.createElement('span');
      hint.className = 'sr-only';
      hint.textContent = ' (opens in a new tab)';
      a.append(hint);
    });
  }

  function decorateLinks() {
    $$('a[data-cta]').forEach(a => {
      try {
        const u = new URL(a.getAttribute('href'));
        u.searchParams.set('utm_source', 'tab-suspender-pro');
        u.searchParams.set('utm_medium', 'extension');
        u.searchParams.set('utm_campaign', CAMPAIGN);
        u.searchParams.set('utm_content', a.dataset.cta);
        if (!u.searchParams.has('ref')) u.searchParams.set('ref', 'tab-suspender-pro');
        a.href = u.toString();
      } catch { /* leave the authored href */ }
      a.addEventListener('click', () => {
        if (!hasChrome || !/^(plan-|after-)/.test(a.dataset.cta)) return;
        chrome.storage.local.set({ upgradeIntentAt: Date.now(), upgradeSource: CAMPAIGN + ':' + a.dataset.cta }).catch(() => {});
      });
    });
  }

  function openExtensionPage(path) {
    if (hasChrome) chrome.tabs.create({ url: chrome.runtime.getURL(path) });
    else window.open(path, '_blank', 'noopener');
  }

  function bindActions() {
    $$('[data-open]').forEach(btn => btn.addEventListener('click', () => {
      const target = btn.dataset.open;
      if (target === 'shortcuts') {
        if (hasChrome) chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
        else toast('Opens chrome://extensions/shortcuts in the extension');
      } else if (target === 'settings') {
        if (hasChrome && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
        else openExtensionPage('settings.html');
      } else {
        openExtensionPage(target);
      }
    }));

    const optout = $('#optout');
    if (optout) {
      if (hasChrome) {
        chrome.storage.sync.get('whatsNewOptOut').then(r => { optout.checked = r.whatsNewOptOut === true; }).catch(() => {});
      }
      optout.addEventListener('change', () => {
        const value = optout.checked;
        if (hasChrome) chrome.storage.sync.set({ whatsNewOptOut: value }).catch(() => {});
        toast(value ? 'Got it. Update pages stay closed from now on.' : 'Update pages are back on.');
      });
    }
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => { t.textContent = ''; }, 250);
    }, 2600);
  }

  function renderPreviewBar(current) {
    const bar = $('#previewBar');
    if (!bar) return;
    bar.hidden = false;
    $$('a[data-preview]', bar).forEach(a => {
      if (a.dataset.preview === current) a.setAttribute('aria-current', 'true');
    });
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    renderVersion();
    decorateLinks();
    markNewTabLinks();
    bindActions();
    renderShortcuts();
    const state = await readState();
    applyKind(state.kind);
    renderHero(state);
    renderStats(state);
    renderWhitelistHint(state);
    if (state.kind === 'free' && state.intent) $('#paidNote').hidden = false;
    if (state.preview) renderPreviewBar(state.preview);
    if (hasChrome) chrome.storage.local.set({ whatsNewSeen: RELEASE, whatsNewSeenAt: Date.now() }).catch(() => {});

    // The update tab opens in the background; refresh the live numbers the
    // first time someone actually looks at it.
    if (hasChrome && document.visibilityState !== 'visible') {
      document.addEventListener('visibilitychange', async function onShow() {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', onShow);
        const fresh = await readState();
        renderHero(fresh);
        renderStats(fresh);
        renderWhitelistHint(fresh);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
