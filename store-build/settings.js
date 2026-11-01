/**
 * Tab Suspender Pro - Settings Page JavaScript
 * Redesigned with Smart Defaults approach
 */

// DOM Elements - Header
const backBtn = document.getElementById('backBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

// DOM Elements - Profile Selection
const profileSelector = document.getElementById('profileSelector');
const profileStatus = document.getElementById('profileStatus');

// DOM Elements - Custom Timing (PRO)
const customTimingSection = document.getElementById('customTimingSection');
const unlockCustomTimingBtn = document.getElementById('unlockCustomTimingBtn');
const customTimingSlider = document.getElementById('customTimingSlider');
const timeoutSlider = document.getElementById('timeout');
const timeoutValue = document.getElementById('timeoutValue');

// DOM Elements - Protection
const customizeProtectionBtn = document.getElementById('customizeProtectionBtn');
const protectionChevron = document.getElementById('protectionChevron');
const protectionSettings = document.getElementById('protectionSettings');
const badgeAudio = document.getElementById('badgeAudio');
const badgeForms = document.getElementById('badgeForms');
const badgePinned = document.getElementById('badgePinned');
const badgeActive = document.getElementById('badgeActive');
const neverAudio = document.getElementById('neverAudio');
const neverForms = document.getElementById('neverForms');
const neverPinned = document.getElementById('neverPinned');
const neverActive = document.getElementById('neverActive');
const autoRestore = document.getElementById('autoRestore');

// DOM Elements - Whitelist
const addCurrentSiteBtn = document.getElementById('addCurrentSiteBtn');
const whitelistItems = document.getElementById('whitelistItems');
const newDomainInput = document.getElementById('newDomain');
const addDomainBtn = document.getElementById('addDomainBtn');

// DOM Elements - Suspension Method
const suspendModePage = document.getElementById('suspendModePage');
const suspendModeDiscard = document.getElementById('suspendModeDiscard');
const restoreScrollRow = document.getElementById('restoreScrollRow');
const restoreScrollToggle = document.getElementById('restoreScroll');
const minTabsInput = document.getElementById('minTabsToSuspend');

// DOM Elements - URL Patterns (PRO)
const urlPatternsSection = document.getElementById('urlPatternsSection');
const patternsCounter = document.getElementById('patternsCounter');
const patternItems = document.getElementById('patternItems');
const newPatternInput = document.getElementById('newPattern');
const addPatternBtn = document.getElementById('addPatternBtn');

// DOM Elements - Impact
const impactValue = document.getElementById('impactValue');
const impactRank = document.getElementById('impactRank');
const viewStatsBtn = document.getElementById('viewStatsBtn');

// DOM Elements - License
const licenseSection = document.getElementById('licenseSection');
const licensePrompt = document.getElementById('licensePrompt');
const licenseActive = document.getElementById('licenseActive');
const activateLicenseBtn = document.getElementById('activateLicenseBtn');
const licenseKeyDisplay = document.getElementById('licenseKeyDisplay');

// DOM Elements - License Modal
const licenseModal = document.getElementById('licenseModal');
const licenseModalClose = document.getElementById('licenseModalClose');
const licenseInput = document.getElementById('licenseInput');
const licenseStatus = document.getElementById('licenseStatus');
const activateBtn = document.getElementById('activateBtn');

// DOM Elements - Toast
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// State
let settings = {};
let isPro = false;
let currentProfile = 'balanced';

// Pro tier limits
const MAX_BASIC_WHITELIST = 5;

// Defaults for the 1.0.37 keys (same values background.js applies). Older
// settings objects do not have them, so every read goes through these.
const SUSPEND_MODES = ['page', 'discard'];
const DEFAULT_SUSPEND_MODE = 'page';
const DEFAULT_RESTORE_SCROLL = true;
const DEFAULT_MIN_TABS = 0;
const MIN_TABS_MAX = 200;
const PATTERN_MAX_LENGTH = 200;

// License keys are validated by the server only. There is no offline or fixed
// bypass code.

// Profile configurations
const PROFILES = {
    relaxed: { timeout: 60, name: 'Relaxed', desc: '60 min' },
    balanced: { timeout: 30, name: 'Balanced', desc: '30 min' },
    aggressive: { timeout: 15, name: 'Aggressive', desc: '15 min' }
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await checkProStatus();
    await loadSettings();
    await loadStats();
    setupEventListeners();
    updateUI();
    setupUpdatesSection();
    setupLedgerSection();
    openLicenseFromHash();
});

// ============================================================================
// RECOVERY: the tab ledger (chrome.storage.local `tabLedger`, written by the
// background on every suspend). Free for everyone.
// ============================================================================

let ledgerEntries = [];
const LEDGER_RENDER_MAX = 100;

function setupLedgerSection() {
    const items = document.getElementById('ledgerItems');
    if (!items) return;
    document.getElementById('ledgerOpenTodayBtn')?.addEventListener('click', openLedgerToday);
    document.getElementById('ledgerExportBtn')?.addEventListener('click', exportLedger);
    document.getElementById('ledgerClearBtn')?.addEventListener('click', clearLedger);
    items.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-ledger-url]');
        if (!btn) return;
        openLedgerUrls([btn.dataset.ledgerUrl]);
    });
    loadLedger();
}

async function loadLedger() {
    try {
        const reply = await chrome.runtime.sendMessage({ type: 'GET_LEDGER' });
        ledgerEntries = Array.isArray(reply?.entries) ? reply.entries : [];
    } catch (error) {
        console.error('Failed to load the tab ledger:', error);
        ledgerEntries = [];
    }
    renderLedger();
}

function ledgerDomain(url) {
    try { return new URL(url).hostname || url; } catch (e) { return url; }
}

function timeAgo(ts) {
    const diff = Math.max(0, Date.now() - ts);
    const min = Math.round(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const hours = Math.round(min / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}

function renderLedger() {
    const items = document.getElementById('ledgerItems');
    const empty = document.getElementById('ledgerEmpty');
    if (!items) return;
    items.textContent = '';
    const list = ledgerEntries.slice(0, LEDGER_RENDER_MAX);
    if (empty) empty.hidden = list.length > 0;
    const openToday = document.getElementById('ledgerOpenTodayBtn');
    const exportBtn = document.getElementById('ledgerExportBtn');
    const clearBtn = document.getElementById('ledgerClearBtn');
    [openToday, exportBtn, clearBtn].forEach(b => { if (b) b.disabled = ledgerEntries.length === 0; });

    for (const entry of list) {
        const row = document.createElement('div');
        row.className = 'ledger-item';

        const text = document.createElement('div');
        text.className = 'ledger-text';
        const title = document.createElement('span');
        title.className = 'ledger-title';
        title.textContent = entry.title || ledgerDomain(entry.url);
        title.title = entry.url;
        const meta = document.createElement('span');
        meta.className = 'ledger-meta';
        meta.textContent = `${ledgerDomain(entry.url)} - ${timeAgo(entry.time)}`;
        text.append(title, meta);

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'c-btn c-btn-sm';
        open.textContent = 'Open';
        open.dataset.ledgerUrl = entry.url;

        row.append(text, open);
        items.appendChild(row);
    }
    if (ledgerEntries.length > list.length) {
        const more = document.createElement('div');
        more.className = 'ledger-more';
        more.textContent = `${ledgerEntries.length - list.length} older entries are kept too. Export JSON lists all of them.`;
        items.appendChild(more);
    }
}

async function openLedgerUrls(urls) {
    try {
        const reply = await chrome.runtime.sendMessage({ type: 'OPEN_LEDGER_URLS', urls });
        const opened = reply?.opened || 0;
        showToast(opened === 1 ? 'Opened 1 tab' : `Opened ${opened} tabs`, opened ? 'success' : 'error');
    } catch (error) {
        console.error('Failed to open ledger tabs:', error);
        showToast('Could not open those tabs', 'error');
    }
}

function openLedgerToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const urls = ledgerEntries.filter(e => e.time >= start.getTime()).map(e => e.url);
    if (!urls.length) {
        showToast('Nothing was filed today', 'info');
        return;
    }
    if (urls.length > 50) showToast('Opening the first 50 of today\'s tabs', 'info');
    openLedgerUrls(urls.slice(0, 50));
}

function exportLedger() {
    const blob = new Blob([JSON.stringify({
        exportedAt: new Date().toISOString(),
        version: chrome.runtime.getManifest().version,
        entries: ledgerEntries
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tab-suspender-pro-ledger.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Ledger exported', 'success');
}

async function clearLedger() {
    if (!ledgerEntries.length) return;
    if (!confirm('Clear the recovery list? The entries cannot be brought back.')) return;
    try {
        await chrome.runtime.sendMessage({ type: 'CLEAR_LEDGER' });
        ledgerEntries = [];
        renderLedger();
        showToast('Recovery list cleared', 'success');
    } catch (error) {
        console.error('Failed to clear the ledger:', error);
        showToast('Could not clear the list', 'error');
    }
}

// "Show what's new after an update" lives in its own sync key so saving the
// main settings object can never reset it.
function setupUpdatesSection() {
    const versionLabel = document.getElementById('versionLabel');
    if (versionLabel) versionLabel.textContent = 'v' + chrome.runtime.getManifest().version;

    const toggle = document.getElementById('showWhatsNew');
    if (toggle) {
        chrome.storage.sync.get('whatsNewOptOut').then(r => {
            toggle.checked = r.whatsNewOptOut !== true;
        }).catch(() => {});
        toggle.addEventListener('change', () => {
            chrome.storage.sync.set({ whatsNewOptOut: !toggle.checked })
                .then(() => showToast(toggle.checked ? "What's new will open after updates" : "What's new will stay closed", 'success'))
                .catch(() => showToast('Could not save that setting', 'error'));
        });
    }

    document.getElementById('openWhatsNewBtn')?.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('whats-new.html') });
    });
}

// whats-new.html links here with #license for people who already paid.
function openLicenseFromHash() {
    if (location.hash !== '#license') return;
    document.getElementById('licenseSection')?.scrollIntoView({ block: 'center' });
    if (!isPro) openLicenseModal();
}

// Check Pro status
async function checkProStatus() {
    try {
        const result = await chrome.storage.local.get(['isPro', 'licenseKey']);
        isPro = result.isPro || false;

        if (isPro && result.licenseKey) {
            // Show active license (with null checks)
            if (licensePrompt) licensePrompt.style.display = 'none';
            if (licenseActive) licenseActive.style.display = 'flex';
            if (licenseKeyDisplay) licenseKeyDisplay.textContent = maskLicenseKey(result.licenseKey);

            // Show custom timing slider (with null checks)
            if (unlockCustomTimingBtn) unlockCustomTimingBtn.style.display = 'none';
            if (customTimingSlider) customTimingSlider.style.display = 'flex';
        }
    } catch (error) {
        console.error('Error checking Pro status:', error);
        isPro = false;
    }
}

// Load settings
async function loadSettings() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        settings = response.settings || {};
        applyNewKeyDefaults(settings);

        // Determine current profile based on timeout
        const timeout = settings.suspensionTimeout || 30;
        if (timeout >= 60) {
            currentProfile = 'relaxed';
        } else if (timeout <= 15) {
            currentProfile = 'aggressive';
        } else {
            currentProfile = 'balanced';
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
        showToast('Failed to load settings', 'error');
    }
}

// Fill in the 1.0.37 keys when they are missing or have the wrong type.
// Mutates and returns the object.
function applyNewKeyDefaults(obj) {
    if (!SUSPEND_MODES.includes(obj.suspendMode)) obj.suspendMode = DEFAULT_SUSPEND_MODE;
    if (typeof obj.restoreScroll !== 'boolean') obj.restoreScroll = DEFAULT_RESTORE_SCROLL;
    obj.minTabsToSuspend = clampMinTabs(obj.minTabsToSuspend);
    obj.urlPatterns = Array.isArray(obj.urlPatterns)
        ? obj.urlPatterns.filter(p => typeof p === 'string' && p.trim().length > 0).map(p => p.trim())
        : [];
    return obj;
}

function clampMinTabs(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_MIN_TABS;
    return Math.min(MIN_TABS_MAX, Math.max(0, Math.round(n)));
}

// Load stats
async function loadStats() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
        const totalSaved = response.totalSaved || 0;
        const lifetimeTabs = response.lifetimeTabsSuspended || 0;

        // Format bytes to human readable (with null check)
        if (impactValue) impactValue.textContent = formatBytes(totalSaved);

        // Only this browser's own count. There is no data about other users,
        // so no percentile claims.
        if (impactRank) {
            impactRank.textContent = lifetimeTabs === 0 ? 'No tabs put to sleep yet' : lifetimeTabs === 1 ? 'Tabs put to sleep once so far' : `Tabs put to sleep ${lifetimeTabs.toLocaleString()} times so far`;
        }
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Update UI based on settings
function updateUI() {
    // Update profile selector
    updateProfileSelector();

    // Update protection toggles
    neverAudio.checked = settings.neverSuspendAudio !== false;
    neverForms.checked = settings.neverSuspendUnsavedForms !== false;
    neverPinned.checked = settings.suspendPinnedTabs === false;
    neverActive.checked = settings.neverSuspendActiveTab !== false;
    autoRestore.checked = settings.autoUnsuspendOnFocus !== false;

    // Update protection badges
    updateProtectionBadges();

    // Update timeout slider (for PRO users)
    if (timeoutSlider) {
        timeoutSlider.value = settings.suspensionTimeout || 30;
        updateTimeoutDisplay();
    }

    // Update whitelist
    renderWhitelist();

    // Suspension method, scroll restore, min tabs
    updateSuspendMethodUI();

    // URL patterns (PRO)
    renderPatterns();
}

// Reflect suspendMode / restoreScroll / minTabsToSuspend in the controls
function updateSuspendMethodUI() {
    const mode = SUSPEND_MODES.includes(settings.suspendMode) ? settings.suspendMode : DEFAULT_SUSPEND_MODE;
    if (suspendModePage) suspendModePage.checked = mode === 'page';
    if (suspendModeDiscard) suspendModeDiscard.checked = mode === 'discard';
    if (restoreScrollToggle) restoreScrollToggle.checked = settings.restoreScroll !== false;
    if (minTabsInput) minTabsInput.value = clampMinTabs(settings.minTabsToSuspend);
    updateRestoreScrollVisibility();
}

// "Restore scroll position" only applies to page mode. Hide it (do not
// remove it) in discard mode so the saved value survives a mode switch.
function updateRestoreScrollVisibility() {
    if (!restoreScrollRow) return;
    const isPage = !suspendModeDiscard?.checked;
    restoreScrollRow.style.display = isPage ? '' : 'none';
    // Highlight the chosen card without relying on :has() (Chrome 105+)
    suspendModePage?.closest('.method-card')?.classList.toggle('selected', isPage);
    suspendModeDiscard?.closest('.method-card')?.classList.toggle('selected', !isPage);
}

function getSelectedSuspendMode() {
    return suspendModeDiscard?.checked ? 'discard' : 'page';
}

// Update profile selector UI
function updateProfileSelector() {
    const buttons = profileSelector.querySelectorAll('.profile-btn');
    buttons.forEach(btn => {
        const profile = btn.dataset.profile;
        btn.classList.toggle('active', profile === currentProfile);
    });

    const timeout = PROFILES[currentProfile]?.timeout || 30;
    profileStatus.innerHTML = `Currently: Tabs sleep after <strong>${timeout} minutes</strong>`;
}

// Update protection badges based on toggle states
function updateProtectionBadges() {
    badgeAudio.classList.toggle('active', neverAudio.checked);
    badgeForms.classList.toggle('active', neverForms.checked);
    badgePinned.classList.toggle('active', neverPinned.checked);
    badgeActive.classList.toggle('active', neverActive.checked);
}

// Update timeout display
function updateTimeoutDisplay() {
    if (!timeoutValue || !timeoutSlider) return;
    const value = parseInt(timeoutSlider.value);
    if (value < 60) {
        timeoutValue.textContent = `${value} min`;
    } else {
        timeoutValue.textContent = `${Math.floor(value / 60)} hr`;
    }
}

// Setup event listeners
function setupEventListeners() {
    // Back button
    backBtn?.addEventListener('click', () => {
        window.close();
    });

    // Profile selection
    profileSelector?.addEventListener('click', (e) => {
        const btn = e.target.closest('.profile-btn');
        if (!btn) return;

        const profile = btn.dataset.profile;
        const timeout = parseInt(btn.dataset.timeout);

        currentProfile = profile;
        settings.suspensionTimeout = timeout;

        updateProfileSelector();
        saveSettings();
    });

    // Custom timing slider (PRO)
    timeoutSlider?.addEventListener('input', () => {
        updateTimeoutDisplay();
        debouncedSave();
    });

    // Unlock custom timing button
    unlockCustomTimingBtn?.addEventListener('click', () => {
        openLicenseModal();
    });

    // Customize protection toggle
    customizeProtectionBtn?.addEventListener('click', () => {
        const isExpanded = protectionSettings.style.display !== 'none';
        protectionSettings.style.display = isExpanded ? 'none' : 'block';
        customizeProtectionBtn.classList.toggle('expanded', !isExpanded);
    });

    // Protection toggles
    [neverAudio, neverForms, neverPinned, neverActive, autoRestore].forEach(toggle => {
        toggle?.addEventListener('change', () => {
            updateProtectionBadges();
            debouncedSave();
        });
    });

    // Whitelist - Add current site
    addCurrentSiteBtn?.addEventListener('click', addCurrentSite);

    // Whitelist - Add manual domain
    addDomainBtn?.addEventListener('click', addManualDomain);
    newDomainInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addManualDomain();
    });

    // Suspension method radios
    [suspendModePage, suspendModeDiscard].forEach(radio => {
        radio?.addEventListener('change', () => {
            updateRestoreScrollVisibility();
            debouncedSave();
        });
    });

    // Restore scroll toggle
    restoreScrollToggle?.addEventListener('change', debouncedSave);

    // Min tabs number input: clamp to 0..200 and save
    minTabsInput?.addEventListener('change', () => {
        minTabsInput.value = clampMinTabs(minTabsInput.value);
        debouncedSave();
    });
    minTabsInput?.addEventListener('input', () => {
        if (minTabsInput.value === '') return;
        debouncedSave();
    });

    // URL patterns - add
    addPatternBtn?.addEventListener('click', addPattern);
    newPatternInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addPattern();
        }
    });

    // View stats
    viewStatsBtn?.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('stats-dashboard.html') });
    });

    // Export/Import
    exportBtn?.addEventListener('click', exportSettings);
    importBtn?.addEventListener('click', () => importFile.click());
    importFile?.addEventListener('change', importSettings);

    // License modal
    activateLicenseBtn?.addEventListener('click', openLicenseModal);
    licenseModalClose?.addEventListener('click', closeLicenseModal);
    licenseModal?.addEventListener('click', (e) => {
        if (e.target === licenseModal) closeLicenseModal();
    });
    activateBtn?.addEventListener('click', activateLicense);

    // License input formatting
    licenseInput?.addEventListener('input', formatLicenseInput);
}

// Add current site to whitelist
async function addCurrentSite() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) {
            showToast('Could not get current tab', 'error');
            return;
        }

        const url = new URL(tab.url);
        const domain = url.hostname.replace(/^www\./, '');

        if (domain.startsWith('chrome') || domain.startsWith('about')) {
            showToast('Cannot whitelist browser pages', 'error');
            return;
        }

        await addDomain(domain);
    } catch (error) {
        console.error('Error adding current site:', error);
        showToast('Failed to add current site', 'error');
    }
}

// Add manual domain
function addManualDomain() {
    let domain = newDomainInput.value.trim().toLowerCase();
    if (!domain) {
        showToast('Enter a domain to add', 'error');
        newDomainInput?.focus();
        return;
    }

    // Clean up domain
    domain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

    // Validate
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(domain)) {
        showToast('Invalid domain format', 'error');
        return;
    }

    addDomain(domain);
    newDomainInput.value = '';
}

// Add domain to whitelist
async function addDomain(domain) {
    // Check if already exists
    if (settings.whitelistedDomains?.includes(domain)) {
        showToast('Domain already whitelisted', 'error');
        return;
    }

    // Check whitelist limit for free users
    const currentCount = settings.whitelistedDomains?.length || 0;
    if (!isPro && currentCount >= MAX_BASIC_WHITELIST) {
        showWhitelistLimitModal();
        return;
    }

    try {
        const reply = await chrome.runtime.sendMessage({ type: 'WHITELIST_DOMAIN', domain });
        if (reply && reply.success === false) {
            showToast(reply.error || 'Failed to add domain', 'error');
            return;
        }
        if (reply && reply.limitReached) {
            showWhitelistLimitModal();
            return;
        }
        settings.whitelistedDomains = settings.whitelistedDomains || [];
        settings.whitelistedDomains.push(domain);
        renderWhitelist();
        showToast(`Added ${domain}`, 'success');
    } catch (error) {
        console.error('Failed to add domain:', error);
        showToast('Failed to add domain', 'error');
    }
}

// Remove domain from whitelist
async function removeDomain(domain) {
    try {
        const reply = await chrome.runtime.sendMessage({ type: 'REMOVE_WHITELIST', domain });
        if (reply && reply.success === false) {
            showToast(reply.error || 'Failed to remove domain', 'error');
            return;
        }
        settings.whitelistedDomains = settings.whitelistedDomains.filter(d => d !== domain);
        renderWhitelist();
        showToast(`Removed ${domain}`, 'success');
    } catch (error) {
        console.error('Failed to remove domain:', error);
        showToast('Failed to remove domain', 'error');
    }
}

// Render whitelist
function renderWhitelist() {
    const domains = settings.whitelistedDomains || [];
    const count = domains.length;

    // Update whitelist counter/header
    updateWhitelistHeader(count);

    if (count === 0) {
        whitelistItems.innerHTML = '<div class="whitelist-empty">No domains whitelisted yet</div>';
        return;
    }

    whitelistItems.innerHTML = domains.map(domain => `
        <div class="whitelist-item" data-domain="${escapeHtml(domain)}">
            <span class="whitelist-domain">${escapeHtml(domain)}</span>
            <button class="whitelist-remove" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `).join('');

    // Add remove handlers
    whitelistItems.querySelectorAll('.whitelist-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.whitelist-item');
            const domain = item.dataset.domain;
            removeDomain(domain);
        });
    });
}

// Update whitelist header with counter
function updateWhitelistHeader(count) {
    // Find or create the whitelist counter element
    const section = document.querySelector('.section:has(#whitelistItems)');
    if (!section) return;

    let counterEl = section.querySelector('.whitelist-counter');

    if (!isPro) {
        const remaining = MAX_BASIC_WHITELIST - count;
        const isAtLimit = count >= MAX_BASIC_WHITELIST;
        const isNearLimit = count >= MAX_BASIC_WHITELIST - 1;

        if (!counterEl) {
            counterEl = document.createElement('div');
            counterEl.className = 'whitelist-counter';
            const header = section.querySelector('.section-header');
            if (header) {
                header.appendChild(counterEl);
            }
        }

        counterEl.innerHTML = `
            <span class="counter-text ${isAtLimit ? 'at-limit' : isNearLimit ? 'near-limit' : ''}">${count}/${MAX_BASIC_WHITELIST}</span>
            ${isAtLimit ? '<button class="btn-unlock-whitelist" id="unlockWhitelistBtn">Unlock Unlimited</button>' : ''}
        `;

        // Add click handler for unlock button
        const unlockBtn = counterEl.querySelector('#unlockWhitelistBtn');
        if (unlockBtn) {
            unlockBtn.addEventListener('click', openLicenseModal);
        }
    } else if (counterEl) {
        // Pro user - show unlimited badge
        counterEl.innerHTML = '<span class="counter-text pro">Unlimited</span>';
    }
}

// Show whitelist limit modal
function showWhitelistLimitModal() {
    // Create modal if it doesn't exist
    let modal = document.getElementById('whitelistLimitModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'whitelistLimitModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <button class="modal-close" id="whitelistLimitModalClose">×</button>
                <div class="modal-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
                <h2 class="modal-title">Whitelist Limit Reached</h2>
                <p class="modal-desc">Basic users can whitelist up to ${MAX_BASIC_WHITELIST} sites. Upgrade to Pro for <strong>unlimited whitelists</strong> and more!</p>
                <div class="limit-benefits">
                    <div class="benefit-item">Unlimited whitelisted sites</div>
                    <div class="benefit-item">Custom suspension timing</div>
                    <div class="benefit-item">Focus Mode with no session cap</div>
                </div>
                <button id="upgradeFromWhitelistBtn" class="btn-primary">Unlock Pro Features</button>
                <p class="modal-hint">Or remove a site to add a new one</p>
            </div>
        `;
        document.body.appendChild(modal);

        // Add event listeners
        modal.querySelector('#whitelistLimitModalClose').addEventListener('click', () => {
            modal.style.display = 'none';
        });
        modal.querySelector('#upgradeFromWhitelistBtn').addEventListener('click', () => {
            modal.style.display = 'none';
            openLicenseModal();
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    }

    modal.style.display = 'flex';
}

// Validate one URL pattern. Returns { ok, value } or { ok, error }.
function validatePattern(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return { ok: false, error: 'Enter a URL pattern to add' };
    if (value.length > PATTERN_MAX_LENGTH) return { ok: false, error: `Patterns are limited to ${PATTERN_MAX_LENGTH} characters` };
    if (!/[a-z]/i.test(value)) return { ok: false, error: 'A pattern needs at least one letter' };
    return { ok: true, value };
}

// Add a URL pattern (Pro only)
function addPattern() {
    if (!isPro) {
        openLicenseModal();
        return;
    }

    const result = validatePattern(newPatternInput?.value);
    if (!result.ok) {
        showToast(result.error, 'error');
        newPatternInput?.focus();
        return;
    }

    const patterns = settings.urlPatterns || [];
    const lower = result.value.toLowerCase();
    if (patterns.some(p => p.toLowerCase() === lower)) {
        showToast('Pattern already added', 'error');
        return;
    }

    settings.urlPatterns = [...patterns, result.value];
    if (newPatternInput) newPatternInput.value = '';
    renderPatterns();
    saveSettings();
}

// Remove a URL pattern by index
function removePattern(index) {
    const patterns = settings.urlPatterns || [];
    if (index < 0 || index >= patterns.length) return;
    settings.urlPatterns = patterns.filter((_, i) => i !== index);
    renderPatterns();
    saveSettings();
}

// Render the URL pattern list and the Pro lock
function renderPatterns() {
    if (!patternItems) return;
    const patterns = settings.urlPatterns || [];

    updatePatternsHeader(patterns.length);

    if (patterns.length === 0) {
        patternItems.innerHTML = `<div class="whitelist-empty">${isPro ? 'No URL patterns yet' : 'URL patterns are a Pro feature'}</div>`;
        return;
    }

    patternItems.innerHTML = patterns.map((pattern, index) => `
        <div class="whitelist-item" data-index="${index}">
            <span class="pattern-text" title="${escapeHtml(pattern)}">${escapeHtml(pattern)}</span>
            <button class="whitelist-remove" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `).join('');

    patternItems.querySelectorAll('.whitelist-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.whitelist-item');
            removePattern(parseInt(item.dataset.index, 10));
        });
    });
}

// Pro gate for URL patterns: same look as the whitelist cap. Free users see
// the section with the input disabled, a "Pro" label and an Unlock button.
function updatePatternsHeader(count) {
    if (!patternsCounter) return;

    if (!isPro) {
        patternsCounter.innerHTML = `
            <span class="counter-text locked">Pro</span>
            <button class="btn-unlock-whitelist" id="unlockPatternsBtn">Unlock Pro</button>
        `;
        patternsCounter.querySelector('#unlockPatternsBtn')?.addEventListener('click', openLicenseModal);
        if (newPatternInput) newPatternInput.disabled = true;
        if (addPatternBtn) addPatternBtn.disabled = true;
        urlPatternsSection?.classList.add('locked');
    } else {
        patternsCounter.innerHTML = `<span class="counter-text pro">${count === 0 ? 'Unlimited' : `${count} - Unlimited`}</span>`;
        if (newPatternInput) newPatternInput.disabled = false;
        if (addPatternBtn) addPatternBtn.disabled = false;
        urlPatternsSection?.classList.remove('locked');
    }
}

// Debounced save
let saveTimeout;
function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveSettings, 500);
}

// Save settings
async function saveSettings() {
    try {
        // Fresh copy from the background first: a site whitelisted with Alt+W,
        // the popup or the context menu while this page was open must survive.
        // Only the fields this page edits are sent; the whitelist is never sent.
        const freshReply = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        const fresh = (freshReply && freshReply.settings) || {};
        if (Array.isArray(fresh.whitelistedDomains)) settings.whitelistedDomains = fresh.whitelistedDomains;

        const newSettings = {
            suspensionTimeout: isPro ? parseInt(timeoutSlider?.value || 30) : PROFILES[currentProfile].timeout,
            autoUnsuspendOnFocus: autoRestore?.checked ?? true,
            neverSuspendAudio: neverAudio?.checked ?? true,
            neverSuspendUnsavedForms: neverForms?.checked ?? true,
            suspendPinnedTabs: !(neverPinned?.checked ?? true),
            neverSuspendActiveTab: neverActive?.checked ?? true,
            suspendMode: getSelectedSuspendMode(),
            restoreScroll: restoreScrollToggle?.checked ?? DEFAULT_RESTORE_SCROLL,
            minTabsToSuspend: clampMinTabs(minTabsInput && minTabsInput.value !== '' ? minTabsInput.value : settings.minTabsToSuspend),
            urlPatterns: Array.isArray(settings.urlPatterns) ? settings.urlPatterns : []
        };

        const reply = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: newSettings });
        if (reply && reply.success === false) {
            showToast(reply.error || 'Failed to save settings', 'error');
            await loadSettings();
            updateUI();
            return;
        }
        settings = { ...settings, ...fresh, ...newSettings };
        renderWhitelist();
        showToast('Settings saved', 'success');
    } catch (error) {
        console.error('Failed to save settings:', error);
        showToast('Failed to save settings', 'error');
    }
}

// Export settings
function exportSettings() {
    const exportData = {
        ...applyNewKeyDefaults({ ...settings }),
        exportedAt: new Date().toISOString(),
        version: chrome.runtime.getManifest().version
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tab-suspender-pro-settings.json';
    a.click();
    URL.revokeObjectURL(url);

    showToast('Settings exported', 'success');
}

// Import settings
async function importSettings(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const imported = JSON.parse(text);

        // Validate
        const validSettings = validateImportedSettings(imported);
        if (Object.keys(validSettings).length === 0) {
            showToast('No valid settings found', 'error');
            return;
        }

        const reply = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: validSettings });
        if (reply && reply.success === false) {
            showToast(reply.error || 'Failed to import settings', 'error');
            return;
        }
        settings = { ...settings, ...validSettings };
        updateUI();
        showToast('Settings imported', 'success');
    } catch (error) {
        console.error('Failed to import settings:', error);
        showToast('Failed to import settings', 'error');
    }

    importFile.value = '';
}

// Validate imported settings
function validateImportedSettings(imported) {
    const valid = {};

    if (typeof imported.suspensionTimeout === 'number' && imported.suspensionTimeout >= 1 && imported.suspensionTimeout <= 120) {
        valid.suspensionTimeout = imported.suspensionTimeout;
    }

    const booleanKeys = ['autoUnsuspendOnFocus', 'neverSuspendAudio', 'neverSuspendUnsavedForms', 'suspendPinnedTabs', 'neverSuspendActiveTab'];
    booleanKeys.forEach(key => {
        if (typeof imported[key] === 'boolean') {
            valid[key] = imported[key];
        }
    });

    if (Array.isArray(imported.whitelistedDomains)) {
        valid.whitelistedDomains = imported.whitelistedDomains
            .filter(d => typeof d === 'string' && d.trim().length > 0)
            .map(d => d.trim().toLowerCase());
    }

    // 1.0.37 keys. Unknown keys are ignored; wrong types are dropped.
    if (SUSPEND_MODES.includes(imported.suspendMode)) {
        valid.suspendMode = imported.suspendMode;
    }

    if (typeof imported.restoreScroll === 'boolean') {
        valid.restoreScroll = imported.restoreScroll;
    }

    if (typeof imported.minTabsToSuspend === 'number' && Number.isFinite(imported.minTabsToSuspend)) {
        valid.minTabsToSuspend = clampMinTabs(imported.minTabsToSuspend);
    }

    if (Array.isArray(imported.urlPatterns)) {
        const seen = new Set();
        valid.urlPatterns = [];
        imported.urlPatterns.forEach(p => {
            const result = validatePattern(p);
            if (!result.ok) return;
            const key = result.value.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            valid.urlPatterns.push(result.value);
        });
    }

    return valid;
}

// License modal functions
function openLicenseModal() {
    if (licenseModal) licenseModal.style.display = 'flex';
    if (licenseInput) {
        licenseInput.value = '';
        licenseInput.focus();
    }
    if (licenseStatus) {
        licenseStatus.textContent = '';
        licenseStatus.className = 'license-status';
    }
}

function closeLicenseModal() {
    if (licenseModal) licenseModal.style.display = 'none';
}

function formatLicenseInput(e) {
    let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // A key pasted twice over its own prefix arrives as ZOVO-ZOVO-...
    if (value.length > 20 && value.startsWith('ZOVOZOVO')) value = value.substring(4);
    value = value.slice(0, value.startsWith('ZOVO') ? 20 : 16);

    // Format as ZOVO-XXXX-XXXX-XXXX-XXXX
    e.target.value = (value.match(/.{1,4}/g) || []).join('-');
}

async function activateLicense() {
    let key = licenseInput?.value?.trim().toUpperCase() || '';
    // People often paste the key without its ZOVO- prefix.
    if (/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key) && !key.startsWith('ZOVO-')) {
        key = 'ZOVO-' + key;
    }

    // Accept only the canonical ZOVO-XXXX-XXXX-XXXX-XXXX shape (same check the
    // popup uses). The server is still the authority; this just rejects garbage
    // before the request.
    if (!/^ZOVO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
        if (licenseStatus) {
            licenseStatus.textContent = 'Please enter a valid license key';
            licenseStatus.className = 'license-status error';
        }
        return;
    }

    if (activateBtn) activateBtn.disabled = true;
    if (licenseStatus) {
        licenseStatus.textContent = 'Verifying...';
        licenseStatus.className = 'license-status';
    }

    try {
        // Try to verify with backend (use same endpoint as background.js)
        const response = await fetch('https://zgubxqomnbmxgbdhvwja.supabase.co/functions/v1/verify-extension-license', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: key, extension: 'tab_suspender_pro' })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.valid) {
                await chrome.storage.local.set({ isPro: true, licenseKey: key, verifiedAt: Date.now() });
                isPro = true;

                if (licenseStatus) {
                    licenseStatus.textContent = 'License activated successfully!';
                    licenseStatus.className = 'license-status success';
                }

                // Update UI (with null checks)
                if (licensePrompt) licensePrompt.style.display = 'none';
                if (licenseActive) licenseActive.style.display = 'flex';
                if (licenseKeyDisplay) licenseKeyDisplay.textContent = maskLicenseKey(key);
                if (unlockCustomTimingBtn) unlockCustomTimingBtn.style.display = 'none';
                if (customTimingSlider) customTimingSlider.style.display = 'flex';
                renderWhitelist();
                renderPatterns();

                showToast('Pro features unlocked!', 'success');

                setTimeout(closeLicenseModal, 1500);
            } else {
                if (licenseStatus) {
                    licenseStatus.textContent = data.message || 'Invalid license key';
                    licenseStatus.className = 'license-status error';
                }
            }
        } else {
            // Unknown keys come back as 4xx with {valid:false}. That is an
            // answer about the key, not a connection problem.
            const errorData = await response.json().catch(() => ({}));
            if (response.status < 500 && response.status !== 429 && errorData.valid === false) {
                if (licenseStatus) {
                    licenseStatus.textContent = "We couldn't find that key. Check it against your purchase email.";
                    licenseStatus.className = 'license-status error';
                }
                if (activateBtn) activateBtn.disabled = false;
                return;
            }
            throw new Error('Server error');
        }
    } catch (error) {
        // Fail closed. A key is Pro only when the server confirms it - never
        // grant Pro just because the request could not reach the server, or the
        // check could be bypassed by going offline.
        if (licenseStatus) {
            licenseStatus.textContent = 'Could not reach the license server. Check your connection and try again.';
            licenseStatus.className = 'license-status error';
        }
    }

    if (activateBtn) activateBtn.disabled = false;
}

// Helper functions
function maskLicenseKey(key) {
    if (!key || key.length < 8) return key;
    return key.slice(0, 4) + '-****-****-****';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function showToast(message, type = 'info') {
    toastMessage.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Force save on unload
window.addEventListener('beforeunload', () => {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveSettings();
    }
});
