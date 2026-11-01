/* Tab Suspender Pro - one-time rating prompt, trigger logic (1.0.39).
 * Pure logic plus chrome.storage.local reads and writes. No DOM, no network.
 * State lives under one key, zovo_rate_prompt. Loaded by popup.html before
 * rate-prompt.js, and by node in tests (module.exports). */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.ZovoRatePrompt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var KEY = 'zovo_rate_prompt';
  var DAY_MS = 864e5;
  var MAX_COUNTER = 100000;
  /* rate = opened the store review page, tell = opened the feedback mail. */
  var CHOICES = ['rate', 'tell'];

  /* Extension preset. Thresholds come from the owner brief of 2026-10-22. */
  var CONFIG = Object.freeze({
    name: 'Tab Suspender Pro',
    storeUrl: 'https://chromewebstore.google.com/detail/ofgncemnlblfnocjbojdhamacfffcpnm/reviews',
    mailUrl: 'mailto:support@zovo.one?subject=' + encodeURIComponent('Tab Suspender Pro feedback'),
    minCount: 50,      // memoryStats.tabsSuspended, the lifetime counter
    minOpens: 3,       // popup opens counted by this prompt
    minOpened: 0,      // not used here
    countOpens: true,
    quietDays: 3,      // never in the first 3 days after install
    settleDays: 1,     // never in the first 24 h after this check first ran
    snoozeDays: 14,    // "Not now" re-shows at most once, 14 days later
    maxShows: 2,
    inputKeys: ['installDate', 'memoryStats'],
    readInputs: function (data) {
      var stats = data && data.memoryStats;
      return { installDate: data && data.installDate, count: stats ? stats.tabsSuspended : 0 };
    }
  });

  /* One card, both paths visible at once, no question first (no review gating). */
  var TEXT = Object.freeze({
    region: 'A note from the developer',
    line: "If Tab Suspender Pro has earned five stars from you, please give them. If it hasn't, tell me what's missing.",
    rate: 'Rate it on the Chrome Web Store',
    tell: "Tell me what's missing",
    later: 'Not now'
  });

  function toCount(value) {
    var n = typeof value === 'number' ? value : parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(Math.floor(n), MAX_COUNTER);
  }

  function toTime(value) {
    var n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function normalize(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    var ids = Array.isArray(s.openedIds) ? s.openedIds.filter(function (id) {
      return typeof id === 'string' && id.length > 0 && id.length <= 200;
    }).slice(0, 10) : [];
    return {
      v: 1,
      firstSeenAt: toTime(s.firstSeenAt),
      opens: toCount(s.opens),
      openedIds: ids,
      shows: Math.min(toCount(s.shows), 10),
      lastShownAt: toTime(s.lastShownAt),
      dismissedAt: toTime(s.dismissedAt),
      choice: CHOICES.indexOf(s.choice) !== -1 ? s.choice : null,
      choiceAt: toTime(s.choiceAt)
    };
  }

  /* True when nothing can ever show again, so no more writes are needed. */
  function isFinal(state, cfg) {
    return state.choice !== null || state.shows >= cfg.maxShows;
  }

  /* inputs = { installDate, count, opens, opened }. Returns { show, reason }. */
  function decide(state, inputs, cfg, now) {
    if (!Number.isFinite(now)) return { show: false, reason: 'bad-clock' };
    if (state.choice !== null) return { show: false, reason: 'chosen' };
    if (state.shows >= cfg.maxShows) return { show: false, reason: 'max-shows' };
    var installed = toTime(inputs.installDate);
    var anchor = installed || state.firstSeenAt || now;
    if (now - anchor < cfg.quietDays * DAY_MS) return { show: false, reason: 'quiet-days' };
    if (now - (state.firstSeenAt || now) < cfg.settleDays * DAY_MS) return { show: false, reason: 'settle' };
    if (toCount(inputs.count) < cfg.minCount) return { show: false, reason: 'below-count' };
    if (toCount(inputs.opens) < cfg.minOpens) return { show: false, reason: 'below-opens' };
    if (toCount(inputs.opened) < cfg.minOpened) return { show: false, reason: 'below-opened' };
    if (state.shows >= 1) {
      var last = Math.max(state.lastShownAt, state.dismissedAt);
      if (last > now) return { show: false, reason: 'bad-clock' };
      if (now - last < cfg.snoozeDays * DAY_MS) return { show: false, reason: 'snoozed' };
    }
    return { show: true, reason: 'eligible' };
  }

  function nowOf(clock) {
    return typeof clock === 'function' ? clock() : Date.now();
  }

  function readState(storage) {
    return storage.get(KEY).then(function (data) { return normalize(data && data[KEY]); });
  }

  function writeState(storage, state) {
    var out = {};
    out[KEY] = state;
    return storage.set(out).then(function () { return state; });
  }

  /* Runs once per popup open. Counts the open, then decides. Does not mark
   * the prompt as shown; call markShown after the card is on screen. */
  function evaluate(storage, cfg, clock) {
    var now = nowOf(clock);
    var keys = [KEY].concat(cfg.inputKeys);
    return storage.get(keys).then(function (data) {
      var state = normalize(data && data[KEY]);
      if (isFinal(state, cfg)) return { show: false, reason: state.choice ? 'chosen' : 'max-shows', state: state };
      var dirty = false;
      if (!state.firstSeenAt) { state.firstSeenAt = now; dirty = true; }
      // Counting stops at the threshold, so the popup stops writing once it is met.
      if (cfg.countOpens && state.opens < cfg.minOpens) { state.opens += 1; dirty = true; }
      var raw = cfg.readInputs(data || {}, state) || {};
      var inputs = {
        installDate: raw.installDate,
        count: raw.count,
        opens: state.opens,
        opened: Math.max(state.openedIds.length, toCount(raw.opened))
      };
      var verdict = decide(state, inputs, cfg, now);
      var result = { show: verdict.show, reason: verdict.reason, state: state };
      if (!dirty) return result;
      return writeState(storage, state).then(function () { return result; });
    });
  }

  function update(storage, clock, change) {
    var now = nowOf(clock);
    return readState(storage).then(function (state) {
      change(state, now);
      return writeState(storage, state);
    });
  }

  function markShown(storage, clock) {
    return update(storage, clock, function (s, now) { s.shows = Math.min(s.shows + 1, 10); s.lastShownAt = now; });
  }

  function choose(storage, choice, clock) {
    if (CHOICES.indexOf(choice) === -1) return Promise.reject(new Error('bad choice'));
    return update(storage, clock, function (s, now) {
      if (s.choice === null) { s.choice = choice; s.choiceAt = now; }
    });
  }

  function dismiss(storage, clock) {
    return update(storage, clock, function (s, now) { s.dismissedAt = now; });
  }

  /* Remembers up to 3 distinct opened item ids (ReadLater reader page). */
  function recordOpened(storage, id, cfg) {
    if (typeof id !== 'string' || !id || id.length > 200) return Promise.resolve(null);
    return readState(storage).then(function (s) {
      if (isFinal(s, cfg) || s.openedIds.indexOf(id) !== -1 || s.openedIds.length >= 3) return s;
      s.openedIds.push(id);
      return writeState(storage, s);
    });
  }

  return Object.freeze({
    KEY: KEY, DAY_MS: DAY_MS, CONFIG: CONFIG, TEXT: TEXT, CHOICES: CHOICES,
    normalize: normalize, decide: decide, isFinal: isFinal, evaluate: evaluate,
    markShown: markShown, choose: choose, dismiss: dismiss, recordOpened: recordOpened
  });
});
