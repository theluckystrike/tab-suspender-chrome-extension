/**
 * Tab Suspender Pro - Background Service Worker
 * Simplified, bulletproof version
 */

console.log('[BG] Tab Suspender Pro: Background starting...');

// ============================================================================
// SERVICE WORKER CONTEXT VALIDATION
// ============================================================================

/**
 * Check if the extension context is still valid.
 * In Manifest V3, service workers can be terminated at any time.
 * This helper ensures we don't try to use chrome APIs when the context is invalid.
 * @returns {boolean} True if the extension context is valid
 */
function isExtensionContextValid() {
    try {
        // chrome.runtime.id is undefined when the context is invalidated
        return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG = {
    suspensionTimeout: 30,
    autoUnsuspendOnFocus: true,
    suspendPinnedTabs: false,
    whitelistedDomains: [],  // FIXED: Empty by default, user adds their own
    neverSuspendAudio: true,
    neverSuspendActiveTab: true,
    neverSuspendUnsavedForms: true,
    memoryThreshold: 80,
    // 1.0.37 additions. Every default keeps the pre-1.0.37 behaviour.
    suspendMode: 'page',        // 'page' | 'discard'
    restoreScroll: true,        // page mode only
    urlPatterns: [],            // wildcard patterns matched against the full URL
    minTabsToSuspend: 0         // 0 = always auto-suspend
};

let config = { ...DEFAULT_CONFIG };

// Settings objects written by older versions lack the new keys, and imports can
// carry wrong types. Merge over the defaults and coerce so nothing downstream throws.
function normalizeConfig(raw) {
    const merged = { ...DEFAULT_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) };
    if (!Array.isArray(merged.whitelistedDomains)) merged.whitelistedDomains = [];
    if (!Array.isArray(merged.urlPatterns)) merged.urlPatterns = [];
    merged.urlPatterns = merged.urlPatterns.filter(p => typeof p === 'string' && p.trim()).map(p => p.trim());
    if (merged.suspendMode !== 'discard') merged.suspendMode = 'page';
    merged.restoreScroll = merged.restoreScroll !== false;
    const minTabs = parseInt(merged.minTabsToSuspend, 10);
    merged.minTabsToSuspend = Number.isFinite(minTabs) ? Math.min(200, Math.max(0, minTabs)) : 0;
    const timeout = Number(merged.suspensionTimeout);
    if (!Number.isFinite(timeout) || timeout <= 0) merged.suspensionTimeout = DEFAULT_CONFIG.suspensionTimeout;
    return merged;
}

// Compiled urlPatterns. Rebuilt whenever config changes (loadSettings, SAVE_SETTINGS).
let urlPatternRegexes = [];

// '*' matches any run of characters, but a wildcard in the scheme or host part
// (before the first '/' after '://') never crosses a '/', so
// "*://*.atlassian.net/*" cannot match "https://evil.example/?next=https://x.atlassian.net/".
function compileUrlPattern(pattern) {
    const escape = (text) => text.replace(/[.+?^${}()|[\]\\\/]/g, '\\$&');
    const build = (text, wildcard) => text.split('*').map(escape).join(wildcard);
    const schemeEnd = pattern.indexOf('://');
    // A pattern without a scheme is a loose substring pattern: keep it loose.
    if (schemeEnd < 0) return new RegExp('^' + build(pattern, '.*') + '$', 'i');
    const hostStart = schemeEnd + 3;
    const slash = pattern.indexOf('/', hostStart);
    const head = slash >= 0 ? pattern.slice(0, slash) : pattern;
    const tail = slash >= 0 ? pattern.slice(slash) : '';
    return new RegExp('^' + build(head, '[^/]*') + build(tail, '.*') + '$', 'i');
}

function rebuildUrlPatternCache() {
    urlPatternRegexes = [];
    for (const pattern of config.urlPatterns || []) {
        try {
            urlPatternRegexes.push(compileUrlPattern(pattern));
        } catch (error) {
            console.warn('[BG][PATTERNS] Skipping invalid pattern:', pattern, error && error.message);
        }
    }
}

// ============================================================================
// STATE
// ============================================================================

// Note: Using chrome.alarms API instead of setTimeout for MV3 service worker persistence
// Tab activity times are stored in chrome.storage.session for persistence across SW restarts
const ALARM_PREFIX = 'suspend-tab-';
const LICENSE_CHECK_ALARM = 'license-recheck';
// Our own suspended page. Only a URL that starts with this counts as suspended
// (a web page whose address merely contains "suspended.html" does not).
const SUSPENDED_URL = chrome.runtime.getURL('suspended.html');
// Tab ledger (chrome.storage.local `tabLedger`): every filed tab is written
// here first so a crash or an update can never lose it.
const LEDGER_KEY = 'tabLedger';
const LEDGER_MAX_ENTRIES = 300;
const LEDGER_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const LEDGER_OPEN_MAX = 50;
// The two lists live in their own sync keys (the single settings item has an
// 8 KB cap). A list above SYNC_LIST_LIMIT bytes falls back to storage.local.
const LIST_SYNC_KEYS = { whitelistedDomains: 'tspWhitelist', urlPatterns: 'tspPatterns' };
const SYNC_LIST_LIMIT = 7000;
// origin + path + query of each tab's last known URL, to tell a hash-only
// change from a real navigation. In memory only; refilled on wake.
const tabUrlMemo = new Map();
// Periodic safety net: catches idle tabs whose per-tab alarm was lost.
const SWEEP_ALARM = 'sweep';
const SWEEP_PERIOD_MINUTES = 1;
// How long a pendingScroll entry stays valid (ms).
const PENDING_SCROLL_MAX_AGE = 2 * 60 * 1000;
// How long background waits for a page to answer before giving up (ms).
const TAB_MESSAGE_TIMEOUT = 300;

// ============================================================================
// SESSION STATE HELPERS (chrome.storage.session, local fallback)
// Keys: discardedByUs {tabId: {url, time}}, tabExempt {tabId: true},
//       pendingScroll {tabId: {url, x, y, at}}
// ============================================================================

async function getSessionObject(key) {
    try {
        const result = await chrome.storage.session.get(key);
        return (result && result[key]) || {};
    } catch (error) {
        try {
            const result = await chrome.storage.local.get(key);
            return (result && result[key]) || {};
        } catch (fallbackError) {
            return {};
        }
    }
}

async function setSessionObject(key, value) {
    try {
        await chrome.storage.session.set({ [key]: value });
    } catch (error) {
        try {
            await chrome.storage.local.set({ [key]: value });
        } catch (fallbackError) {
            console.warn(`[BG][SESSION] Failed to store ${key}:`, fallbackError.message);
        }
    }
}

// Every read-modify-write of a session map goes through here, one promise
// chain per key, so concurrent alarms / messages can never drop each other's
// entries. `mutator(obj)` edits in place; returning false skips the write.
const sessionMapChains = new Map();
function withSessionMap(key, mutator) {
    const previous = sessionMapChains.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
        const obj = await getSessionObject(key);
        const result = await mutator(obj);
        if (result !== false) await setSessionObject(key, obj);
        return result;
    });
    sessionMapChains.set(key, run);
    return run;
}

async function deleteSessionEntry(key, tabId) {
    return withSessionMap(key, (obj) => {
        if (obj[tabId] === undefined) return false;
        delete obj[tabId];
        return true;
    });
}

// Send a message to a tab and resolve with the reply, or null after `timeoutMs`
// or on any error (no content script, tab gone, page still loading).
function sendTabMessageWithTimeout(tabId, message, timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) { settled = true; resolve(null); }
        }, timeoutMs);
        try {
            chrome.tabs.sendMessage(tabId, message).then((reply) => {
                if (!settled) { settled = true; clearTimeout(timer); resolve(reply === undefined ? null : reply); }
            }).catch(() => {
                if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
            });
        } catch (error) {
            if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
        }
    });
}

// ============================================================================
// PAUSE (chrome.storage.local key pauseUntil, ms epoch or 0)
// ============================================================================

async function getPauseUntil() {
    try {
        const { pauseUntil } = await chrome.storage.local.get('pauseUntil');
        const until = Number(pauseUntil) || 0;
        return until > Date.now() ? until : 0;
    } catch (error) {
        return 0;
    }
}

async function setPauseUntil(until) {
    const value = Number(until) || 0;
    await chrome.storage.local.set({ pauseUntil: value > Date.now() ? value : 0 });
    console.log('[BG][PAUSE] pauseUntil set to', value > Date.now() ? new Date(value).toISOString() : 'off');
}

// ============================================================================
// PER-TAB EXEMPT (this session only)
// ============================================================================

async function isTabExempt(tabId) {
    const tabExempt = await getSessionObject('tabExempt');
    return tabExempt[tabId] === true;
}

async function setTabExempt(tabId, exempt) {
    await withSessionMap('tabExempt', (tabExempt) => {
        if (exempt) {
            tabExempt[tabId] = true;
        } else {
            delete tabExempt[tabId];
        }
    });
    console.log(`[BG][EXEMPT] Tab ${tabId} exempt: ${!!exempt}`);
    if (exempt) {
        // The tab will not be suspended; drop its alarm so the countdown UI is honest.
        await clearTabTimer(tabId);
    } else {
        await startTabTimer(tabId);
    }
    updateExemptMenuState(tabId);
}

// Keep the checkbox in the context menu in step with the active tab.
async function updateExemptMenuState(tabId) {
    try {
        if (tabId === undefined || tabId === null) {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!activeTab) return;
            tabId = activeTab.id;
        }
        const checked = await isTabExempt(tabId);
        chrome.contextMenus.update('tabExemptToggle', { checked }, () => {
            void chrome.runtime.lastError; // menu may not exist yet
        });
    } catch (error) {
        // Non-critical
    }
}

// Track tabs with unsaved form data (persisted in storage for SW restarts)
// Key: tabId, Value: boolean

// ============================================================================
// INITIALIZATION
// ============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[BG] Tab Suspender Pro installed:', details.reason);

    // Verify extension context is valid
    if (!isExtensionContextValid()) {
        console.warn('[BG][INSTALL] Extension context invalid');
        return;
    }

    try {
        // Clean up stale state from previous installs/updates
        if (details.reason === 'update' || details.reason === 'install') {
            console.log('[BG][INSTALL] Cleaning up stale state...');
            await cleanupOrphanedStorageData();
        }

        await loadSettings();
        createContextMenus();

        if (details.reason === 'install') {
            if (isExtensionContextValid()) {
                chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
                await chrome.storage.local.set({
                    memoryStats: { totalSaved: 0, tabsSuspended: 0, history: [] },
                    installDate: Date.now()
                });
            }
        }

        // Membership invitations now appear only through voluntary popup use.
        // The update tab below is release notes first; whats-new.js decides per
        // user whether any Pro section shows, and never for a known member.
        if (details.reason === 'update') {
            await carryRatePromptState();
            await maybeOpenWhatsNew(details.previousVersion);
            await updateLedgerUnmatched();
        }

        await startMonitoring();
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][INSTALL] Context invalidated during installation');
            return;
        }
        console.error('[BG][INSTALL] Error during installation:', error);
    }
});

// ============================================================================
// WHAT'S NEW
// ============================================================================

// Bump only for a release whose notes are worth a tab. Patch builds that keep
// this value never reopen the page.
const WHATS_NEW_RELEASE = '1.0.40';
const WHATS_NEW_QUIET_DAYS = 2;      // skip people who saw onboarding moments ago
const WHATS_NEW_MIN_GAP_DAYS = 30;   // never more than one update tab a month

function compareVersions(a, b) {
    const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
}

// 1.0.40 replaces the 1.0.39 rating prompt (key zovo_rate_prompt) with the kit card (key
// zovo_rate_card). The old answer and show count carry over, so nobody is asked again sooner
// than the old prompt allowed, and an earlier answer ends the new card too.
async function carryRatePromptState() {
    try {
        const { zovo_rate_prompt: old, zovo_rate_card: cur } = await chrome.storage.local.get(['zovo_rate_prompt', 'zovo_rate_card']);
        if (!old || typeof old !== 'object' || cur) return;
        await chrome.storage.local.set({ zovo_rate_card: {
            v: 1, firstSeenAt: old.firstSeenAt, opens: old.opens, shows: old.shows, lastShownAt: old.lastShownAt,
            dismissedAt: old.dismissedAt, supportAt: 0, choice: old.choice, choiceAt: old.choiceAt
        } });
    } catch (error) {
        console.warn('[BG][RATE] Carry-over skipped:', error && error.message);
    }
}

async function maybeOpenWhatsNew(previousVersion) {
    try {
        if (!previousVersion || compareVersions(previousVersion, WHATS_NEW_RELEASE) >= 0) return;
        if (compareVersions(chrome.runtime.getManifest().version, WHATS_NEW_RELEASE) < 0) return;

        // Copies force-installed by an employer get no update tabs.
        const self = await chrome.management.getSelf().catch(() => null);
        if (self && self.installType === 'admin') return;

        const [{ whatsNewOptOut }, local] = await Promise.all([
            chrome.storage.sync.get('whatsNewOptOut'),
            chrome.storage.local.get(['whatsNewShown', 'whatsNewShownAt', 'monetizationNoticeAt', 'installDate', 'zovoLastUpdateTabAt', 'zovoWhatsNewOptOut'])
        ]);
        if (whatsNewOptOut === true || local.zovoWhatsNewOptOut === true) return;
        if (local.whatsNewShown === WHATS_NEW_RELEASE) return;
        // Sprint 1030 rule. One Zovo update tab per 30 days at most. With no stored time we cannot prove that 30 days passed, so we store the time now and open nothing.
        const lastTab = Number(local.zovoLastUpdateTabAt);
        if (!Number.isFinite(lastTab) || lastTab <= 0) {
            await chrome.storage.local.set({ zovoLastUpdateTabAt: Date.now() });
            return;
        }
        if (Date.now() - lastTab < WHATS_NEW_MIN_GAP_DAYS * 864e5) return;
        // 1.0.31-1.0.33 opened an update tab too and stamped monetizationNoticeAt.
        const lastShown = Math.max(Number(local.whatsNewShownAt) || 0, Number(local.monetizationNoticeAt) || 0) || NaN;
        if (Number.isFinite(lastShown) && Date.now() - lastShown < WHATS_NEW_MIN_GAP_DAYS * 864e5) return;
        const installDate = Number(local.installDate);
        if (Number.isFinite(installDate) && Date.now() - installDate < WHATS_NEW_QUIET_DAYS * 864e5) return;

        // Written before the tab opens so a crash can never cause a second tab.
        await chrome.storage.local.set({ whatsNewShown: WHATS_NEW_RELEASE, whatsNewShownAt: Date.now(), zovoLastUpdateTabAt: Date.now() });
        await openWhatsNewTab();
    } catch (error) {
        console.warn('[BG][WHATS_NEW] Skipped:', error && error.message);
    }
}

// Updates often apply while Chrome starts, before any window exists. Then the
// tab waits in whatsNewPending until the first window opens.
async function openWhatsNewTab() {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] }).catch(() => []);
    if (!windows.length) {
        await chrome.storage.local.set({ whatsNewPending: WHATS_NEW_RELEASE });
        return;
    }
    // Clear the pending flag first so a second window event can't open a copy.
    await chrome.storage.local.remove('whatsNewPending');
    try {
        // Background tab: updates often land while Chrome restores a big session.
        await chrome.tabs.create({ url: chrome.runtime.getURL('zovo-whats-new/index.html'), active: false });
    } catch (error) {
        await chrome.storage.local.set({ whatsNewPending: WHATS_NEW_RELEASE });
        console.warn('[BG][WHATS_NEW] Deferred:', error && error.message);
    }
}

// Several windows can open at once after a restart; only one attempt runs at a time.
let whatsNewPendingRun = null;
function openPendingWhatsNew() {
    if (!whatsNewPendingRun) {
        whatsNewPendingRun = openPendingWhatsNewOnce().finally(() => { whatsNewPendingRun = null; });
    }
    return whatsNewPendingRun;
}

async function openPendingWhatsNewOnce() {
    try {
        const { whatsNewPending } = await chrome.storage.local.get('whatsNewPending');
        if (whatsNewPending !== WHATS_NEW_RELEASE) return;
        const { whatsNewOptOut } = await chrome.storage.sync.get('whatsNewOptOut');
        if (whatsNewOptOut === true) {
            await chrome.storage.local.remove('whatsNewPending');
            return;
        }
        await openWhatsNewTab();
    } catch (error) {
        console.warn('[BG][WHATS_NEW] Pending open failed:', error && error.message);
    }
}

chrome.windows.onCreated.addListener((win) => {
    if (win && win.type === 'normal') openPendingWhatsNew();
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('[BG] Tab Suspender Pro starting up');

    // Verify extension context is valid before proceeding
    if (!isExtensionContextValid()) {
        console.warn('[BG][STARTUP] Extension context invalid at startup');
        return;
    }

    try {
        await loadSettings();
        await cleanupOrphanedStorageData(); // Clean up stale data from closed tabs
        await startMonitoring();
        await openPendingWhatsNew();
        await updateBadge();
        await updateLedgerUnmatched();
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][STARTUP] Context invalidated during startup sequence');
            return;
        }
        console.error('[BG][STARTUP] Error during startup:', error);
    }
});

/**
 * Recreate alarms after service worker wakes up.
 * Service workers can be terminated and restarted, so we need to ensure
 * all tabs that should have timers get their alarms recreated.
 */
async function recreateAlarmsAfterWake() {
    if (!isExtensionContextValid()) {
        console.warn('[BG][ALARMS] Extension context invalid, skipping alarm recreation');
        return;
    }

    try {
        console.log('[BG][ALARMS] Checking and recreating alarms after service worker wake...');

        const existingAlarms = await chrome.alarms.getAll();
        const existingAlarmTabIds = new Set(
            existingAlarms
                .filter(a => a.name.startsWith(ALARM_PREFIX))
                .map(a => parseInt(a.name.replace(ALARM_PREFIX, ''), 10))
        );

        const tabs = await chrome.tabs.query({});
        let recreatedCount = 0;

        for (const tab of tabs) {
            if (!isExtensionContextValid()) {
                console.warn('[BG][ALARMS] Context invalidated during alarm recreation');
                return;
            }
            rememberTabUrl(tab.id, tab.url);

            // Skip tabs that already have alarms, internal pages, or suspended pages
            if (existingAlarmTabIds.has(tab.id)) continue;
            if (isInternalPage(tab.url)) continue;
            if (isSuspendedPage(tab.url)) continue;
            if (tab.discarded || tab.status === 'unloaded') continue; // Already out of memory

            // Only the missing alarm is created. A stored activity time is kept
            // and the alarm is scheduled from it, so a wake never restarts the clock.
            await startTabTimer(tab.id, { preserveActivity: true });
            recreatedCount++;
        }

        if (recreatedCount) console.log(`[BG][ALARMS] Recreated ${recreatedCount} missing alarms after service worker wake`);
    } catch (error) {
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][ALARMS] Context invalidated during alarm recreation');
            return;
        }
        console.error('[BG][ALARMS] Error recreating alarms:', error);
    }
}

// Clean up orphaned storage data from tabs that no longer exist
async function cleanupOrphanedStorageData() {
    if (!isExtensionContextValid()) {
        console.warn('[BG][CLEANUP] Extension context invalid, skipping cleanup');
        return;
    }
    try {
        const existingTabs = await chrome.tabs.query({});
        const existingTabIds = new Set(existingTabs.map(t => t.id));

        // Clean up tabLastActivity
        await withSessionMap('tabLastActivity', (tabLastActivity) => {
            for (const tabId of Object.keys(tabLastActivity)) {
                if (!existingTabIds.has(parseInt(tabId, 10))) delete tabLastActivity[tabId];
            }
        });

        // Clean up tabFormStatus
        await withSessionMap('tabFormStatus', (tabFormStatus) => {
            for (const tabId of Object.keys(tabFormStatus)) {
                if (!existingTabIds.has(parseInt(tabId, 10))) delete tabFormStatus[tabId];
            }
        });

        // Clean up the 1.0.37 per-tab session maps
        for (const key of ['discardedByUs', 'tabExempt', 'pendingScroll']) {
            await withSessionMap(key, (obj) => {
                for (const tabId of Object.keys(obj)) {
                    if (!existingTabIds.has(parseInt(tabId, 10))) delete obj[tabId];
                }
            });
        }

        // Clean up orphaned alarms
        const alarms = await chrome.alarms.getAll();
        for (const alarm of alarms) {
            if (alarm.name.startsWith(ALARM_PREFIX)) {
                const tabId = parseInt(alarm.name.replace(ALARM_PREFIX, ''), 10);
                if (!existingTabIds.has(tabId)) {
                    await chrome.alarms.clear(alarm.name);
                    console.log(`[BG][CLEANUP] Cleared orphaned alarm for tab ${tabId}`);
                }
            }
        }

        console.log('[BG][CLEANUP] Orphaned storage data cleaned up');
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][CLEANUP] Context invalidated during cleanup');
            return;
        }
        console.error('[BG][CLEANUP] Failed to clean up orphaned data:', error);
    }
}

// ============================================================================
// SETTINGS
// ============================================================================

async function loadSettings() {
    if (!isExtensionContextValid()) {
        console.warn('[BG][SETTINGS] Extension context invalid, using default config');
        return;
    }
    try {
        const [sync, local] = await Promise.all([
            chrome.storage.sync.get(['tabSuspenderSettings', 'tspWhitelist', 'tspPatterns']),
            chrome.storage.local.get(['tspWhitelist', 'tspPatterns', 'tspListsLocal'])
        ]);
        const base = (sync.tabSuspenderSettings && typeof sync.tabSuspenderSettings === 'object')
            ? { ...sync.tabSuspenderSettings } : {};
        let migrate = false;
        for (const [field, key] of Object.entries(LIST_SYNC_KEYS)) {
            if (Array.isArray(local[key])) {
                base[field] = local[key];
            } else if (Array.isArray(sync[key])) {
                base[field] = sync[key];
            } else if (!Array.isArray(base[field])) {
                base[field] = [];
            } else if (base[field].length) {
                // Pre-1.0.37 layout: the list sits inside the single settings item.
                migrate = true;
            }
        }
        config = normalizeConfig(base);
        rebuildUrlPatternCache();
        if (migrate) {
            console.log('[BG][SETTINGS] Migrating whitelist / patterns to their own sync keys');
            await saveSettings();
        }
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][SETTINGS] Context invalidated during load, using defaults');
            return;
        }
        console.error('[BG] Failed to load settings:', error);
    }
}

// Throws on a quota error so message handlers can answer {success:false, error}.
async function saveSettings() {
    const { whitelistedDomains, urlPatterns, ...rest } = config;
    const lists = { whitelistedDomains, urlPatterns };
    const syncWrite = { tabSuspenderSettings: rest };
    const localWrite = {};
    const syncRemove = [];
    const localRemove = [];
    let anyLocal = false;
    for (const [field, key] of Object.entries(LIST_SYNC_KEYS)) {
        const list = Array.isArray(lists[field]) ? lists[field] : [];
        const bytes = new TextEncoder().encode(JSON.stringify(list)).length;
        if (bytes > SYNC_LIST_LIMIT) {
            localWrite[key] = list;
            syncRemove.push(key);
            anyLocal = true;
        } else {
            syncWrite[key] = list;
            localRemove.push(key);
        }
    }
    if (anyLocal) localWrite.tspListsLocal = true; else localRemove.push('tspListsLocal');
    try {
        await chrome.storage.sync.set(syncWrite);
        if (syncRemove.length) await chrome.storage.sync.remove(syncRemove);
        if (Object.keys(localWrite).length) await chrome.storage.local.set(localWrite);
        if (localRemove.length) await chrome.storage.local.remove(localRemove);
    } catch (error) {
        console.error('[BG] Failed to save settings:', error);
        throw error;
    }
}

// ============================================================================
// CONTEXT MENUS
// ============================================================================

function createContextMenus() {
    try {
        chrome.contextMenus.removeAll(() => {
            chrome.contextMenus.create({
                id: 'suspendTab',
                title: 'Suspend this tab',
                contexts: ['page']
            });

            chrome.contextMenus.create({
                id: 'suspendOthers',
                title: 'Suspend other tabs',
                contexts: ['page']
            });

            chrome.contextMenus.create({
                id: 'whitelistSite',
                title: 'Never suspend this site',
                contexts: ['page']
            });

            chrome.contextMenus.create({
                id: 'restoreAll',
                title: 'Restore all tabs',
                contexts: ['page']
            });

            chrome.contextMenus.create({
                id: 'tabExemptToggle',
                type: 'checkbox',
                checked: false,
                title: "Don't suspend this tab (this session)",
                contexts: ['page']
            });
        });
    } catch (error) {
        console.error('[BG] Failed to create context menus:', error);
    }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
        switch (info.menuItemId) {
            case 'suspendTab':
                await suspendTab(tab.id, { manual: true });
                break;
            case 'suspendOthers':
                await suspendAllExcept(tab.id);
                break;
            case 'whitelistSite':
                await whitelistCurrentSite(tab);
                break;
            case 'restoreAll':
                await restoreAllTabs();
                break;
            case 'tabExemptToggle':
                if (tab && tab.id !== undefined) {
                    await setTabExempt(tab.id, info.checked === true);
                }
                break;
        }
    } catch (error) {
        console.error('[BG] Context menu action failed:', error);
    }
});

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

chrome.commands.onCommand.addListener(async (command) => {
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        switch (command) {
            case 'suspend_current':
                if (activeTab) await suspendTab(activeTab.id, { manual: true });
                break;
            case 'suspend_others':
                if (activeTab) await suspendAllExcept(activeTab.id);
                break;
            case 'restore_all':
                await restoreAllTabs();
                break;
            case 'whitelist_site':
                if (activeTab) await whitelistCurrentSite(activeTab);
                break;
        }
    } catch (error) {
        console.error('[BG] Command failed:', error);
    }
});

// ============================================================================
// TAB MONITORING  
// ============================================================================

async function startMonitoring() {
    if (!isExtensionContextValid()) {
        console.warn('[BG][TIMER] Extension context invalid, skipping monitoring start');
        return;
    }
    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            // Re-check context validity in loop as it can become invalid mid-operation
            if (!isExtensionContextValid()) {
                console.warn('[BG][TIMER] Context invalidated during tab iteration');
                return;
            }
            rememberTabUrl(tab.id, tab.url);
            if (!isInternalPage(tab.url) && !isSuspendedPage(tab.url) && !tab.discarded && tab.status !== 'unloaded') {
                await startTabTimer(tab.id);
            }
        }
        await ensureSweepAlarm();
        console.log(`[BG][TIMER] Started monitoring ${tabs.length} tabs`);
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][TIMER] Context invalidated during monitoring start');
            return;
        }
        console.error('[BG] Failed to start monitoring:', error);
    }
}

// options.preserveActivity: keep the stored activity time (service-worker wake)
// and schedule the alarm from it instead of restarting the full timeout.
async function startTabTimer(tabId, options = {}) {
    // Check extension context is valid
    if (!isExtensionContextValid()) {
        console.warn(`[BG][TIMER] Extension context invalid, skipping timer start for tab ${tabId}`);
        return;
    }

    // Verify tab still exists before creating alarm
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
        console.log(`[BG][TIMER] Tab ${tabId} no longer exists, skipping timer start`);
        return;
    }
    // A suspended or internal page never needs an alarm (stops the
    // suspend -> alarm -> refuse -> restart cycle).
    if (isSuspendedPage(tab.url) || isInternalPage(tab.url)) return;

    try {
        await clearTabTimer(tabId);

        const timeoutMinutes = config.suspensionTimeout;
        const alarmName = `${ALARM_PREFIX}${tabId}`;
        let delayInMinutes = timeoutMinutes;

        if (options.preserveActivity) {
            const stored = await getStoredTabActivity(tabId);
            if (stored) {
                const elapsedMinutes = (Date.now() - stored) / 60000;
                delayInMinutes = Math.max(1, timeoutMinutes - elapsedMinutes);
            } else {
                await updateTabActivity(tabId);
            }
        } else {
            // Store last activity time in storage (persists across SW restarts)
            await updateTabActivity(tabId);
        }

        // Create alarm using chrome.alarms API (persists across service worker restarts)
        await chrome.alarms.create(alarmName, { delayInMinutes });

        console.log(`[BG][TIMER] Started alarm for tab ${tabId}, will fire in ${Math.round(delayInMinutes)} minutes`);
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn(`[BG][TIMER] Context invalidated during timer start for tab ${tabId}`);
            return;
        }
        console.error(`[BG][TIMER] Failed to start timer for tab ${tabId}:`, error);
    }
}

async function clearTabTimer(tabId) {
    // Gracefully handle errors when clearing timers
    try {
        const alarmName = `${ALARM_PREFIX}${tabId}`;
        await chrome.alarms.clear(alarmName);
    } catch (error) {
        // Ignore errors when clearing - tab may already be gone or context invalid
        if (error.message && !error.message.includes('Extension context invalidated')) {
            console.warn(`[BG][TIMER] Error clearing timer for tab ${tabId}:`, error.message);
        }
    }
}

async function resetTabTimer(tabId) {
    // Check extension context is valid
    if (!isExtensionContextValid()) {
        console.warn(`[BG][TIMER] Extension context invalid, skipping timer reset for tab ${tabId}`);
        return;
    }

    // Verify tab exists before resetting
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
        console.log(`[BG][TIMER] Tab ${tabId} no longer exists, skipping timer reset`);
        // Clean up any orphaned alarm
        await clearTabTimer(tabId);
        return;
    }
    if (isInternalPage(tab.url) || isSuspendedPage(tab.url)) {
        await clearTabTimer(tabId);
        return;
    }

    await updateTabActivity(tabId);
    await startTabTimer(tabId);
}

async function updateTabActivity(tabId) {
    try {
        await withSessionMap('tabLastActivity', (tabLastActivity) => {
            tabLastActivity[tabId] = Date.now();
        });
    } catch (error) {
        // Activity tracking is non-critical
        console.warn(`[BG][TIMER] Failed to update activity for tab ${tabId}:`, error && error.message);
    }
}

async function getTabActivity(tabId) {
    try {
        const result = await chrome.storage.session.get('tabLastActivity');
        const tabLastActivity = result.tabLastActivity || {};
        return tabLastActivity[tabId] || Date.now();
    } catch (error) {
        try {
            const result = await chrome.storage.local.get('tabLastActivity');
            const tabLastActivity = result.tabLastActivity || {};
            return tabLastActivity[tabId] || Date.now();
        } catch (fallbackError) {
            // If both fail, return current time as safe default
            console.warn(`[BG][TIMER] Failed to get activity for tab ${tabId}:`, fallbackError.message);
            return Date.now();
        }
    }
}

// Stored activity time or 0 when there is none (getTabActivity falls back to now).
async function getStoredTabActivity(tabId) {
    try {
        const result = await chrome.storage.session.get('tabLastActivity')
            .catch(() => chrome.storage.local.get('tabLastActivity'));
        const value = Number((result && result.tabLastActivity || {})[tabId]);
        return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (error) {
        return 0;
    }
}

// origin + path + query (no hash) of a URL, or '' for anything unparsable.
function urlDocumentKey(url) {
    try {
        const u = new URL(url);
        return u.origin + u.pathname + u.search;
    } catch (error) {
        return '';
    }
}

function rememberTabUrl(tabId, url) {
    if (url) tabUrlMemo.set(tabId, urlDocumentKey(url));
}

// Track form status for tabs (unsaved form data)
async function updateTabFormStatus(tabId, hasUnsavedForms) {
    await withSessionMap('tabFormStatus', (tabFormStatus) => {
        if (hasUnsavedForms) tabFormStatus[tabId] = true;
        else delete tabFormStatus[tabId];
    });
    console.log(`[BG][FORMS] Tab ${tabId} form status: ${hasUnsavedForms ? 'has unsaved data' : 'clean'}`);
}

async function getTabFormStatus(tabId) {
    try {
        const result = await chrome.storage.session.get('tabFormStatus');
        const tabFormStatus = result.tabFormStatus || {};
        return tabFormStatus[tabId] || false;
    } catch (error) {
        const result = await chrome.storage.local.get('tabFormStatus');
        const tabFormStatus = result.tabFormStatus || {};
        return tabFormStatus[tabId] || false;
    }
}

async function clearTabFormStatus(tabId) {
    await deleteSessionEntry('tabFormStatus', tabId);
}

// Chrome Alarms listener - fires when a tab should be suspended or license check
chrome.alarms.onAlarm.addListener(async (alarm) => {
    // Check extension context is valid before processing alarms
    if (!isExtensionContextValid()) {
        console.warn('[BG][TIMER] Extension context invalid, skipping alarm processing');
        return;
    }

    // Handle license check alarm
    if (alarm.name === LICENSE_CHECK_ALARM) {
        console.log('[BG][LICENSE] Background license check triggered');
        await backgroundLicenseCheck();
        return;
    }

    if (alarm.name === SWEEP_ALARM) {
        await runSweep();
        return;
    }

    if (!alarm.name.startsWith(ALARM_PREFIX)) return;

    const tabId = parseInt(alarm.name.replace(ALARM_PREFIX, ''), 10);
    console.log(`[BG][TIMER] Alarm fired for tab ${tabId}`);

    try {
        // Validate tab still exists and hasn't been reused (Chrome can reuse tab IDs)
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
            console.log(`[BG][TIMER] Tab ${tabId} no longer exists, cleaning up`);
            // Clean up all orphaned data for this tab
            await chrome.alarms.clear(alarm.name).catch(() => {});
            await clearTabFormStatus(tabId);
            await deleteSessionEntry('tabLastActivity', tabId).catch(() => {});
            return;
        }

        // Check if the tab URL matches what we expect (prevents reused tab ID issues)
        const storedActivity = await getTabActivity(tabId);
        const timeSinceActivity = Date.now() - storedActivity;
        const expectedTimeout = config.suspensionTimeout * 60 * 1000;

        // If activity is very recent, the tab ID was likely reused - don't suspend
        if (timeSinceActivity < expectedTimeout * 0.5) {
            console.log(`[BG][TIMER] Tab ${tabId} has recent activity, likely reused ID - restarting timer`);
            await startTabTimer(tabId);
            return;
        }

        await autoSuspendTab(tabId, 'TIMER');
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn(`[BG][TIMER] Context invalidated during alarm processing for tab ${tabId}`);
            return;
        }
        console.error(`[BG][TIMER] Auto-suspend failed for tab ${tabId}:`, error);
    }
});

// Shared automatic path (per-tab alarm and sweep). Manual suspension never goes
// through here, so pause / minTabsToSuspend / tabExempt only apply to timers.
// `openTabs` lets the sweep pass its single tabs.query result in.
async function autoSuspendTab(tabId, source, openTabs = null) {
    if (await getPauseUntil()) {
        console.log(`[BG][${source}] Paused, restarting timer for tab ${tabId}`);
        await startTabTimer(tabId);
        return false;
    }

    if (config.minTabsToSuspend > 0) {
        const count = await countSuspendableTabs(openTabs);
        if (count <= config.minTabsToSuspend) {
            console.log(`[BG][${source}] Only ${count} open tabs (min ${config.minTabsToSuspend}), restarting timer for tab ${tabId}`);
            await startTabTimer(tabId);
            return false;
        }
    }

    // shouldSuspendTab returns false on any error, but handle all falsy values explicitly
    const canSuspend = await shouldSuspendTab(tabId);
    if (canSuspend === true) {
        const suspended = await suspendTab(tabId);
        if (suspended) {
            console.log(`[BG][${source}] Auto-suspended tab ${tabId}`);
            return true;
        }
        console.log(`[BG][${source}] Tab ${tabId} suspension failed (suspendTab returned false)`);
        await startTabTimer(tabId);
        return false;
    }

    console.log(`[BG][${source}] Tab ${tabId} cannot be suspended (active/whitelisted/etc)`);
    // Restart timer for tabs that can't be suspended now but might later
    // (e.g., active tab that becomes inactive, audible tab that stops playing)
    await startTabTimer(tabId);
    return false;
}

// Open, non-internal, non-suspended, non-discarded tabs across all windows.
async function countSuspendableTabs(tabs = null) {
    const list = tabs || await chrome.tabs.query({});
    return list.filter(t => !isInternalPage(t.url) && !isSuspendedPage(t.url) && !t.discarded && t.status !== 'unloaded').length;
}

async function ensureSweepAlarm() {
    try {
        const existing = await chrome.alarms.get(SWEEP_ALARM);
        if (!existing) {
            await chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: SWEEP_PERIOD_MINUTES });
            console.log('[BG][SWEEP] Sweep alarm created');
        }
    } catch (error) {
        console.warn('[BG][SWEEP] Failed to create sweep alarm:', error && error.message);
    }
}

// Once a minute: suspend idle tabs that lost their per-tab alarm. Cost is one
// tabs.query, one alarms.getAll and one storage read; the suspend checks only
// run for the rare tab that is both alarm-less and past the timeout.
async function runSweep() {
    if (!isExtensionContextValid()) return;
    try {
        const timeoutMs = config.suspensionTimeout * 60 * 1000;
        const now = Date.now();

        const [tabs, alarms, activityResult] = await Promise.all([
            chrome.tabs.query({}),
            chrome.alarms.getAll(),
            chrome.storage.session.get('tabLastActivity').catch(() => chrome.storage.local.get('tabLastActivity'))
        ]);
        const tabLastActivity = (activityResult && activityResult.tabLastActivity) || {};
        const alarmTabIds = new Set(
            alarms.filter(a => a.name.startsWith(ALARM_PREFIX))
                  .map(a => parseInt(a.name.replace(ALARM_PREFIX, ''), 10))
        );

        const candidates = [];
        for (const tab of tabs) {
            if (alarmTabIds.has(tab.id)) continue;
            if (tab.active || tab.discarded || tab.status === 'unloaded') continue;
            if (isInternalPage(tab.url) || isSuspendedPage(tab.url)) continue;

            // tab.lastAccessed exists from Chrome 121; take whichever is more recent.
            let lastActive = Number(tabLastActivity[tab.id]) || 0;
            if (typeof tab.lastAccessed === 'number' && tab.lastAccessed > lastActive) {
                lastActive = tab.lastAccessed;
            }
            if (!lastActive) {
                // No idle information at all: give it a timer instead of guessing.
                await startTabTimer(tab.id);
                continue;
            }
            if (now - lastActive >= timeoutMs) candidates.push(tab.id);
        }

        if (!candidates.length) return;
        console.log(`[BG][SWEEP] ${candidates.length} idle tab(s) without alarm`);
        const done = new Set();
        for (const tabId of candidates) {
            if (!isExtensionContextValid()) return;
            // Keep the min-tabs count honest without a second tabs.query.
            const ok = await autoSuspendTab(tabId, 'SWEEP', tabs.filter(t => !done.has(t.id)));
            if (ok) done.add(tabId);
        }
    } catch (error) {
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            return;
        }
        console.error('[BG][SWEEP] Sweep failed:', error);
    }
}

// ============================================================================
// TAB EVENT LISTENERS
// ============================================================================

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        // First verify the tab still exists (handles race condition where tab is closed
        // between activation event firing and handler execution)
        const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
        if (!tab) {
            // Tab was closed before we could process it - this is expected, not an error
            return;
        }

        if (isInternalPage(tab.url) || isSuspendedPage(tab.url)) {
            // Extension / browser pages never get a timer (their alarms were
            // waking the worker and restarting every countdown).
            await clearTabTimer(activeInfo.tabId);
        } else {
            await resetTabTimer(activeInfo.tabId);
        }
        updateExemptMenuState(activeInfo.tabId);

        if (config.autoUnsuspendOnFocus && isSuspendedPage(tab.url)) {
            await restoreTab(activeInfo.tabId);
        }
    } catch (error) {
        // Only log unexpected errors, not "No tab with id" which is a known race condition
        if (!error.message?.includes('No tab with id')) {
            console.error('[BG] Tab activation handler failed:', error);
        }
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Note: Stats are tracked in:
    // - background.js suspendTab() for auto-suspend and message-based suspend
    // - popup.js updateMemoryStatsLocal() for direct popup suspensions
    // Do NOT add stats tracking here - it would cause double-counting

    // Handle URL changes (including SPA navigation via history API)
    if (changeInfo.url) {
        if (isInternalPage(changeInfo.url) || isSuspendedPage(changeInfo.url)) {
            // Tab navigated to internal/suspended page - clear any existing alarm
            rememberTabUrl(tabId, changeInfo.url);
            await clearTabTimer(tabId);
            await clearTabFormStatus(tabId);
        } else {
            const previousKey = tabUrlMemo.get(tabId);
            const nextKey = urlDocumentKey(changeInfo.url);
            rememberTabUrl(tabId, changeInfo.url);
            // A new document starts clean: the old form flag is meaningless.
            if (changeInfo.status === 'loading') {
                await clearTabFormStatus(tabId);
            }
            // Reset the timer only when origin + path + query changed; a
            // hash-only change (SPA router, anchor) is not activity.
            if (previousKey === undefined || previousKey !== nextKey) {
                await resetTabTimer(tabId);
            }
        }
    }

    // Page load complete: give the tab a timer only if it has none. Resetting
    // here let self-refreshing pages (meta refresh dashboards) never sleep.
    if (changeInfo.status === 'complete' && !isInternalPage(tab.url) && !isSuspendedPage(tab.url)) {
        rememberTabUrl(tabId, tab.url);
        const existing = await chrome.alarms.get(`${ALARM_PREFIX}${tabId}`).catch(() => null);
        if (!existing) await startTabTimer(tabId);
    }

    // Chrome reloaded a tab we discarded (user clicked it): it is no longer "suspended".
    if (changeInfo.discarded === false) {
        const removed = await deleteSessionEntry('discardedByUs', tabId);
        if (removed) {
            console.log(`[BG][DISCARD] Tab ${tabId} reloaded by Chrome, removed from discardedByUs`);
            await startTabTimer(tabId);
        }
    }

    // Suspended-page restores via location.replace do not go through restoreTab's
    // badge update at the right moment, so refresh on every URL / discard change.
    if (changeInfo.url || changeInfo.discarded !== undefined) {
        updateBadge();
    }
});

// Older Chrome versions gave a discarded tab a new id. Carry our entry across.
if (chrome.tabs.onReplaced) {
    chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
        try {
            await withSessionMap('discardedByUs', (discardedByUs) => {
                if (!discardedByUs[removedTabId]) return false;
                discardedByUs[addedTabId] = discardedByUs[removedTabId];
                delete discardedByUs[removedTabId];
            });
        } catch (error) {
            // Non-critical
        }
    });
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
    tabUrlMemo.delete(tabId);
    await clearTabTimer(tabId);

    // Clean up form status to prevent memory leak
    await clearTabFormStatus(tabId);

    // Clean up the per-tab session maps (activity time included)
    for (const key of ['discardedByUs', 'tabExempt', 'pendingScroll', 'tabLastActivity']) {
        await deleteSessionEntry(key, tabId);
    }
    updateBadge();
});

chrome.tabs.onCreated.addListener(async (tab) => {
    if (!isInternalPage(tab.url)) {
        await startTabTimer(tab.id);
    }
});

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        handleMessage(message, sender)
            .then(sendResponse)
            .catch(error => {
                console.error('[BG] Message handling error:', error);
                sendResponse({ error: error.message });
            });
    } catch (error) {
        console.error('[BG] Synchronous message handler error:', error);
        sendResponse({ error: error.message || 'Unknown error' });
    }
    return true;
});

async function handleMessage(message, sender) {
    console.log('[BG] Received message:', message.type);

    try {
        switch (message.type) {
            case 'TAB_ACTIVITY':
                // Safely handle case where sender.tab is undefined (e.g., from popup or other extension pages)
                if (sender.tab && sender.tab.id !== undefined) {
                    await resetTabTimer(sender.tab.id);
                } else {
                    console.warn('[BG] TAB_ACTIVITY received without valid sender.tab');
                }
                return { success: true };

            case 'FORM_STATUS':
                // Track form status for this tab - requires valid sender.tab
                if (sender.tab && sender.tab.id !== undefined) {
                    await updateTabFormStatus(sender.tab.id, message.hasUnsavedForms);
                } else {
                    console.warn('[BG] FORM_STATUS received without valid sender.tab');
                }
                return { success: true };

            case 'CONTENT_SCRIPT_READY':
                // Content script signaling it's ready - may or may not have sender.tab
                if (sender.tab && sender.tab.id !== undefined) {
                    console.log('[BG] Content script ready for tab:', sender.tab.id);
                    // Top frame only: hand back a scroll position saved by SUSPENDED_RESTORING
                    if (!sender.frameId) {
                        const scroll = await takePendingScroll(sender.tab.id, sender.url || sender.tab.url);
                        if (scroll) return { success: true, scroll };
                    }
                }
                return { success: true };

            case 'SUSPENDED_RESTORING':
                // Suspended page is about to location.replace() back to its URL
                if (sender.tab && sender.tab.id !== undefined && message.url) {
                    await storePendingScroll(sender.tab.id, message.url, message.scrollX, message.scrollY);
                }
                return { success: true };

            case 'SET_PAUSE':
                await setPauseUntil(message.until);
                return { success: true, until: await getPauseUntil() };

            case 'GET_PAUSE':
                return { until: await getPauseUntil() };

            case 'SET_TAB_EXEMPT': {
                const exemptTabId = message.tabId !== undefined ? message.tabId : (sender.tab && sender.tab.id);
                if (exemptTabId === undefined || exemptTabId === null) {
                    return { success: false, error: 'Missing tabId' };
                }
                await setTabExempt(exemptTabId, message.exempt === true);
                return { success: true, exempt: message.exempt === true };
            }

            case 'GET_TAB_EXEMPT': {
                const queryTabId = message.tabId !== undefined ? message.tabId : (sender.tab && sender.tab.id);
                if (queryTabId === undefined || queryTabId === null) {
                    return { exempt: false };
                }
                return { exempt: await isTabExempt(queryTabId) };
            }

            case 'SUSPEND_TAB':
                if (message.tabId === undefined) {
                    console.warn('[BG] SUSPEND_TAB received without tabId');
                    return { success: false, error: 'Missing tabId' };
                }
                {
                    const suspendedOk = await suspendTab(message.tabId, { manual: true });
                    return { success: suspendedOk === true };
                }

            case 'RESTORE_TAB':
                if (message.tabId === undefined) {
                    console.warn('[BG] RESTORE_TAB received without tabId');
                    return { success: false, error: 'Missing tabId' };
                }
                await restoreTab(message.tabId);
                return { success: true };

            case 'SUSPEND_ALL':
                const suspended = await suspendAllInactive();
                return { success: true, count: suspended };

            case 'RESTORE_ALL':
                const restored = await restoreAllTabs();
                return { success: true, count: restored };

            case 'GET_TAB_LIST':
                return await getTabList();

            case 'GET_STATS':
                return await getStats();

            case 'GET_SETTINGS':
                return { settings: config };

            case 'SAVE_SETTINGS':
                const oldTimeout = config.suspensionTimeout;
                const previousConfig = config;
                config = normalizeConfig({ ...config, ...(message.settings || {}) });
                rebuildUrlPatternCache();
                try {
                    await saveSettings();
                } catch (saveError) {
                    // Nothing persisted: keep the in-memory config honest.
                    config = previousConfig;
                    rebuildUrlPatternCache();
                    return { success: false, error: storageErrorMessage(saveError) };
                }

                // If timeout changed, restart all tab timers with new value
                if (message.settings.suspensionTimeout !== undefined &&
                    message.settings.suspensionTimeout !== oldTimeout) {
                    console.log(`[BG][SETTINGS] Timeout changed from ${oldTimeout} to ${message.settings.suspensionTimeout}, restarting timers`);
                    await startMonitoring();
                }
                return { success: true };

            case 'WHITELIST_DOMAIN':
                if (typeof message.domain !== 'string' || !message.domain.trim()) {
                    return { success: false, error: 'Missing domain' };
                }
                // success stays true for existing callers; added/limitReached let
                // suspended.html tell the user when the free cap blocked the add.
                {
                    const added = await addToWhitelist(message.domain);
                    return { ...added, success: !added.error };
                }

            case 'REMOVE_WHITELIST':
                return await removeFromWhitelist(message.domain);

            case 'GET_LEDGER':
                return { entries: await getLedger() };

            case 'CLEAR_LEDGER':
                await chrome.storage.local.set({ [LEDGER_KEY]: [], ledgerUnmatched: 0 });
                return { success: true };

            case 'OPEN_LEDGER_URLS':
                return { success: true, opened: await openLedgerUrls(message.urls) };

            case 'LEDGER_ADD':
                // popup.js suspends directly in some paths; it reports the tab here.
                // Only extension pages (no sender.tab) may write the ledger.
                if (!sender.tab && message.tab) await appendLedger(message.tab);
                return { success: true };

            case 'RELOAD_CONFIG':
                // Reload settings from storage (called when popup updates whitelist)
                await loadSettings();
                console.log('[BG][CONFIG] Reloaded settings from storage');
                return { success: true };

            // ========== AGENT 1: COUNTDOWN INDICATOR ==========
            case 'GET_TAB_COUNTDOWN':
                // Return remaining time for a specific tab
                if (message.tabId === undefined) {
                    console.warn('[BG] GET_TAB_COUNTDOWN received without tabId');
                    return { tabId: null, remainingMs: -1, suspendAt: null, isPaused: true };
                }
                return await getTabCountdownHandler(message.tabId);

            case 'GET_ALL_COUNTDOWNS':
                // Return all active countdowns
                return await getAllCountdownsHandler();
            // ========== END AGENT 1 ==========

            // ========== AGENT 2: DASHBOARD SYNC ==========
            case 'REQUEST_STATS_SYNC':
                // Force refresh stats and broadcast to all listeners
                const syncStats = await getStats();
                chrome.runtime.sendMessage({
                    type: 'STATS_UPDATED',
                    stats: syncStats,
                    timestamp: Date.now()
                }).catch(() => {}); // Ignore if no listeners
                return { success: true, stats: syncStats };
            // ========== END AGENT 2 ==========

            default:
                console.warn('[BG] Unknown message type:', message.type);
                return { error: 'Unknown message type' };
        }
    } catch (error) {
        console.error('[BG] Error in handleMessage:', error);
        throw error; // Re-throw to be caught by the outer handler
    }
}

// ============================================================================
// SUSPENSION LOGIC
// ============================================================================

// options.manual: the user asked for this exact tab (shortcut, right-click menu,
// popup message). The "never suspend the active tab" rule exists to stop the
// timer from putting the tab you are reading to sleep, so it must not veto an
// explicit request. Every other protection still applies.
async function shouldSuspendTab(tabId, options = {}) {
    try {
        // Defensive handling: tab may have been closed
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
            console.log(`[BG][SUSPEND] Tab ${tabId} no longer exists`);
            return false;
        }

        if (isInternalPage(tab.url)) return false;
        if (isSuspendedPage(tab.url)) return false;
        if (tab.discarded || tab.status === 'unloaded') return false; // already out of memory
        if (config.neverSuspendActiveTab && tab.active && !options.manual) return false;
        if (!config.suspendPinnedTabs && tab.pinned) return false;
        if (config.neverSuspendAudio && tab.audible) return false;
        if (isWhitelisted(tab.url)) return false;

        // "Don't suspend this tab (this session)" - an explicit request still wins
        if (!options.manual && await isTabExempt(tabId)) {
            console.log(`[BG][EXEMPT] Tab ${tabId} is exempt this session - skipping suspension`);
            return false;
        }

        // HIGH-6: Don't suspend tabs with unsaved form data (only when the option is on)
        if (config.neverSuspendUnsavedForms !== false && await getTabFormStatus(tabId)) {
            console.log(`[BG][FORMS] Tab ${tabId} has unsaved form data - skipping suspension`);
            return false;
        }

        return true;
    } catch (error) {
        console.error('[BG] shouldSuspendTab error:', error);
        return false;
    }
}

async function suspendTab(tabId, options = {}) {
    try {
        const canSuspend = await shouldSuspendTab(tabId, options);
        if (!canSuspend) return false;

        // Defensive handling: tab may have been closed between shouldSuspendTab check and now
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
            console.log(`[BG][SUSPEND] Tab ${tabId} no longer exists, cannot suspend`);
            return false;
        }

        // Discard mode: Chrome drops the renderer, keeps title and favicon, and
        // reloads on click. The active tab is never discarded (it would reload at
        // once); an explicit request on it falls back to page mode instead.
        if (config.suspendMode === 'discard' && !(options.manual && tab.active)) {
            return discardTab(tab);
        }

        // Store the full URL. Extension-page query strings are not limited to
        // 2000 chars, and truncating here silently corrupted long URLs (dropped
        // query/hash) so restore landed on the wrong page.
        const urlToStore = tab.url;

        const params = new URLSearchParams({
            url: urlToStore,
            title: (tab.title || 'Suspended Tab').substring(0, 200), // Limit title length too
            favicon: tab.favIconUrl || '', // URLSearchParams handles encoding automatically
            time: Date.now().toString()
        });

        // Ask the page where it is scrolled; give up after 300 ms (no content
        // script, still loading) and suspend without a position.
        if (config.restoreScroll) {
            const state = await sendTabMessageWithTimeout(tabId, { type: 'GET_PAGE_STATE' }, TAB_MESSAGE_TIMEOUT);
            const sx = state && Number(state.scrollX);
            const sy = state && Number(state.scrollY);
            if ((sx > 0 || sy > 0) && Number.isFinite(sx) && Number.isFinite(sy)) {
                params.set('sx', String(Math.round(sx)));
                params.set('sy', String(Math.round(sy)));
            }
        }

        const suspendedUrl = chrome.runtime.getURL(`suspended.html?${params.toString()}`);

        // Handle tabs.update failure (e.g., restricted URLs like Chrome Web Store, or tab closed)
        try {
            await chrome.tabs.update(tabId, { url: suspendedUrl });
        } catch (updateError) {
            // Check if error is because tab no longer exists
            if (updateError.message?.includes('No tab with id')) {
                console.log(`[BG][SUSPEND] Tab ${tabId} was closed during suspension`);
                return false;
            }
            console.error(`[BG][SUSPEND] Failed to update tab ${tabId}:`, updateError);
            return false; // Don't update stats if suspension failed
        }

        await appendLedger(tab);
        await updateMemoryStats(tab.url);
        await clearTabTimer(tabId);
        await clearTabFormStatus(tabId);
        updateBadge();

        return true;
    } catch (error) {
        console.error('[BG] Failed to suspend tab:', error);
        return false;
    }
}

// Discard-mode suspension. `tab` is a fresh chrome.tabs.Tab.
async function discardTab(tab) {
    const tabId = tab.id;
    if (typeof chrome.tabs.discard !== 'function') {
        console.warn('[BG][DISCARD] chrome.tabs.discard unavailable in this browser, not suspending');
        return false;
    }
    if (tab.active) {
        console.log(`[BG][DISCARD] Tab ${tabId} is active in its window, not discarding`);
        return false;
    }
    if (tab.discarded) {
        console.log(`[BG][DISCARD] Tab ${tabId} already discarded`);
        return false;
    }

    let result;
    try {
        result = await chrome.tabs.discard(tabId);
    } catch (discardError) {
        if (discardError.message?.includes('No tab with id')) {
            console.log(`[BG][DISCARD] Tab ${tabId} was closed during discard`);
            return false;
        }
        console.error(`[BG][DISCARD] Failed to discard tab ${tabId}:`, discardError);
        return false;
    }
    if (!result) {
        console.log(`[BG][DISCARD] Chrome refused to discard tab ${tabId}`);
        return false;
    }

    // Older Chrome replaced the tab (new id) on discard; onReplaced also covers this.
    const trackedId = result.id !== undefined ? result.id : tabId;
    await withSessionMap('discardedByUs', (discardedByUs) => {
        discardedByUs[trackedId] = { url: tab.url, time: Date.now() };
    });

    await appendLedger(tab);
    await updateMemoryStats(tab.url);
    await clearTabTimer(tabId);
    await clearTabFormStatus(tabId);
    updateBadge();
    console.log(`[BG][DISCARD] Discarded tab ${trackedId}`);
    return true;
}

// ============================================================================
// TAB LEDGER - every filed tab is written here first (chrome.storage.local)
// ============================================================================

function isLedgerUrl(url) {
    return typeof url === 'string' && /^(https?|file|ftp):/i.test(url) &&
        !isInternalPage(url) && !isSuspendedPage(url);
}

async function getLedger() {
    try {
        const result = await chrome.storage.local.get(LEDGER_KEY);
        const list = Array.isArray(result[LEDGER_KEY]) ? result[LEDGER_KEY] : [];
        return list.filter(e => e && typeof e.url === 'string' && typeof e.time === 'number');
    } catch (error) {
        return [];
    }
}

// Newest first, one entry per URL, capped at LEDGER_MAX_ENTRIES, entries older
// than LEDGER_MAX_AGE dropped on write. chrome:// and extension URLs never go in.
async function appendLedger(tab) {
    try {
        if (!tab || !isLedgerUrl(tab.url)) return;
        const now = Date.now();
        const favicon = typeof tab.favIconUrl === 'string' && tab.favIconUrl.length <= 2000 ? tab.favIconUrl : '';
        const entry = {
            url: tab.url,
            title: String(tab.title || '').substring(0, 200),
            favicon,
            time: now,
            windowId: typeof tab.windowId === 'number' ? tab.windowId : null,
            groupId: typeof tab.groupId === 'number' && tab.groupId > -1 ? tab.groupId : null
        };
        const kept = (await getLedger()).filter(e => e.time > now - LEDGER_MAX_AGE && e.url !== tab.url);
        const next = [entry, ...kept].slice(0, LEDGER_MAX_ENTRIES);
        await chrome.storage.local.set({ [LEDGER_KEY]: next });
    } catch (error) {
        console.warn('[BG][LEDGER] Could not write ledger entry:', error && error.message);
    }
}

// Count of ledger entries from the last 24 h whose URL is not open in any tab.
// Written to chrome.storage.local `ledgerUnmatched`; nothing opens automatically.
async function updateLedgerUnmatched() {
    try {
        const entries = await getLedger();
        const since = Date.now() - 24 * 60 * 60 * 1000;
        const recent = entries.filter(e => e.time >= since);
        if (!recent.length) {
            await chrome.storage.local.set({ ledgerUnmatched: 0 });
            return 0;
        }
        const open = new Set();
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            const url = tab.url || tab.pendingUrl || '';
            if (!url) continue;
            open.add(url);
            if (isSuspendedPage(url)) {
                try {
                    const original = new URL(url).searchParams.get('url');
                    if (original) open.add(original);
                } catch (e) { /* ignore */ }
            }
        }
        const count = recent.filter(e => !open.has(e.url)).length;
        await chrome.storage.local.set({ ledgerUnmatched: count });
        if (count) console.log(`[BG][LEDGER] ${count} filed tab(s) from the last 24 h are not open`);
        return count;
    } catch (error) {
        console.warn('[BG][LEDGER] Could not compare ledger with open tabs:', error && error.message);
        return 0;
    }
}

async function openLedgerUrls(urls) {
    const list = (Array.isArray(urls) ? urls : []).filter(isLedgerUrl).slice(0, LEDGER_OPEN_MAX);
    const byUrl = new Map((await getLedger()).map(e => [e.url, e]));
    const groups = new Map(); // filed groupId -> { tabIds, windowId, filedWindowId }
    let opened = 0;
    for (const url of list) {
        try {
            const tab = await chrome.tabs.create({ url, active: false });
            opened++;
            const entry = byUrl.get(url);
            if (entry && typeof entry.groupId === 'number' && entry.groupId > -1 && tab && typeof tab.id === 'number') {
                const g = groups.get(entry.groupId) || { tabIds: [], windowId: tab.windowId, filedWindowId: entry.windowId };
                g.tabIds.push(tab.id);
                groups.set(entry.groupId, g);
            }
        } catch (error) {
            console.warn('[BG][LEDGER] Could not open', url, error && error.message);
        }
    }
    await regroupLedgerTabs(groups);
    return opened;
}

// Tabs that were in a tab group go back into it. Group ids do not survive a browser
// restart, so the old group is used only if it still has tabs in the window the tab
// was filed from. Else the tabs of that old group get a new group together.
async function regroupLedgerTabs(groups) {
    for (const [groupId, g] of groups) {
        try {
            const members = await chrome.tabs.query({ groupId });
            const alive = members.some(t => t.windowId === g.filedWindowId && !g.tabIds.includes(t.id));
            if (alive) {
                await chrome.tabs.group({ groupId, tabIds: g.tabIds });
            } else {
                await chrome.tabs.group({ tabIds: g.tabIds, createProperties: { windowId: g.windowId } });
            }
        } catch (error) {
            console.warn('[BG][LEDGER] Could not regroup tabs:', error && error.message);
        }
    }
}

// pendingScroll: scroll position handed from suspended.html to the restored page.
async function storePendingScroll(tabId, url, scrollX, scrollY) {
    const x = Number(scrollX) || 0;
    const y = Number(scrollY) || 0;
    await withSessionMap('pendingScroll', (pendingScroll) => {
        if (x <= 0 && y <= 0) {
            delete pendingScroll[tabId];
        } else {
            pendingScroll[tabId] = { url: String(url), x, y, at: Date.now() };
        }
    });
}

// Returns {x, y} once for a matching, fresh entry and deletes it. Stale or
// mismatched entries are dropped too, so the map never grows.
async function takePendingScroll(tabId, pageUrl) {
    let entry = null;
    await withSessionMap('pendingScroll', (pendingScroll) => {
        entry = pendingScroll[tabId] || null;
        if (!entry) return false;
        delete pendingScroll[tabId];
    });
    if (!entry) return null;

    if (!pageUrl || Date.now() - (Number(entry.at) || 0) > PENDING_SCROLL_MAX_AGE) return null;
    const strip = (u) => String(u).split('#')[0];
    if (entry.url !== pageUrl && strip(entry.url) !== strip(pageUrl)) return null;
    return { x: entry.x, y: entry.y };
}

async function restoreTab(tabId) {
    try {
        // Defensive handling: tab may have been closed
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
            console.log(`[BG][RESTORE] Tab ${tabId} no longer exists`);
            return false;
        }

        if (!isSuspendedPage(tab.url)) {
            // Discarded tab (ours or not) and any other non-suspended tab: reload
            if (tab.discarded) {
                await deleteSessionEntry('discardedByUs', tabId);
            }
            // Defensive handling for reload
            try {
                await chrome.tabs.reload(tabId);
            } catch (reloadError) {
                if (reloadError.message?.includes('No tab with id')) {
                    console.log(`[BG][RESTORE] Tab ${tabId} was closed during reload`);
                    return false;
                }
                throw reloadError;
            }
            if (tab.discarded) {
                await startTabTimer(tabId);
                updateBadge();
            }
            return true;
        }

        const url = new URL(tab.url);
        const originalUrl = url.searchParams.get('url');

        if (!originalUrl) return false;
        // Only web / file / ftp pages are ever navigated to; the suspended page
        // itself shows the error for anything else.
        if (!/^(https?|file|ftp):/i.test(originalUrl)) {
            console.warn(`[BG][RESTORE] Refusing to restore tab ${tabId}: unsupported protocol`);
            return false;
        }

        // Prefer an in-page location.replace() so suspended.html does not stay
        // in history. tabs.update is the fallback when the page does not answer.
        const reply = await sendTabMessageWithTimeout(tabId, { type: 'RESTORE_NOW' }, TAB_MESSAGE_TIMEOUT);
        if (!reply || reply.success !== true) {
            // Defensive handling for update
            try {
                await chrome.tabs.update(tabId, { url: originalUrl });
            } catch (updateError) {
                if (updateError.message?.includes('No tab with id')) {
                    console.log(`[BG][RESTORE] Tab ${tabId} was closed during restoration`);
                    return false;
                }
                throw updateError;
            }
        }

        await startTabTimer(tabId);
        updateBadge();

        return true;
    } catch (error) {
        console.error('[BG] Failed to restore tab:', error);
        return false;
    }
}

async function suspendAllInactive(exceptTabId = null) {
    const tabs = await chrome.tabs.query({});
    let count = 0;

    for (const tab of tabs) {
        if (tab.id !== exceptTabId && !tab.active) {
            // Tab may have been closed since query - suspendTab handles this defensively
            const success = await suspendTab(tab.id);
            if (success) count++;
        }
    }

    return count;
}

async function suspendAllExcept(tabId) {
    return suspendAllInactive(tabId);
}

async function restoreAllTabs() {
    const tabs = await chrome.tabs.query({});
    const discardedByUs = await getSessionObject('discardedByUs');
    let count = 0;

    for (const tab of tabs) {
        if (isSuspendedPage(tab.url) || (tab.discarded && discardedByUs[tab.id])) {
            // Tab may have been closed since query - restoreTab handles this defensively
            const success = await restoreTab(tab.id);
            if (success) count++;
        }
    }

    return count;
}

// ============================================================================
// WHITELIST
// ============================================================================

function isWhitelisted(url) {
    try {
        if (urlPatternRegexes.length && urlPatternRegexes.some(re => re.test(url))) {
            return true;
        }

        const urlObj = new URL(url);
        let hostname = urlObj.hostname.toLowerCase();

        // Normalize www prefix for consistent matching
        const hostnameWithoutWww = hostname.startsWith('www.') ? hostname.slice(4) : hostname;

        return config.whitelistedDomains.some(domain => {
            let d = domain.toLowerCase();
            // Normalize www prefix in whitelist domain too
            const domainWithoutWww = d.startsWith('www.') ? d.slice(4) : d;

            // Match with and without www prefix
            return hostname === d ||
                   hostname === domainWithoutWww ||
                   hostnameWithoutWww === d ||
                   hostnameWithoutWww === domainWithoutWww ||
                   hostname.endsWith('.' + d) ||
                   hostname.endsWith('.' + domainWithoutWww) ||
                   hostnameWithoutWww.endsWith('.' + d) ||
                   hostnameWithoutWww.endsWith('.' + domainWithoutWww);
        });
    } catch {
        return false;
    }
}

// Free-tier whitelist cap. Kept in sync with settings.js MAX_BASIC_WHITELIST so
// the shortcut and context-menu paths enforce the same limit the options UI does.
const MAX_BASIC_WHITELIST = 5;

async function addToWhitelist(domain) {
    // Normalize domain: remove www prefix for consistency
    let normalizedDomain = domain.toLowerCase().trim();
    if (normalizedDomain.startsWith('www.')) {
        normalizedDomain = normalizedDomain.slice(4);
    }

    // Check if already exists (with or without www)
    const alreadyExists = config.whitelistedDomains.some(d => {
        const existingNormalized = d.toLowerCase().startsWith('www.') ? d.slice(4).toLowerCase() : d.toLowerCase();
        return existingNormalized === normalizedDomain;
    });

    if (alreadyExists) return { success: true, added: false };

    // Enforce the free-tier limit here too, so Alt+W and the context menu can't
    // bypass the cap the options page enforces.
    const { isPro } = await chrome.storage.local.get('isPro');
    if (!isPro && config.whitelistedDomains.length >= MAX_BASIC_WHITELIST) {
        console.log('[BG][WHITELIST] Free-tier limit reached, not adding:', normalizedDomain);
        return { success: false, limitReached: true };
    }

    config.whitelistedDomains.push(normalizedDomain);
    try {
        await saveSettings();
    } catch (error) {
        config.whitelistedDomains = config.whitelistedDomains.filter(d => d !== normalizedDomain);
        return { success: false, added: false, error: storageErrorMessage(error) };
    }
    return { success: true, added: true };
}

async function removeFromWhitelist(domain) {
    const previous = config.whitelistedDomains;
    config.whitelistedDomains = config.whitelistedDomains.filter(d => d !== domain);
    try {
        await saveSettings();
    } catch (error) {
        config.whitelistedDomains = previous;
        return { success: false, error: storageErrorMessage(error) };
    }
    return { success: true };
}

function storageErrorMessage(error) {
    const text = (error && error.message) || 'Storage error';
    if (/quota/i.test(text)) return 'Storage is full: the list could not be saved. Remove a few entries and try again.';
    return text;
}

// Alt+W / context menu. At the free cap the badge flashes MAX for 2 s
// (no notifications permission needed).
async function whitelistCurrentSite(tab) {
    try {
        const url = new URL(tab.url);
        const result = await addToWhitelist(url.hostname);
        if (result && result.limitReached) {
            await flashBadge('MAX');
        }
    } catch (error) {
        console.error('[BG] Failed to whitelist site:', error);
    }
}

async function flashBadge(text) {
    try {
        await chrome.action.setBadgeText({ text });
        await chrome.action.setBadgeBackgroundColor({ color: '#8A2E2A' });
    } catch (error) {
        return;
    }
    setTimeout(() => { updateBadge(); }, 2000);
}

// ============================================================================
// AGENT 1: COUNTDOWN INDICATOR HANDLERS
// ============================================================================

/**
 * Get countdown information for a specific tab
 * @param {number} tabId - The tab ID to get countdown for
 * @returns {Promise<object>} Countdown info with remainingMs, suspendAt, isPaused
 */
async function getTabCountdownHandler(tabId) {
    try {
        // Get the alarm for this tab
        const alarmName = `${ALARM_PREFIX}${tabId}`;
        const alarm = await chrome.alarms.get(alarmName);

        if (alarm) {
            const remainingMs = Math.max(0, alarm.scheduledTime - Date.now());
            return {
                tabId,
                remainingMs,
                suspendAt: alarm.scheduledTime,
                isPaused: false
            };
        }

        // No alarm - check if tab exists and its state
        try {
            const tab = await chrome.tabs.get(tabId);

            // Check if tab is suspended, internal, or active
            if (isSuspendedPage(tab.url) || isInternalPage(tab.url) || tab.active) {
                return {
                    tabId,
                    remainingMs: -1,
                    suspendAt: null,
                    isPaused: true
                };
            }

            // Check if whitelisted
            if (isWhitelisted(tab.url)) {
                return {
                    tabId,
                    remainingMs: -1,
                    suspendAt: null,
                    isPaused: true
                };
            }
        } catch (e) {
            // Tab doesn't exist
            return {
                tabId,
                remainingMs: -1,
                suspendAt: null,
                isPaused: true
            };
        }

        // No alarm found for this tab
        return {
            tabId,
            remainingMs: -1,
            suspendAt: null,
            isPaused: true
        };

    } catch (error) {
        console.error(`[BG][COUNTDOWN] Error getting countdown for tab ${tabId}:`, error);
        return {
            tabId,
            remainingMs: -1,
            suspendAt: null,
            isPaused: true
        };
    }
}

/**
 * Get all active countdowns for tabs
 * @returns {Promise<object>} Object with countdowns array
 */
async function getAllCountdownsHandler() {
    const countdowns = [];

    try {
        // Get all suspension alarms
        const alarms = await chrome.alarms.getAll();

        for (const alarm of alarms) {
            if (alarm.name.startsWith(ALARM_PREFIX)) {
                const tabId = parseInt(alarm.name.replace(ALARM_PREFIX, ''), 10);
                const remainingMs = Math.max(0, alarm.scheduledTime - Date.now());

                countdowns.push({
                    tabId,
                    remainingMs,
                    suspendAt: alarm.scheduledTime
                });
            }
        }

        // Sort by remaining time (soonest first)
        countdowns.sort((a, b) => a.remainingMs - b.remainingMs);

    } catch (error) {
        console.error('[BG][COUNTDOWN] Error getting all countdowns:', error);
    }

    return { countdowns };
}

// ============================================================================
// HELPERS
// ============================================================================

function isInternalPage(url) {
    if (!url) return true;

    // All protocols that should NOT be suspended
    const internalPrefixes = [
        'chrome://',
        'chrome-extension://',
        'chrome-search://',
        'edge://',
        'about:',
        'file://',
        'data:',
        'blob:',
        'javascript:',
        'view-source:',
        'devtools://',
        'brave://',
        'opera://',
        'vivaldi://'
    ];

    return internalPrefixes.some(prefix => url.startsWith(prefix));
}

function isSuspendedPage(url) {
    if (!url) return false;
    return url.startsWith(SUSPENDED_URL);
}

// A tab counts as suspended when it shows suspended.html (page mode) or when
// Chrome has it discarded and we were the ones who discarded it.
function isSuspendedByUs(tab, discardedByUs) {
    if (isSuspendedPage(tab.url)) return true;
    return !!(tab.discarded && discardedByUs && discardedByUs[tab.id]);
}

// ============================================================================
// STATS
// ============================================================================

async function updateMemoryStats(url) {
    try {
        console.log('[BG][STATS] updateMemoryStats called for:', url);

        const result = await chrome.storage.local.get('memoryStats');
        const stats = result.memoryStats || { totalSaved: 0, tabsSuspended: 0, history: [] };

        console.log('[BG][STATS] Before:', stats.totalSaved / (1024 * 1024), 'MB, tabs:', stats.tabsSuspended);

        const estimatedMemory = 50 * 1024 * 1024; // 50MB

        stats.totalSaved += estimatedMemory;
        stats.tabsSuspended++;
        // Hostname only: the full URL (query strings, tokens) is never kept.
        let site = '';
        try { site = new URL(url).hostname; } catch (e) { site = ''; }
        stats.history.push({
            timestamp: Date.now(),
            url: site,
            memorySaved: estimatedMemory
        });

        if (stats.history.length > 500) {
            stats.history = stats.history.slice(-500);
        }

        await chrome.storage.local.set({ memoryStats: stats });
        console.log('[BG][STATS] After:', stats.totalSaved / (1024 * 1024), 'MB, tabs:', stats.tabsSuspended);

        // ========== AGENT 2: DASHBOARD SYNC ==========
        // Broadcast stats update to all listeners (popup, dashboard, etc.)
        // Feature flag check is done via storage since this is not an ES module
        try {
            const flagsResult = await chrome.storage.local.get('feature_flags_override');
            const overrides = flagsResult.feature_flags_override || {};
            const dashboardSyncEnabled = overrides.DASHBOARD_SYNC !== false; // Default: enabled

            if (dashboardSyncEnabled) {
                const currentStats = await getStats();
                chrome.runtime.sendMessage({
                    type: 'STATS_UPDATED',
                    stats: currentStats,
                    timestamp: Date.now()
                }).catch(() => {
                    // Expected when no listeners are active (popup/dashboard closed)
                });
                console.log('[BG][STATS] Broadcast STATS_UPDATED');
            }
        } catch (broadcastError) {
            // Silently ignore broadcast errors - non-critical
        }
        // ========== END AGENT 2 ==========
    } catch (error) {
        console.error('[BG][STATS] Failed to update memory stats:', error);
    }
}

async function getStats() {
    try {
        const result = await chrome.storage.local.get('memoryStats');
        let stats = result.memoryStats || { totalSaved: 0, tabsSuspended: 0, history: [] };

        // Validate and sanitize data to prevent NaN/corruption issues
        stats.totalSaved = Math.max(0, parseInt(stats.totalSaved) || 0);
        stats.tabsSuspended = Math.max(0, parseInt(stats.tabsSuspended) || 0);
        stats.history = Array.isArray(stats.history) ? stats.history : [];

        console.log('[BG][STATS] getStats - raw storage:', stats.totalSaved / (1024 * 1024), 'MB, history entries:', stats.history.length);

        const today = new Date().toDateString();
        const todaySaved = stats.history
            .filter(h => new Date(h.timestamp).toDateString() === today)
            .reduce((sum, h) => sum + h.memorySaved, 0);

        const allTabs = await chrome.tabs.query({});
        const discardedByUs = await getSessionObject('discardedByUs');
        const suspendedCount = allTabs.filter(t => isSuspendedByUs(t, discardedByUs)).length;

        const response = {
            totalSaved: stats.totalSaved,
            todaySaved,
            tabsSuspended: suspendedCount,
            totalTabs: allTabs.length,
            activeTabs: allTabs.length - suspendedCount,
            lifetimeTabsSuspended: stats.tabsSuspended
        };

        console.log('[BG][STATS] getStats returning:', response.totalSaved / (1024 * 1024), 'MB total,', response.todaySaved / (1024 * 1024), 'MB today');

        return response;
    } catch (error) {
        console.error('[BG][STATS] Failed to get stats:', error);
        return { error: error.message };
    }
}

async function getTabList() {
    try {
        const windows = await chrome.windows.getAll({ populate: true });

        // Get all tab activity times from storage
        let tabLastActivity = {};
        try {
            const result = await chrome.storage.session.get('tabLastActivity');
            tabLastActivity = result.tabLastActivity || {};
        } catch {
            const result = await chrome.storage.local.get('tabLastActivity');
            tabLastActivity = result.tabLastActivity || {};
        }
        const discardedByUs = await getSessionObject('discardedByUs');
        const tabExempt = await getSessionObject('tabExempt');

        return windows.map(win => ({
            id: win.id,
            focused: win.focused,
            tabs: win.tabs.map(tab => {
                const suspended = isSuspendedByUs(tab, discardedByUs);
                return {
                    id: tab.id,
                    windowId: tab.windowId,
                    url: tab.url || '',
                    title: tab.title || 'Untitled',
                    favIconUrl: tab.favIconUrl || '',
                    active: tab.active,
                    pinned: tab.pinned,
                    audible: tab.audible,
                    discarded: !!tab.discarded,
                    suspended,
                    exempt: tabExempt[tab.id] === true,
                    status: suspended ? 'suspended' : (tab.active ? 'active' : 'idle'),
                    lastActivity: tabLastActivity[tab.id] || Date.now()
                };
            })
        }));
    } catch (error) {
        console.error('[BG] Failed to get tab list:', error);
        return [];
    }
}

// ============================================================================
// BADGE
// ============================================================================

async function updateBadge() {
    if (!isExtensionContextValid()) {
        console.warn('[BG][BADGE] Extension context invalid, skipping badge update');
        return;
    }
    try {
        const tabs = await chrome.tabs.query({});
        const discardedByUs = await getSessionObject('discardedByUs');
        const suspendedCount = tabs.filter(t => isSuspendedByUs(t, discardedByUs)).length;

        // Re-check context before chrome.action calls
        if (!isExtensionContextValid()) {
            console.warn('[BG][BADGE] Context invalidated before setting badge');
            return;
        }

        await chrome.action.setBadgeText({
            text: suspendedCount > 0 ? String(suspendedCount) : ''
        });

        await chrome.action.setBadgeBackgroundColor({ color: '#7C3BED' });
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][BADGE] Context invalidated during badge update');
            return;
        }
        console.error('[BG] Failed to update badge:', error);
    }
}

// ============================================================================
// LICENSE VERIFICATION (Background)
// ============================================================================

const LICENSE_VERIFY_API = 'https://zgubxqomnbmxgbdhvwja.supabase.co/functions/v1/verify-extension-license';
const LICENSE_CHECK_INTERVAL_HOURS = 24;
// Note: LICENSE_CHECK_ALARM is defined at top of file with ALARM_PREFIX

// License keys are validated by the server only. There is no fixed bypass code.

// Set up periodic license verification alarm
async function setupLicenseVerification() {
    if (!isExtensionContextValid()) {
        console.warn('[BG][LICENSE] Extension context invalid, skipping license verification setup');
        return;
    }
    try {
        // Create the alarm only when it is missing: re-creating it on every
        // service-worker wake pushed the first fire out forever.
        const existing = await chrome.alarms.get(LICENSE_CHECK_ALARM);
        if (existing) return;
        await chrome.alarms.create(LICENSE_CHECK_ALARM, {
            delayInMinutes: 60,
            periodInMinutes: LICENSE_CHECK_INTERVAL_HOURS * 60
        });
        console.log('[BG][LICENSE] Background verification alarm set for every', LICENSE_CHECK_INTERVAL_HOURS, 'hours');
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][LICENSE] Context invalidated during setup');
            return;
        }
        console.error('[BG][LICENSE] Failed to setup verification:', error);
    }
}

// License alarm is handled by the main alarms listener above (around line 342)
// which checks for LICENSE_CHECK_ALARM and calls backgroundLicenseCheck()

// Background license verification
async function backgroundLicenseCheck() {
    if (!isExtensionContextValid()) {
        console.warn('[BG][LICENSE] Extension context invalid, skipping background check');
        return;
    }
    try {
        const data = await chrome.storage.local.get(['licenseKey', 'isPro', 'verifiedAt', 'serverSignature']);

        // A stored key is retried even when Pro is currently off (offline grace
        // expired, one bad server answer): a 'valid' reply restores Pro.
        if (!data.licenseKey) {
            console.log('[BG][LICENSE] No license key to verify');
            return;
        }

        // Verify with server
        const response = await fetch(LICENSE_VERIFY_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                license_key: data.licenseKey,
                extension: 'tab_suspender_pro'
            }),
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            console.log('[BG][LICENSE] Background check failed - server error');
            return; // Don't revoke on server errors, wait for next check
        }

        const result = await response.json();

        if (result.valid) {
            // Update verification timestamp; restore Pro if it had been revoked
            await chrome.storage.local.set({
                isPro: true,
                verifiedAt: Date.now(),
                licenseRetryAt: Date.now(),
                serverSignature: result.signature || data.serverSignature || null
            });
            if (!data.isPro) {
                console.log('[BG][LICENSE] Stored key is valid again - Pro restored');
                await chrome.action.setBadgeText({ text: '' }).catch(() => {});
                updateBadge();
            } else {
                console.log('[BG][LICENSE] Background verification successful');
            }
        } else if (data.isPro) {
            // License is no longer valid - revoke Pro status. The key stays
            // stored and is retried by this alarm every 24 h.
            console.log('[BG][LICENSE] Background verification FAILED - revoking Pro status');
            await chrome.storage.local.set({
                isPro: false,
                licenseRetryAt: Date.now(),
                serverSignature: null
            });

            // Notify user via badge
            await chrome.action.setBadgeText({ text: '!' });
            await chrome.action.setBadgeBackgroundColor({ color: '#8A2E2A' });
        } else {
            await chrome.storage.local.set({ licenseRetryAt: Date.now() });
            console.log('[BG][LICENSE] Stored key still not valid, retrying in 24 h');
        }
    } catch (error) {
        console.error('[BG][LICENSE] Background check error:', error);
        // Don't revoke on network errors - wait for next check
    }
}

// ============================================================================
// STARTUP
// ============================================================================

(async () => {
    // Verify extension context is valid before initialization
    if (!isExtensionContextValid()) {
        console.warn('[BG] Extension context invalid at init, will retry on next SW wake');
        return;
    }

    try {
        await loadSettings();

        // Re-check context after each async operation
        if (!isExtensionContextValid()) {
            console.warn('[BG] Context invalidated after loadSettings');
            return;
        }

        // Service-worker wake (not a browser start): only create the alarms
        // that are missing. onInstalled / onStartup run the full startMonitoring().
        await recreateAlarmsAfterWake();
        await ensureSweepAlarm();

        if (!isExtensionContextValid()) {
            console.warn('[BG] Context invalidated after recreateAlarmsAfterWake');
            return;
        }

        await updateBadge();

        if (!isExtensionContextValid()) {
            console.warn('[BG] Context invalidated after updateBadge');
            return;
        }

        await setupLicenseVerification();
        console.log('[BG] Background initialized successfully');
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG] Context invalidated during initialization');
            return;
        }
        console.error('[BG] Initialization failed:', error);
    }
})();
