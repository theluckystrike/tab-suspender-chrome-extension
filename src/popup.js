/**
 * Tab Suspender - Popup JavaScript
 * Handles tab list display and user interactions
 */

// DOM Elements
const tabsList = document.getElementById('tabsList');
const memorySaved = document.getElementById('memorySaved');
const suspendedCount = document.getElementById('suspendedCount');
const totalTabs = document.getElementById('totalTabs');
const totalSaved = document.getElementById('totalSaved');
const suspendAllBtn = document.getElementById('suspendAllBtn');
const restoreAllBtn = document.getElementById('restoreAllBtn');
const whitelistBtn = document.getElementById('whitelistBtn');
const settingsBtn = document.getElementById('settingsBtn');
const filterSelect = document.getElementById('filterSelect');
const searchInput = document.getElementById('searchInput');

let currentFilter = 'all';
let currentSearch = '';
let tabsData = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Popup loaded');
    await loadStats();
    await loadTabs();
    setupEventListeners();
});

// Event Listeners
function setupEventListeners() {
    suspendAllBtn.addEventListener('click', handleSuspendAll);
    restoreAllBtn.addEventListener('click', handleRestoreAll);
    whitelistBtn.addEventListener('click', handleWhitelist);
    settingsBtn.addEventListener('click', handleSettings);
    filterSelect.addEventListener('change', handleFilterChange);
    searchInput.addEventListener('input', handleSearch);
}

// Load Statistics - direct from storage as fallback
async function loadStats() {
    try {
        // Try messaging first
        try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
            if (response && !response.error) {
                updateStatsDisplay(response);
                return;
            }
        } catch (e) {
            console.log('Message failed, using direct storage:', e);
        }

        // Fallback: read directly from storage
        const result = await chrome.storage.local.get('memoryStats');
        const stats = result.memoryStats || { totalSaved: 0, tabsSuspended: 0, history: [] };

        const today = new Date().toDateString();
        const todaySaved = (stats.history || [])
            .filter(h => new Date(h.timestamp).toDateString() === today)
            .reduce((sum, h) => sum + h.memorySaved, 0);

        const allTabs = await chrome.tabs.query({});
        const suspended = allTabs.filter(t => t.url && t.url.includes('suspended.html')).length;

        updateStatsDisplay({
            totalSaved: stats.totalSaved || 0,
            todaySaved: todaySaved,
            tabsSuspended: suspended,
            totalTabs: allTabs.length
        });
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Update Stats Display
function updateStatsDisplay(stats) {
    memorySaved.textContent = formatBytes(stats.todaySaved || 0);
    suspendedCount.textContent = stats.tabsSuspended || 0;
    totalTabs.textContent = stats.totalTabs || 0;
    totalSaved.textContent = formatBytes(stats.totalSaved || 0);
}

// Load Tabs - direct from Chrome API as fallback
async function loadTabs() {
    try {
        tabsList.innerHTML = '<div class="loading">Loading tabs...</div>';

        // Try messaging first
        let windows = null;
        try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_LIST' });
            if (response && Array.isArray(response) && response.length > 0) {
                windows = response;
            }
        } catch (e) {
            console.log('Message failed, using direct API:', e);
        }

        // Fallback: use Chrome API directly
        if (!windows) {
            const chromeWindows = await chrome.windows.getAll({ populate: true });
            windows = chromeWindows.map(win => ({
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
                    status: (tab.url && tab.url.includes('suspended.html')) ? 'suspended' : (tab.active ? 'active' : 'idle')
                }))
            }));
        }

        if (!windows || windows.length === 0) {
            tabsList.innerHTML = '<div class="empty-state"><p>No tabs found</p></div>';
            return;
        }

        tabsData = windows;
        renderTabs(windows);
    } catch (error) {
        console.error('Error loading tabs:', error);
        tabsList.innerHTML = '<div class="empty-state"><p>Error: ' + error.message + '</p></div>';
    }
}

// Render Tabs
function renderTabs(windows) {
    tabsList.innerHTML = '';

    const searchTerm = currentSearch.toLowerCase();

    windows.forEach((win, winIndex) => {
        const windowGroup = document.createElement('div');
        windowGroup.className = 'window-group';

        // Window header
        const windowHeader = document.createElement('div');
        windowHeader.className = 'window-header';
        windowHeader.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="3" y1="9" x2="21" y2="9"></line>
      </svg>
      Window ${winIndex + 1}
      ${win.focused ? '<span class="window-badge">Active</span>' : ''}
    `;
        windowGroup.appendChild(windowHeader);

        // Filter tabs by status and search
        let filteredTabs = win.tabs || [];

        // Filter by status
        if (currentFilter !== 'all') {
            filteredTabs = filteredTabs.filter(tab => tab.status === currentFilter);
        }

        // Filter by search term
        if (searchTerm) {
            filteredTabs = filteredTabs.filter(tab => {
                const title = (tab.title || '').toLowerCase();
                const url = (tab.url || '').toLowerCase();
                return title.includes(searchTerm) || url.includes(searchTerm);
            });
        }

        // Tab items
        filteredTabs.forEach(tab => {
            const tabItem = createTabItem(tab);
            windowGroup.appendChild(tabItem);
        });

        if (filteredTabs.length > 0) {
            tabsList.appendChild(windowGroup);
        }
    });

    if (tabsList.children.length === 0) {
        const message = searchTerm ? 'No tabs match your search' : 'No tabs match the filter';
        tabsList.innerHTML = '<div class="empty-state"><p>' + message + '</p></div>';
    }
}

// Create Tab Item Element
function createTabItem(tab) {
    const item = document.createElement('div');
    item.className = `tab-item ${tab.status}`;
    item.dataset.tabId = tab.id;

    const favicon = tab.favIconUrl || '';
    const domain = getDomain(tab.url);

    item.innerHTML = `
    <img 
      src="${favicon}" 
      class="tab-favicon ${!favicon ? 'placeholder' : ''}" 
      alt=""
    >
    <div class="tab-info">
      <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
      <div class="tab-url">${escapeHtml(domain)}</div>
    </div>
    <span class="tab-status ${tab.status}">${tab.status}</span>
    <button class="tab-action" data-action="${tab.status === 'suspended' ? 'restore' : 'suspend'}">
      ${tab.status === 'suspended' ? 'Restore' : 'Suspend'}
    </button>
  `;

    // Handle favicon load error
    const faviconImg = item.querySelector('.tab-favicon');
    if (faviconImg) {
        faviconImg.onerror = function () {
            this.src = '';
            this.classList.add('placeholder');
        };
    }

    // Tab click - switch to tab
    item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tab-action')) {
            chrome.tabs.update(tab.id, { active: true });
            if (tab.windowId) {
                chrome.windows.update(tab.windowId, { focused: true });
            }
        }
    });


    // Action button click
    const actionBtn = item.querySelector('.tab-action');
    actionBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        const action = actionBtn.dataset.action;
        if (action === 'suspend') {
            await suspendTabDirect(tab.id, tab.url, tab.title, tab.favIconUrl);
        } else {
            await restoreTabDirect(tab.id, tab.url);
        }

        // Reload tabs
        setTimeout(() => {
            loadStats();
            loadTabs();
        }, 300);
    });

    return item;
}

// Direct suspend function (fallback)
async function suspendTabDirect(tabId, url, title, favicon) {
    try {
        // Don't suspend internal pages
        if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.includes('suspended.html')) {
            return;
        }

        const params = new URLSearchParams({
            url: url,
            title: title || 'Suspended Tab',
            favicon: encodeURIComponent(favicon || ''),
            time: Date.now()
        });

        const suspendedUrl = chrome.runtime.getURL(`suspended.html?${params.toString()}`);
        await chrome.tabs.update(tabId, { url: suspendedUrl });
    } catch (error) {
        console.error('Failed to suspend tab:', error);
    }
}

// Direct restore function (fallback)
async function restoreTabDirect(tabId, currentUrl) {
    try {
        if (!currentUrl.includes('suspended.html')) {
            await chrome.tabs.reload(tabId);
            return;
        }

        const urlObj = new URL(currentUrl);
        const originalUrl = urlObj.searchParams.get('url');

        if (originalUrl) {
            await chrome.tabs.update(tabId, { url: originalUrl });
        }
    } catch (error) {
        console.error('Failed to restore tab:', error);
    }
}

// Handle Suspend All
async function handleSuspendAll() {
    suspendAllBtn.disabled = true;
    suspendAllBtn.textContent = 'Suspending...';

    try {
        const tabs = await chrome.tabs.query({ active: false });
        for (const tab of tabs) {
            if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.includes('suspended.html')) {
                await suspendTabDirect(tab.id, tab.url, tab.title, tab.favIconUrl);
            }
        }

        setTimeout(() => {
            loadStats();
            loadTabs();
            suspendAllBtn.disabled = false;
            suspendAllBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        Suspend All
      `;
        }, 500);
    } catch (error) {
        console.error('Error suspending all:', error);
        suspendAllBtn.disabled = false;
    }
}

// Handle Restore All
async function handleRestoreAll() {
    restoreAllBtn.disabled = true;
    restoreAllBtn.textContent = 'Restoring...';

    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (tab.url && tab.url.includes('suspended.html')) {
                await restoreTabDirect(tab.id, tab.url);
            }
        }

        setTimeout(() => {
            loadStats();
            loadTabs();
            restoreAllBtn.disabled = false;
            restoreAllBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Restore All
      `;
        }, 500);
    } catch (error) {
        console.error('Error restoring all:', error);
        restoreAllBtn.disabled = false;
    }
}

// Handle Whitelist
async function handleWhitelist() {
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.url) {
            const domain = getDomain(activeTab.url);

            // Save to storage directly
            const result = await chrome.storage.sync.get('tabSuspenderSettings');
            const settings = result.tabSuspenderSettings || { whitelistedDomains: [] };

            if (!settings.whitelistedDomains.includes(domain)) {
                settings.whitelistedDomains.push(domain);
                await chrome.storage.sync.set({ tabSuspenderSettings: settings });
            }

            // Show feedback
            whitelistBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
            whitelistBtn.style.borderColor = '#22c55e';
            whitelistBtn.style.color = '#22c55e';

            setTimeout(() => {
                whitelistBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
        `;
                whitelistBtn.style.borderColor = '';
                whitelistBtn.style.color = '';
            }, 2000);
        }
    } catch (error) {
        console.error('Error whitelisting:', error);
    }
}

// Handle Settings
function handleSettings() {
    chrome.runtime.openOptionsPage();
}

// Handle Filter Change
function handleFilterChange() {
    currentFilter = filterSelect.value;
    renderTabs(tabsData);
}

// Handle Search
function handleSearch() {
    currentSearch = searchInput.value;
    renderTabs(tabsData);
}

// Utility Functions
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 MB';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getDomain(url) {
    try {
        if (!url) return 'Unknown';
        if (url.includes('suspended.html')) {
            const params = new URLSearchParams(url.split('?')[1]);
            const originalUrl = params.get('url');
            if (originalUrl) {
                return new URL(originalUrl).hostname;
            }
        }
        return new URL(url).hostname;
    } catch {
        return url || 'Unknown';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Auto-refresh every 30 seconds
setInterval(() => {
    loadStats();
}, 30000);
