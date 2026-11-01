/**
 * Tab Suspender Pro - Statistics Dashboard JavaScript
 */

// DOM Elements
const totalSaved = document.getElementById('totalSaved');
const tabsSuspended = document.getElementById('tabsSuspended');
const todaySaved = document.getElementById('todaySaved');
const avgDaily = document.getElementById('avgDaily');
const chartCanvas = document.getElementById('chartCanvas');
const topSites = document.getElementById('topSites');
const focusSessions = document.getElementById('focusSessions');
const focusTime = document.getElementById('focusTime');
const focusWeek = document.getElementById('focusWeek');
const exportBtn = document.getElementById('exportBtn');
const resetBtn = document.getElementById('resetBtn');

// DOM Elements - License Code Section
const licenseCodeSection = document.getElementById('licenseCodeSection');
const licenseCodeCopyBtn = document.getElementById('licenseCodeCopyBtn');
const copyBtnText = document.getElementById('copyBtnText');

// ========== AGENT 2: DASHBOARD SYNC ELEMENTS ==========
const syncStatusEl = document.getElementById('stats-sync-status');
const lastUpdatedEl = document.getElementById('stats-last-updated');
const refreshBtn = document.getElementById('stats-refresh-btn');

let lastUpdateTimestamp = null;
let dashboardSyncEnabled = true;
// ========== END AGENT 2 ==========

let currentPeriod = 7;
let lastUpdatedInterval = null; // Track interval for cleanup

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // ========== AGENT 2: DASHBOARD SYNC INIT ==========
    await checkDashboardSyncFeature();
    if (dashboardSyncEnabled) {
        setupStatsListener();
        setupRefreshButton();
        startLastUpdatedTimer();
    }
    // ========== END AGENT 2 ==========

    await loadStats();
    setupEventListeners();
});

// ========== AGENT 2: DASHBOARD SYNC FUNCTIONS ==========

/**
 * Check if dashboard sync feature is enabled
 */
async function checkDashboardSyncFeature() {
    try {
        const result = await chrome.storage.local.get('feature_flags_override');
        const overrides = result.feature_flags_override || {};
        dashboardSyncEnabled = overrides.DASHBOARD_SYNC !== false; // Default: enabled

        if (!dashboardSyncEnabled) {
            // Hide sync bar if feature disabled
            const syncBar = document.getElementById('stats-sync-bar');
            if (syncBar) syncBar.style.display = 'none';
        }
    } catch (error) {
        console.log('[DashboardSync] Feature check error:', error);
    }
}

/**
 * Listen for STATS_UPDATED broadcasts from background
 */
function setupStatsListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'STATS_UPDATED') {
            console.log('[DashboardSync] Received STATS_UPDATED');
            handleStatsUpdate(message.stats, message.timestamp);
            sendResponse({ received: true });
        }
        return false;
    });
    console.log('[DashboardSync] Listener setup complete');
}

/**
 * Handle incoming stats update
 */
function handleStatsUpdate(stats, timestamp) {
    lastUpdateTimestamp = timestamp || Date.now();

    // Update sync status to show "Live"
    updateSyncStatus(false);
    updateLastUpdatedDisplay();

    // Update the stats display
    updateStatsDisplay(stats);

    // Also refresh chart and top sites
    loadChartData(currentPeriod);
    loadTopSites();
}

/**
 * Update stats display with new data
 */
function updateStatsDisplay(stats) {
    if (!stats) return;

    totalSaved.textContent = formatBytes(stats.totalSaved || 0);
    tabsSuspended.textContent = stats.lifetimeTabsSuspended || 0;
    todaySaved.textContent = formatBytes(stats.todaySaved || 0);

    // Calculate daily average
    chrome.storage.local.get(['installDate']).then(result => {
        const installDate = result.installDate || Date.now();
        const days = Math.max(1, Math.ceil((Date.now() - installDate) / (24 * 60 * 60 * 1000)));
        const avg = (stats.totalSaved || 0) / days;
        avgDaily.textContent = formatBytes(avg);
    });
}

/**
 * Setup manual refresh button
 */
function setupRefreshButton() {
    if (!refreshBtn) return;

    refreshBtn.addEventListener('click', async () => {
        await manualRefresh();
    });
}

/**
 * Manually refresh stats
 */
async function manualRefresh() {
    updateSyncStatus(true); // Show syncing
    refreshBtn.disabled = true;
    refreshBtn.classList.add('syncing');

    try {
        // Request fresh stats
        const response = await chrome.runtime.sendMessage({ type: 'REQUEST_STATS_SYNC' });

        if (response && response.stats) {
            handleStatsUpdate(response.stats, Date.now());
        } else {
            // Fallback to regular GET_STATS
            await loadStats();
        }
    } catch (error) {
        console.error('[DashboardSync] Refresh failed:', error);
        // Fallback to regular load
        await loadStats();
    } finally {
        updateSyncStatus(false);
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('syncing');
    }
}

/**
 * Update sync status indicator
 */
function updateSyncStatus(isSyncing) {
    if (!syncStatusEl) return;

    const syncText = syncStatusEl.querySelector('.sync-text');

    if (isSyncing) {
        syncStatusEl.classList.add('syncing');
        if (syncText) syncText.textContent = 'Syncing...';
    } else {
        syncStatusEl.classList.remove('syncing');
        if (syncText) syncText.textContent = 'Live';
    }
}

/**
 * Update "Last updated" display
 */
function updateLastUpdatedDisplay() {
    if (!lastUpdatedEl || !lastUpdateTimestamp) return;

    const text = formatLastUpdated(lastUpdateTimestamp);
    lastUpdatedEl.textContent = `Last updated: ${text}`;
}

/**
 * Format timestamp as human-readable "X ago"
 */
function formatLastUpdated(timestamp) {
    if (!timestamp) return 'Never';

    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    return new Date(timestamp).toLocaleDateString();
}

/**
 * Start timer to update "Last updated" display
 */
function startLastUpdatedTimer() {
    // Clear any existing interval first
    if (lastUpdatedInterval) {
        clearInterval(lastUpdatedInterval);
    }
    // Update every 10 seconds
    lastUpdatedInterval = setInterval(() => {
        updateLastUpdatedDisplay();
    }, 10000);
}

// Clean up interval when page unloads to prevent memory leaks
window.addEventListener('beforeunload', () => {
    if (lastUpdatedInterval) {
        clearInterval(lastUpdatedInterval);
    }
});
// ========== END AGENT 2 ==========

async function loadStats() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });

        // Update overview cards
        totalSaved.textContent = formatBytes(response.totalSaved || 0);
        tabsSuspended.textContent = response.lifetimeTabsSuspended || 0;
        todaySaved.textContent = formatBytes(response.todaySaved || 0);

        // Calculate daily average
        const result = await chrome.storage.local.get(['memoryStats', 'installDate']);
        const installDate = result.installDate || Date.now();
        const days = Math.max(1, Math.ceil((Date.now() - installDate) / (24 * 60 * 60 * 1000)));
        const avg = (response.totalSaved || 0) / days;
        avgDaily.textContent = formatBytes(avg);

        // Load chart data
        await loadChartData(currentPeriod);

        // Load top sites
        await loadTopSites();

        // Load focus stats
        await loadFocusStats();

        // ========== AGENT 2: DASHBOARD SYNC ==========
        // Update last updated timestamp on initial load
        if (dashboardSyncEnabled) {
            lastUpdateTimestamp = Date.now();
            updateLastUpdatedDisplay();
        }
        // ========== END AGENT 2 ==========
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

async function loadChartData(days) {
    try {
        const result = await chrome.storage.local.get('memoryStats');
        const history = result.memoryStats?.history || [];

        // Group by local calendar day (same day boundary as "today" in the
        // popup and background, which use the local date).
        const byDay = {};
        for (let i = 0; i < days; i++) {
            const date = new Date();
            date.setHours(12, 0, 0, 0);
            date.setDate(date.getDate() - i);
            byDay[getDateKey(date.getTime())] = 0;
        }

        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        history.filter(h => h.timestamp > cutoff).forEach(h => {
            const key = getDateKey(h.timestamp);
            if (byDay[key] !== undefined) {
                byDay[key] += h.memorySaved || 0;
            }
        });

        // Render chart
        const entries = Object.entries(byDay).reverse();
        const maxValue = Math.max(...entries.map(([, v]) => v), 1);
        const hasData = entries.some(([, v]) => v > 0);

        if (!hasData) {
            chartCanvas.innerHTML = `
                <div class="empty-state" style="width: 100%; height: 200px;">
                    <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <line x1="18" y1="20" x2="18" y2="10"></line>
                        <line x1="12" y1="20" x2="12" y2="4"></line>
                        <line x1="6" y1="20" x2="6" y2="14"></line>
                        <line x1="2" y1="20" x2="22" y2="20"></line>
                    </svg>
                    <p class="empty-state-title">No savings data yet</p>
                    <p class="empty-state-description">Start suspending tabs to see your memory savings over time</p>
                </div>
            `;
            return;
        }

        chartCanvas.innerHTML = entries.map(([label, value]) => {
            const height = Math.max(20, (value / maxValue) * 200);
            // Format label as user-friendly date (e.g., "Jan 15" instead of "2025-1-15")
            const formattedLabel = formatChartLabel(label);
            return `
    <div class="chart-bar" style="height: ${height}px" title="${formatBytes(value)}">
      <span class="chart-bar-label">${formattedLabel}</span>
    </div>
  `;
        }).join('');
    } catch (error) {
        console.error('Failed to load chart data:', error);
    }
}

async function loadTopSites() {
    try {
        const result = await chrome.storage.local.get('memoryStats');
        const history = result.memoryStats?.history || [];

        // Count by domain
        const byDomain = {};
        history.forEach(h => {
            try {
                // 1.0.37 stores the hostname only; older entries hold a full URL.
                const raw = String(h.url || '');
                const domain = raw.includes('://') ? new URL(raw).hostname : raw;
                if (domain) byDomain[domain] = (byDomain[domain] || 0) + 1;
            } catch (e) { }
        });

        // Sort by count (descending), then alphabetically for tie-breaking
        const sorted = Object.entries(byDomain)
            .sort((a, b) => {
                if (b[1] !== a[1]) return b[1] - a[1]; // Primary: by count descending
                return a[0].localeCompare(b[0]); // Secondary: alphabetical for ties
            })
            .slice(0, 5);

        if (sorted.length === 0) {
            topSites.innerHTML = `
                <div class="empty-state">
                    <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="3" y1="9" x2="21" y2="9"></line>
                        <line x1="9" y1="21" x2="9" y2="9"></line>
                    </svg>
                    <p class="empty-state-title">No sites suspended yet</p>
                    <p class="empty-state-description">Your most suspended sites will appear here once you start using Tab Suspender</p>
                </div>
            `;
            return;
        }

        // Escape domain (derived from suspended-tab hostnames) before innerHTML to prevent DOM XSS.
        const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        topSites.innerHTML = sorted.map(([domain, count]) => `
  <div class="site-item">
    <span class="site-domain">${esc(domain)}</span>
    <span class="site-count">${Number(count) || 0}x</span>
  </div>
`).join('');
    } catch (error) {
        console.error('Failed to load top sites:', error);
    }
}

async function loadFocusStats() {
    try {
        // Try multiple storage keys that might contain focus session data
        const result = await chrome.storage.local.get(['focusSessions', 'focusMode', 'focusStats']);

        // Try to get sessions from various possible storage formats
        let sessions = result.focusSessions || [];

        // Check if focusStats has session data (alternative storage format)
        if (sessions.length === 0 && result.focusStats?.sessions) {
            sessions = result.focusStats.sessions;
        }

        // Check if focusMode has history (another possible format)
        if (sessions.length === 0 && result.focusMode?.history) {
            sessions = result.focusMode.history;
        }

        // Debug log to help identify data issues
        console.log('[FocusStats] Loaded sessions:', sessions.length, 'sessions found');

        // Ensure focusSessions element exists before updating
        if (focusSessions) {
            focusSessions.textContent = sessions.length;
        }

        // Calculate total time with validation
        const totalMs = sessions.reduce((sum, s) => {
            // Handle different possible duration formats
            const duration = s.duration || s.durationMs || s.time || 0;
            return sum + (typeof duration === 'number' ? duration : 0);
        }, 0);

        const totalMinutes = Math.floor(totalMs / (60 * 1000));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        // Update focus time display
        if (focusTime) {
            if (sessions.length === 0) {
                focusTime.textContent = '0m';
            } else if (hours > 0 && minutes > 0) {
                focusTime.textContent = `${hours}h ${minutes}m`;
            } else if (hours > 0) {
                focusTime.textContent = `${hours}h`;
            } else {
                focusTime.textContent = `${minutes}m`;
            }
        }

        // Calculate this week's sessions with proper timestamp handling
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const thisWeek = sessions.filter(s => {
            // Handle different timestamp formats
            const timestamp = s.timestamp || s.startTime || s.date || 0;
            return timestamp > weekAgo;
        }).length;

        if (focusWeek) {
            focusWeek.textContent = thisWeek;
        }

        // Log final stats for debugging
        console.log('[FocusStats] Total sessions:', sessions.length,
                    'Total time:', totalMinutes, 'min',
                    'This week:', thisWeek);

    } catch (error) {
        console.error('Failed to load focus stats:', error);
        // Set default values on error
        if (focusSessions) focusSessions.textContent = '0';
        if (focusTime) focusTime.textContent = '0m';
        if (focusWeek) focusWeek.textContent = '0';
    }
}

function setupEventListeners() {
    // Period buttons
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriod = parseInt(btn.dataset.period);
            await loadChartData(currentPeriod);
        });
    });

    // Export
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const result = await chrome.storage.local.get(['memoryStats', 'focusSessions', 'installDate']);
            const data = JSON.stringify(result, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tab-suspender-stats.json';
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // Reset - clear all stats data completely
    if (resetBtn) resetBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to reset all statistics? This cannot be undone.')) {
            // Clear all stats-related data
            await chrome.storage.local.remove([
                'memoryStats',
                'focusSessions',
                'installDate'
            ]);

            // Reset memoryStats to empty instead of just removing
            await chrome.storage.local.set({
                memoryStats: { totalSaved: 0, tabsSuspended: 0, history: [] },
                installDate: Date.now()
            });

            location.reload();
        }
    });
}

function formatBytes(bytes) {
    // Validate input to prevent NaN/crashes
    if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) {
        return '0 B';
    }
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format chart labels as user-friendly dates (e.g., "Jan 15" instead of "2025-1-15")
function formatChartLabel(dateKey) {
    try {
        // Parse the key format "YYYY-M-D"
        const parts = dateKey.split('-');
        if (parts.length !== 3) return dateKey;

        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1; // JavaScript months are 0-indexed
        const day = parseInt(parts[2]);

        const date = new Date(year, month, day, 12);

        // Format as "Jan 15" or "15" depending on space
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[date.getMonth()]} ${date.getDate()}`;
    } catch {
        return dateKey;
    }
}

// Local-date key, e.g. 2026-10-15
function getDateKey(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

// ========== SHARE YOUR IMPACT ==========
const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/ofgncemnlblfnocjbojdhamacfffcpnm';

function setupShareButtons() {
    const shareTwitterBtn = document.getElementById('shareTwitter');
    const shareLinkedInBtn = document.getElementById('shareLinkedIn');
    const shareFacebookBtn = document.getElementById('shareFacebook');
    const shareCopyBtn = document.getElementById('shareCopy');

    if (shareTwitterBtn) {
        shareTwitterBtn.addEventListener('click', shareOnTwitter);
    }
    if (shareLinkedInBtn) {
        shareLinkedInBtn.addEventListener('click', shareOnLinkedIn);
    }
    if (shareFacebookBtn) {
        shareFacebookBtn.addEventListener('click', shareOnFacebook);
    }
    if (shareCopyBtn) {
        shareCopyBtn.addEventListener('click', copyShareText);
    }
}

function getShareText() {
    const memory = totalSaved?.textContent || '0 MB';
    const tabs = tabsSuspended?.textContent || '0';
    return `Tab Suspender Pro has freed an estimated ${memory} of memory by putting ${tabs} tabs to sleep in my browser. ${CHROME_STORE_URL}`;
}

function updateSharePreview() {
    const shareMemory = document.getElementById('shareMemory');
    const shareTabs = document.getElementById('shareTabs');

    if (shareMemory && totalSaved) {
        shareMemory.textContent = totalSaved.textContent;
    }
    if (shareTabs && tabsSuspended) {
        shareTabs.textContent = tabsSuspended.textContent;
    }
}

function shareOnTwitter() {
    const text = getShareText();
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'width=550,height=420');
}

function shareOnLinkedIn() {
    const text = getShareText();
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(CHROME_STORE_URL)}`;
    window.open(url, '_blank', 'width=550,height=420');
}

function shareOnFacebook() {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(CHROME_STORE_URL)}&quote=${encodeURIComponent(getShareText())}`;
    window.open(url, '_blank', 'width=550,height=420');
}

function copyShareText() {
    const text = getShareText();
    navigator.clipboard.writeText(text).then(() => {
        const copyBtn = document.getElementById('shareCopy');
        if (copyBtn) {
            copyBtn.classList.add('copied');
            const span = copyBtn.querySelector('span');
            if (span) span.textContent = 'Copied!';

            setTimeout(() => {
                copyBtn.classList.remove('copied');
                if (span) span.textContent = 'Copy';
            }, 2000);
        }
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

// Initialize share buttons on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    setupShareButtons();
});

// Update share preview when stats load
const originalLoadStats = loadStats;
loadStats = async function() {
    await originalLoadStats();
    updateSharePreview();
};
// ========== END SHARE YOUR IMPACT ==========

// ============================================================
// PRO LICENSE CODE DISPLAY — REMOVED (v1.0.30 hardening)
// The dashboard previously showed a universal master key and a
// "share with friends" copy button, which handed out free Pro.
// The UI, the hardcoded key, and the copy logic are all gone.
// Pro entitlement is server-verified only.
// ============================================================
