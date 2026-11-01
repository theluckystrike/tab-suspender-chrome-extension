/* ============================================================
   Tab Suspender Pro — Onboarding controller (Zovo serif design)
   5-step flow. Works in the extension (chrome.*) and standalone
   (graceful mock fallback for manual preview). NASA-clean:
   bounded loops, guarded returns, no globals leaked.
   ============================================================ */
(function () {
  'use strict';

  const TOTAL = 7;
  const JOIN_URLS = {
    lifetime: 'https://zovo.one/join?tier=lifetime&utm_source=tab-suspender-pro&utm_medium=extension&utm_campaign=onboarding&utm_content=lifetime-card',
    monthly: 'https://zovo.one/join?tier=pro&utm_source=tab-suspender-pro&utm_medium=extension&utm_campaign=onboarding&utm_content=monthly-card'
  };
  const hasChrome = typeof chrome !== 'undefined' && chrome.tabs && chrome.storage;

  let current = 1;
  let plan = 'lifetime';

  const $ = (id) => document.getElementById(id);
  const steps = Array.from(document.querySelectorAll('.step'));
  const dots = Array.from(document.querySelectorAll('.dot'));
  const nextBtn = $('nextBtn'), backBtn = $('backBtn'), nextLabel = $('nextLabel');
  const topnavNote = document.querySelector('.topnav-note');
  const STEP_NOTES = { 1: 'Welcome', 2: 'Demo', 3: 'Protections', 4: 'Shortcuts', 5: 'Who', 6: 'Pro', 7: 'Done' };
  const counter = $('counter'), fill = $('progressFill');

  const NEXT = {
    1: () => 'Reclaim my memory',
    2: () => 'Looks great, next',
    3: () => 'Save & continue',
    4: () => 'See who built it',
    5: () => 'See what Pro adds',
    6: () => (plan === 'lifetime' ? 'Get Lifetime for $99' : 'Get Pro for $4.99 a month'),
    7: () => 'Start browsing'
  };

  /* ---------- render ---------- */
  function render() {
    steps.forEach((s) => s.classList.toggle('active', +s.dataset.step === current));
    dots.forEach((d) => {
      const n = +d.dataset.step;
      d.classList.toggle('active', n === current);
      d.classList.toggle('done', n < current);
    });
    counter.textContent = String(current).padStart(2, '0') + ' / ' + String(TOTAL).padStart(2, '0');
    fill.style.width = (current / TOTAL) * 100 + '%';
    backBtn.hidden = current === 1;
    nextLabel.textContent = NEXT[current]();
    nextBtn.querySelector('svg').style.display = current === 6 ? 'none' : '';
    if (current === 1) animateGauge();
    if (current === 2) resetDemo();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function go(n) {
    if (topnavNote && STEP_NOTES[n]) topnavNote.textContent = STEP_NOTES[n]; current = Math.max(1, Math.min(TOTAL, n)); render(); }

  nextBtn.addEventListener('click', () => {
    if (current === 3) persistSetup();
    if (current === 6) { convert(); return; }
    if (current === 7) { finish(); return; }
    go(current + 1);
  });
  backBtn.addEventListener('click', () => go(current - 1));
  dots.forEach((d) => d.addEventListener('click', () => go(+d.dataset.step)));
  // "Maybe later, keep the free version" - advance to the sign-off without
  // opening the pricing tab.
  const skipPay = $('skipPay');
  if (skipPay) skipPay.addEventListener('click', () => go(7));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' && current < TOTAL) go(current + 1);
    if (e.key === 'ArrowLeft' && current > 1) go(current - 1);
  });

  /* ---------- Step 1: memory gauge (real or mock) ---------- */
  let gaugeDone = false;
  async function animateGauge() {
    if (gaugeDone) return; gaugeDone = true;
    let gb = 4.2, pct = 82;
    if (hasChrome) {
      try {
        const tabs = await chrome.tabs.query({});
        const n = Array.isArray(tabs) ? tabs.length : 0;
        if (n > 0) { gb = Math.max(0.6, +(n * 0.11).toFixed(1)); pct = Math.min(94, Math.round((gb / 6) * 100)); }
      } catch (_) {}
    }
    countTo($('gaugeVal'), 0, gb, 1200, (v) => v.toFixed(1) + '<small>GB</small>', true);
    setTimeout(() => { const f = $('gaugeFill'); if (f) f.style.width = pct + '%'; }, 120);
  }

  /* ---------- Step 2: instant-win demo ---------- */
  let demoRan = false;
  function resetDemo() {
    demoRan = false;
    const num = $('demoNum'), cap = $('demoCap'), mem = $('demoMem'), btn = $('demoBtn');
    if (num) num.textContent = '0';
    if (cap) cap.textContent = 'Tap suspend to reclaim memory';
    if (mem) mem.classList.remove('done');
    document.querySelectorAll('#demoTabs .dtab[data-mb]').forEach((t) => {
      t.classList.remove('suspended');
      const idle = t.querySelector('.idle'); if (idle) idle.style.display = '';
      const badge = t.querySelector('.badge'); if (badge) badge.remove();
    });
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
  const demoBtn = $('demoBtn');
  if (demoBtn) demoBtn.addEventListener('click', () => {
    if (demoRan) return; demoRan = true;
    const idle = Array.from(document.querySelectorAll('#demoTabs .dtab[data-mb]'));
    let total = 0;
    idle.forEach((t, i) => {
      total += (+t.dataset.mb || 0);
      setTimeout(() => {
        t.classList.add('suspended');
        const idleEl = t.querySelector('.idle'); if (idleEl) idleEl.style.display = 'none';
        if (!t.querySelector('.badge')) {
          const b = document.createElement('span');
          b.className = 'badge suspended'; b.textContent = 'Suspended';
          t.insertBefore(b, t.querySelector('.saved'));
        }
      }, 220 * (i + 1));
    });
    setTimeout(() => {
      countTo($('demoNum'), 0, total, 1100, (v) => Math.round(v).toString());
      const cap = $('demoCap'), mem = $('demoMem');
      if (cap) cap.textContent = 'reclaimed, memory freed';
      if (mem) mem.classList.add('done');
    }, 260);
    // Visual-only demo — never suspend the user's real tabs mid-onboarding.
    demoBtn.style.opacity = '.55'; demoBtn.disabled = true;
  });

  /* ---------- Step 3: setup ---------- */
  const tv = $('setupTimeout'), tvv = $('setupTimeoutValue');
  if (tv) tv.addEventListener('input', () => {
    const m = +tv.value;
    tvv.textContent = m >= 60 ? (m / 60 % 1 === 0 ? m / 60 + ' hr' : (m / 60).toFixed(1) + ' hr') : m + ' min';
  });
  function persistSetup() {
    // Route through the same SAVE_SETTINGS message settings.js uses so the config
    // (stored in chrome.storage.sync['tabSuspenderSettings']) actually applies.
    const settings = {
      suspensionTimeout: +tv.value,
      whitelistedDomains: Array.from(document.querySelectorAll('.chip input:checked'))
        .map((c) => c.dataset.domain).filter(Boolean),
      neverSuspendAudio: $('setupAudio').checked,
      neverSuspendUnsavedForms: $('setupForms').checked,
      suspendPinnedTabs: !$('setupPinned').checked
    };
    if (!hasChrome) return;
    try { chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }); }
    catch (e) { console.warn('[onboarding] persistSetup failed:', e && e.message); }
  }

  /* ---------- Step 4: pricing toggle + FAQ + convert ---------- */
  const PLANS = {
    monthly: { amt: '$4.99', per: '/ month', sub: 'Cancel any time from your dashboard', r1: 'Cancel anytime' },
    lifetime: { amt: '$99', per: 'once', sub: 'One payment · Pro in 15 Zovo extensions', r1: 'One-time payment' }
  };
  const seg = $('planSeg');
  if (seg) seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-plan]'); if (!btn) return;
    plan = btn.dataset.plan;
    Array.from(seg.querySelectorAll('button')).forEach((b) => b.classList.toggle('on', b === btn));
    const p = PLANS[plan] || PLANS.monthly;
    $('priceAmt').textContent = p.amt;
    $('pricePer').textContent = p.per;
    $('priceSub').textContent = p.sub;
    $('reassure1').textContent = p.r1;
    if (current === 6) nextLabel.textContent = NEXT[6]();
  });
  Array.from(document.querySelectorAll('[data-buy]')).forEach((b) => b.addEventListener('click', () => {
    plan = b.dataset.buy === 'monthly' ? 'monthly' : 'lifetime';
    convert();
  }));
  const jumpPro = $('jumpPro');
  if (jumpPro) jumpPro.addEventListener('click', (e) => { e.preventDefault(); go(6); });
  // FAQ accordion (bounded to the items present)
  Array.from(document.querySelectorAll('#faq .faq-item')).forEach((item) => {
    const q = item.querySelector('.faq-q'), a = item.querySelector('.faq-a');
    if (!q || !a) return;
    q.addEventListener('click', () => {
      const open = item.classList.toggle('open');
      a.style.maxHeight = open ? a.scrollHeight + 'px' : '0';
    });
  });
  function convert() {
    if (hasChrome) { try { chrome.storage.local.set({ upgradeIntentAt: Date.now(), upgradePlan: plan }); } catch (_) {} }
    openUpgrade();
    go(7);
  }
  function openUpgrade() {
    const url = JOIN_URLS[plan] || JOIN_URLS.lifetime;
    if (hasChrome && chrome.tabs && chrome.tabs.create) { try { chrome.tabs.create({ url }); return; } catch (_) {} }
    window.open(url, '_blank');
  }

  /* ---------- Step 5: finish ---------- */
  function finish() {
    if (!hasChrome) { nextLabel.textContent = 'Done'; return; }
    try {
      chrome.storage.local.set({ onboardingComplete: true, onboardingAt: Date.now() });
      window.close();
    } catch (_) {}
  }

  /* ---------- helper: bounded RAF counter ---------- */
  function countTo(el, from, to, dur, fmt, html) {
    if (!el) return;
    const t0 = performance.now();
    (function tick(now) {
      const p = Math.min(1, (now - t0) / dur);
      const v = from + (to - from) * (1 - Math.pow(1 - p, 3));
      el[html ? 'innerHTML' : 'textContent'] = fmt(v);
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  /* ---------- deep-link a step (preview/screenshots): ?step=4 ---------- */
  try {
    const q = +new URLSearchParams(location.search).get('step');
    if (q >= 1 && q <= TOTAL) current = q;
  } catch (_) {}

  render();
})();
