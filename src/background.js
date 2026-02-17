/**
 * Tab Suspender - Background Service Worker
 * Simplified, bulletproof version
 */

console.log('Tab Suspender: Background starting...');

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG = {
    suspensionTimeout: 30,
    autoUnsuspendOnFocus: true,
    suspendPinnedTabs: false,
    whitelistedDomains: ['mail.google.com', 'calendar.google.com', 'docs.google.com'],
    neverSuspendAudio: true,
    neverSuspendActiveTab: true
};

let config = { ...DEFAULT_CONFIG };

// ============================================================================
// STATE
// ============================================================================

const tabTimers = new Map();
const tabLastActivity = new Map();

// ============================================================================
// INITIALIZATION
// ============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('Tab Suspender installed:', details.reason);

    await loadSettings();
    createContextMenus();

    if (details.reason === 'install') {
        chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
        await chrome.storage.local.set({
            memoryStats: { totalSaved: 0, tabsSuspended: 0, history: [] },
            installDate: Date.now()
        });
    }

    startMonitoring();
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('Tab Suspender starting up');
    await loadSettings();
    startMonitoring();
    updateBadge();
});

// ============================================================================
// SETTINGS
// ============================================================================

async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get('tabSuspenderSettings');
        if (result.tabSuspenderSettings) {
            config = { ...DEFAULT_CONFIG, ...result.tabSuspenderSettings };
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

async function saveSettings() {
    try {
        await chrome.storage.sync.set({ tabSuspenderSettings: config });
    } catch (error) {
        console.error('Failed to save settings:', error);
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
        });
    } catch (error) {
        console.error('Failed to create context menus:', error);
    }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
        switch (info.menuItemId) {
            case 'suspendTab':
                await suspendTab(tab.id);
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
        }
    } catch (error) {
        console.error('Context menu action failed:', error);
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
                if (activeTab) await suspendTab(activeTab.id);
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
        console.error('Command failed:', error);
    }
});

// ============================================================================
// TAB MONITORING  
// ============================================================================

function startMonitoring() {
    try {
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                if (!isInternalPage(tab.url) && !isSuspendedPage(tab.url)) {
                    startTabTimer(tab.id);
                }
            });
        });
    } catch (error) {
        console.error('Failed to start monitoring:', error);
    }
}

function startTabTimer(tabId) {
    clearTabTimer(tabId);

    const timeoutMs = config.suspensionTimeout * 60 * 1000;

    const timerId = setTimeout(async () => {
        try {
            const canSuspend = await shouldSuspendTab(tabId);
            if (canSuspend) {
                await suspendTab(tabId);
            }
        } catch (error) {
            console.error('Auto-suspend failed:', error);
        }
    }, timeoutMs);

    tabTimers.set(tabId, timerId);
    tabLastActivity.set(tabId, Date.now());
}

function clearTabTimer(tabId) {
    const timerId = tabTimers.get(tabId);
    if (timerId) {
        clearTimeout(timerId);
        tabTimers.delete(tabId);
    }
}

function resetTabTimer(tabId) {
    tabLastActivity.set(tabId, Date.now());
    startTabTimer(tabId);
}

// ============================================================================
// TAB EVENT LISTENERS
// ============================================================================

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        resetTabTimer(activeInfo.tabId);

        if (config.autoUnsuspendOnFocus) {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            if (isSuspendedPage(tab.url)) {
                await restoreTab(activeInfo.tabId);
            }
        }
    } catch (error) {
        console.error('Tab activation handler failed:', error);
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && !isInternalPage(tab.url)) {
        resetTabTimer(tabId);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    clearTabTimer(tabId);
    tabLastActivity.delete(tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
    if (!isInternalPage(tab.url)) {
        startTabTimer(tab.id);
    }
});

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
        .then(sendResponse)
        .catch(error => {
            console.error('Message handling error:', error);
            sendResponse({ error: error.message });
        });
    return true;
});

async function handleMessage(message, sender) {
    console.log('Received message:', message.type);

    switch (message.type) {
        case 'TAB_ACTIVITY':
            if (sender.tab) resetTabTimer(sender.tab.id);
            return { success: true };

        case 'FORM_STATUS':
            return { success: true };

        case 'CONTENT_SCRIPT_READY':
            return { success: true };

        case 'SUSPEND_TAB':
            await suspendTab(message.tabId);
            return { success: true };

        case 'RESTORE_TAB':
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
            config = { ...config, ...message.settings };
            await saveSettings();
            return { success: true };

        case 'WHITELIST_DOMAIN':
            await addToWhitelist(message.domain);
            return { success: true };

        case 'REMOVE_WHITELIST':
            await removeFromWhitelist(message.domain);
            return { success: true };

        default:
            return { error: 'Unknown message type' };
    }
}

// ============================================================================
// SUSPENSION LOGIC
// ============================================================================

async function shouldSuspendTab(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);

        if (isInternalPage(tab.url)) return false;
        if (isSuspendedPage(tab.url)) return false;
        if (config.neverSuspendActiveTab && tab.active) return false;
        if (!config.suspendPinnedTabs && tab.pinned) return false;
        if (config.neverSuspendAudio && tab.audible) return false;
        if (isWhitelisted(tab.url)) return false;

        return true;
    } catch (error) {
        console.error('shouldSuspendTab error:', error);
        return false;
    }
}

async function suspendTab(tabId) {
    try {
        const canSuspend = await shouldSuspendTab(tabId);
        if (!canSuspend) return false;

        const tab = await chrome.tabs.get(tabId);

        const params = new URLSearchParams({
            url: tab.url,
            title: tab.title || 'Suspended Tab',
            favicon: encodeURIComponent(tab.favIconUrl || ''),
            time: Date.now().toString()
        });

        const suspendedUrl = chrome.runtime.getURL(`suspended.html?${params.toString()}`);
        await chrome.tabs.update(tabId, { url: suspendedUrl });

        await updateMemoryStats(tab.url);
        clearTabTimer(tabId);
        updateBadge();

        return true;
    } catch (error) {
        console.error('Failed to suspend tab:', error);
        return false;
    }
}

async function restoreTab(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);

        if (!isSuspendedPage(tab.url)) {
            await chrome.tabs.reload(tabId);
            return true;
        }

        const url = new URL(tab.url);
        const originalUrl = url.searchParams.get('url');

        if (!originalUrl) return false;

        await chrome.tabs.update(tabId, { url: originalUrl });
        startTabTimer(tabId);
        updateBadge();

        return true;
    } catch (error) {
        console.error('Failed to restore tab:', error);
        return false;
    }
}

async function suspendAllInactive(exceptTabId = null) {
    const tabs = await chrome.tabs.query({});
    let count = 0;

    for (const tab of tabs) {
        if (tab.id !== exceptTabId && !tab.active) {
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
    let count = 0;

    for (const tab of tabs) {
        if (isSuspendedPage(tab.url)) {
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
        const urlObj = new URL(url);
        return config.whitelistedDomains.some(d => urlObj.hostname.includes(d));
    } catch {
        return false;
    }
}

async function addToWhitelist(domain) {
    if (!config.whitelistedDomains.includes(domain)) {
        config.whitelistedDomains.push(domain);
        await saveSettings();
    }
}

async function removeFromWhitelist(domain) {
    config.whitelistedDomains = config.whitelistedDomains.filter(d => d !== domain);
    await saveSettings();
}

async function whitelistCurrentSite(tab) {
    try {
        const url = new URL(tab.url);
        await addToWhitelist(url.hostname);
    } catch (error) {
        console.error('Failed to whitelist site:', error);
    }
}

// ============================================================================
// HELPERS
// ============================================================================

function isInternalPage(url) {
    if (!url) return true;
    return url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:');
}

function isSuspendedPage(url) {
    if (!url) return false;
    return url.includes('suspended.html');
}

// ============================================================================
// STATS
// ============================================================================

async function updateMemoryStats(url) {
    try {
        const result = await chrome.storage.local.get('memoryStats');
        const stats = result.memoryStats || { totalSaved: 0, tabsSuspended: 0, history: [] };

        const estimatedMemory = 50 * 1024 * 1024; // 50MB

        stats.totalSaved += estimatedMemory;
        stats.tabsSuspended++;
        stats.history.push({
            timestamp: Date.now(),
            url,
            memorySaved: estimatedMemory
        });

        if (stats.history.length > 500) {
            stats.history = stats.history.slice(-500);
        }

        await chrome.storage.local.set({ memoryStats: stats });
    } catch (error) {
        console.error('Failed to update memory stats:', error);
    }
}

async function getStats() {
    try {
        const result = await chrome.storage.local.get('memoryStats');
        const stats = result.memoryStats || { totalSaved: 0, tabsSuspended: 0, history: [] };

        const today = new Date().toDateString();
        const todaySaved = stats.history
            .filter(h => new Date(h.timestamp).toDateString() === today)
            .reduce((sum, h) => sum + h.memorySaved, 0);

        const allTabs = await chrome.tabs.query({});
        const suspendedCount = allTabs.filter(t => isSuspendedPage(t.url)).length;

        return {
            totalSaved: stats.totalSaved,
            todaySaved,
            tabsSuspended: suspendedCount,
            totalTabs: allTabs.length,
            activeTabs: allTabs.length - suspendedCount,
            lifetimeTabsSuspended: stats.tabsSuspended
        };
    } catch (error) {
        console.error('Failed to get stats:', error);
        return { error: error.message };
    }
}

async function getTabList() {
    try {
        const windows = await chrome.windows.getAll({ populate: true });

        return windows.map(win => ({
            id: win.id,
            focused: win.focused,
            tabs: win.tabs.map(tab => ({
                id: tab.id,
                windowId: tab.windowId,
                url: tab.url || '',
                title: tab.title || 'Untitled',
                favIconUrl: tab.favIconUrl || '',
                active: tab.active,
                pinned: tab.pinned,
                audible: tab.audible,
                status: isSuspendedPage(tab.url) ? 'suspended' : (tab.active ? 'active' : 'idle'),
                lastActivity: tabLastActivity.get(tab.id) || Date.now()
            }))
        }));
    } catch (error) {
        console.error('Failed to get tab list:', error);
        return [];
    }
}

// ============================================================================
// BADGE
// ============================================================================

async function updateBadge() {
    try {
        const tabs = await chrome.tabs.query({});
        const suspendedCount = tabs.filter(t => isSuspendedPage(t.url)).length;

        await chrome.action.setBadgeText({
            text: suspendedCount > 0 ? String(suspendedCount) : ''
        });

        await chrome.action.setBadgeBackgroundColor({ color: '#7C3BED' });
    } catch (error) {
        console.error('Failed to update badge:', error);
    }
}

// ============================================================================
// STARTUP
// ============================================================================

(async () => {
    try {
        await loadSettings();
        startMonitoring();
        updateBadge();
        console.log('Tab Suspender: Background initialized successfully');
    } catch (error) {
        console.error('Tab Suspender: Initialization failed:', error);
    }
})();
