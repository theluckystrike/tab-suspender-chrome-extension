/* Tab Suspender Pro - one-time rating prompt, popup card (1.0.39).
 * One card that shows both paths at the same time, with no question first.
 * The store review link and the feedback mail link are equal choices, so no
 * answer filters people away from the store (no review gating).
 * No gift, no discount, no unlock. No network calls from this file. */
(function () {
  'use strict';
  var P = typeof globalThis !== 'undefined' ? globalThis.ZovoRatePrompt : null;
  if (!P || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  var CFG = P.CONFIG;
  var T = P.TEXT;
  var store = chrome.storage.local;
  var ID = 'zovo-rate-prompt';

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function closeCard(card) {
    card.remove();
    var next = document.getElementById('suspendAllBtn');
    if (next) next.focus();
  }

  function warn(where, err) {
    console.warn('[RatePrompt] ' + where + ':', err && err.message ? err.message : err);
  }

  /* A link that records the choice first, so it holds even if the popup closes. */
  function choiceLink(card, text, href, choice) {
    var a = el('a', 'c-btn c-btn-sm', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.addEventListener('click', function () {
      P.choose(store, choice).catch(function (e) { warn('choose', e); });
      setTimeout(function () { closeCard(card); }, 0);
    });
    return a;
  }

  function build() {
    var card = el('section', 'zrp-card');
    card.id = ID;
    card.setAttribute('aria-label', T.region);
    var line = el('p', 'zrp-line', T.line);
    var row = el('div', 'zrp-actions');
    var later = el('button', 'c-btn c-btn-sm c-btn-ghost zrp-close', T.later);
    later.type = 'button';
    later.addEventListener('click', function () {
      P.dismiss(store).catch(function (e) { warn('dismiss', e); });
      closeCard(card);
    });
    row.append(
      choiceLink(card, T.rate, CFG.storeUrl, 'rate'),
      choiceLink(card, T.tell, CFG.mailUrl, 'tell'),
      later
    );
    card.append(line, row);
    return card;
  }

  function mount() {
    if (document.getElementById(ID)) return;
    P.evaluate(store, CFG).then(function (result) {
      if (!result.show) return;
      var anchor = document.querySelector('.popup-container .tabs-section');
      if (!anchor || !anchor.parentNode) return;
      anchor.parentNode.insertBefore(build(), anchor);
      return P.markShown(store);
    }).catch(function (e) { warn('mount', e); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
