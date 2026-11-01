/**
 * Tab Suspender Pro - Suspended Page JavaScript
 * Handles tab info display, restoration, and theme management
 */

// Get URL parameters
const params = new URLSearchParams(window.location.search);
const originalUrl = params.get('url');
const title = params.get('title') || 'Suspended Tab';
// Note: URLSearchParams.get() already decodes, so no need for decodeURIComponent
const faviconParam = params.get('favicon');
const favicon = faviconParam || '';
const suspendedAt = parseInt(params.get('time')) || Date.now();
// Scroll position captured before suspension (page mode with restoreScroll on)
const savedScrollX = parseInt(params.get('sx'), 10) || 0;
const savedScrollY = parseInt(params.get('sy'), 10) || 0;

// DOM Elements
const pageTitle = document.getElementById('pageTitle');
const pageFavicon = document.getElementById('pageFavicon');
const faviconImg = document.getElementById('favicon');
const tabTitle = document.getElementById('tabTitle');
const tabUrl = document.getElementById('tabUrl');
const memorySaved = document.getElementById('memorySaved');
const timeSuspended = document.getElementById('timeSuspended');

// Initialize page
function init() {
    // Set page title
    pageTitle.textContent = `${title} (Suspended)`;

    // Set favicon with placeholder fallback
    if (favicon) {
        pageFavicon.href = favicon;
        faviconImg.src = favicon;
        faviconImg.style.display = 'block';
        // Handle favicon load error - show placeholder
        faviconImg.onerror = function() {
            // Use a generic globe icon as placeholder (data URI)
            this.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2NjYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCI+PC9jaXJjbGU+PGxpbmUgeDE9IjIiIHkxPSIxMiIgeDI9IjIyIiB5Mj0iMTIiPjwvbGluZT48cGF0aCBkPSJNMTIgMmExNS4zIDE1LjMgMCAwIDEgNCAxMCAxNS4zIDE1LjMgMCAwIDEtNCAxMCAxNS4zIDE1LjMgMCAwIDEtNC0xMCAxNS4zIDE1LjMgMCAwIDEgNC0xMHoiPjwvcGF0aD48L3N2Zz4=';
            this.onerror = null; // Prevent infinite loop
        };
    } else {
        // No favicon provided - show placeholder
        faviconImg.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2NjYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCI+PC9jaXJjbGU+PGxpbmUgeDE9IjIiIHkxPSIxMiIgeDI9IjIyIiB5Mj0iMTIiPjwvbGluZT48cGF0aCBkPSJNMTIgMmExNS4zIDE1LjMgMCAwIDEgNCAxMCAxNS4zIDE1LjMgMCAwIDEtNCAxMCAxNS4zIDE1LjMgMCAwIDEtNC0xMCAxNS4zIDE1LjMgMCAwIDEgNC0xMHoiPjwvcGF0aD48L3N2Zz4=';
        faviconImg.style.display = 'block';
    }

    // Set tab info
    tabTitle.textContent = title;
    tabUrl.textContent = getDomain(originalUrl);

    // "Never suspend <domain>" link
    initNeverSuspendLink();

    // Set memory saved - dynamic estimate based on tab complexity
    memorySaved.textContent = estimateMemorySaved(originalUrl);

    // Update time suspended
    updateTimeSuspended();
    setInterval(updateTimeSuspended, 1000);

    // Set up restoration handlers
    setupRestoreHandlers();

    // Initialize theme toggle
    initThemeToggle();
}

// Get domain from URL
function getDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return url || 'Unknown';
    }
}

// Estimate memory saved based on the type of site
function estimateMemorySaved(url) {
    if (!url) return '~50 MB';

    try {
        const hostname = new URL(url).hostname.toLowerCase();

        // Heavy sites (video streaming, social media feeds)
        const heavySites = ['youtube.com', 'netflix.com', 'twitch.tv', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'reddit.com'];
        if (heavySites.some(site => hostname.includes(site))) {
            return '~150-300 MB';
        }

        // Medium sites (web apps, news with media)
        const mediumSites = ['gmail.com', 'google.com', 'docs.google.com', 'notion.so', 'figma.com', 'slack.com', 'discord.com', 'linkedin.com'];
        if (mediumSites.some(site => hostname.includes(site))) {
            return '~80-150 MB';
        }

        // Light sites (simple pages, documentation)
        const lightSites = ['github.com', 'stackoverflow.com', 'wikipedia.org', 'medium.com'];
        if (lightSites.some(site => hostname.includes(site))) {
            return '~30-60 MB';
        }

        // Default estimate for unknown sites
        return '~50-100 MB';
    } catch {
        return '~50 MB';
    }
}

// Update time suspended display
function updateTimeSuspended() {
    const elapsed = Date.now() - suspendedAt;
    timeSuspended.textContent = formatDuration(elapsed);
}

// Format duration to human readable
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    if (seconds > 0) {
        return `${seconds}s`;
    }
    return 'Just now';
}

// Set up restore handlers
function setupRestoreHandlers() {
    // Click anywhere to restore
    document.addEventListener('click', (e) => {
        // Don't restore when clicking external links or theme toggle
        if (e.target.closest('a[target="_blank"]')) return;
        if (e.target.closest('#themeToggle')) return;
        if (e.target.closest('#neverSuspendLink')) return; // has its own handler
        restore();
    });

    // Press any key to restore (excluding navigation and modifier keys).
    // Enter and Space always restore, even with a modifier held.
    document.addEventListener('keydown', (e) => {
        // The link and the theme toggle handle their own Enter/Space
        if (e.target && e.target.closest && (e.target.closest('#neverSuspendLink') || e.target.closest('#themeToggle'))) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            restore();
            return;
        }
        // Ignore modifier keys
        if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return;
        // Ignore key combos
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // Ignore navigation keys (Tab for a11y, Escape, function keys)
        if (e.key === 'Tab' || e.key === 'Escape') return;
        if (e.key.length > 1 && e.key.startsWith('F')) return;
        restore();
    });

    // Background asks the page to restore itself so suspended.html does not
    // stay in history (location.replace instead of tabs.update).
    try {
        if (chrome && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                if (message && message.type === 'RESTORE_NOW') {
                    sendResponse({ success: true });
                    restore();
                }
                return false;
            });
        }
    } catch (e) {
        // Extension messaging unavailable; click and keyboard restore still work
    }
}

// "Never suspend <domain>": whitelist the site, then restore
function initNeverSuspendLink() {
    const link = document.getElementById('neverSuspendLink');
    if (!link) return;

    const domain = getDomain(originalUrl);
    if (!originalUrl || !domain || domain === 'Unknown') {
        link.style.display = 'none';
        return;
    }
    link.textContent = `Never suspend ${domain}`;

    const activate = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isRestoring) return;
        link.setAttribute('aria-busy', 'true');
        try {
            const reply = await chrome.runtime.sendMessage({ type: 'WHITELIST_DOMAIN', domain });
            if (reply && reply.limitReached) {
                link.removeAttribute('aria-busy');
                showError('Whitelist limit reached on the free plan. Remove a site in Settings or unlock Pro.');
                return;
            }
        } catch (err) {
            console.error('Whitelist request failed:', err);
            // Still restore - the user wanted their page back either way
        }
        restore();
    };

    link.addEventListener('click', activate);
    link.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') activate(e);
    });
}

// ============================================================
// Theme Management
// ============================================================

/**
 * Get the current effective theme.
 * Priority: localStorage > system preference > 'light'
 * @returns {'dark'|'light'} The resolved theme
 */
function getEffectiveTheme() {
    // Check localStorage for explicit user preference
    try {
        const saved = localStorage.getItem('tsp-theme');
        if (saved === 'dark' || saved === 'light') {
            return saved;
        }
    } catch {
        // localStorage unavailable — fall through
    }

    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }

    return 'light';
}

/**
 * Apply theme to the document and update toggle icon visibility.
 * @param {'dark'|'light'} theme - Must be 'dark' or 'light'
 */
function applyTheme(theme) {
    if (theme !== 'dark' && theme !== 'light') {
        console.error('applyTheme: invalid theme value:', theme);
        return;
    }

    document.documentElement.dataset.theme = theme;

    // Update toggle button icons
    const sunIcon = document.querySelector('.theme-icon-sun');
    const moonIcon = document.querySelector('.theme-icon-moon');

    if (sunIcon) {
        sunIcon.style.display = theme === 'dark' ? 'block' : 'none';
    }
    if (moonIcon) {
        moonIcon.style.display = theme === 'dark' ? 'none' : 'block';
    }
}

/**
 * Save theme preference to localStorage (sync) and chrome.storage (async backup).
 * @param {'dark'|'light'} theme - Must be 'dark' or 'light'
 */
function saveThemePreference(theme) {
    if (theme !== 'dark' && theme !== 'light') {
        console.error('saveThemePreference: invalid theme value:', theme);
        return;
    }

    // Synchronous save for instant access on next load
    try {
        localStorage.setItem('tsp-theme', theme);
    } catch (err) {
        console.error('saveThemePreference: localStorage write failed:', err);
    }

    // Async backup to chrome.storage for cross-context persistence
    try {
        if (chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ 'tsp-theme': theme }).catch(function(err) {
                console.error('saveThemePreference: chrome.storage write failed:', err);
            });
        }
    } catch {
        // chrome.storage unavailable — localStorage is sufficient
    }
}

/**
 * Toggle between dark and light theme. Applies immediately and persists.
 */
function toggleTheme() {
    const current = document.documentElement.dataset.theme || getEffectiveTheme();
    if (current !== 'dark' && current !== 'light') {
        console.error('toggleTheme: unexpected current theme:', current);
        return;
    }
    const next = current === 'dark' ? 'light' : 'dark';

    // Add transition class for smooth theme switch
    document.documentElement.setAttribute('data-theme-transitioning', '');

    applyTheme(next);
    saveThemePreference(next);

    // Remove transition class after animation completes
    setTimeout(function() {
        document.documentElement.removeAttribute('data-theme-transitioning');
    }, 350);
}

/**
 * Initialize the theme toggle button.
 * Sets up click handler that does NOT trigger tab restoration.
 */
function initThemeToggle() {
    const toggleBtn = document.getElementById('themeToggle');
    if (!toggleBtn) {
        return;
    }

    // Apply current theme to toggle icons
    const theme = getEffectiveTheme();
    if (theme !== 'dark' && theme !== 'light') {
        console.error('initThemeToggle: unexpected theme:', theme);
        return;
    }
    applyTheme(theme);

    // Click handler — stops propagation so it doesn't trigger restore()
    toggleBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        toggleTheme();
    });

    // Also stop keydown from restoring when toggle is focused
    toggleBtn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            toggleTheme();
        }
    });
}

// Flag to prevent double-click race condition
let isRestoring = false;

// Restore the original tab
async function restore() {
    // Prevent multiple restoration attempts
    if (isRestoring) return;
    isRestoring = true;

    if (!originalUrl) {
        isRestoring = false;
        console.error('No original URL to restore');
        showError('Cannot restore tab - URL not found. Please close this tab.');
        return;
    }

    // Validate URL before redirect (security fix)
    try {
        const urlObj = new URL(originalUrl);

        // Only web, file and ftp pages (never javascript:, data:, chrome:)
        if (!['http:', 'https:', 'file:', 'ftp:'].includes(urlObj.protocol)) {
            isRestoring = false; // release the lock — otherwise this tab can never be restored again
            console.error('Invalid protocol for restore:', urlObj.protocol);
            showError('Cannot restore this tab - invalid URL protocol');
            return;
        }
    } catch (e) {
        isRestoring = false;
        console.error('Invalid URL:', originalUrl);
        showError('Cannot restore this tab - invalid URL. Please close this tab.');
        return;
    }

    // Add visual feedback
    document.body.style.opacity = '0.5';
    document.body.style.pointerEvents = 'none';

    // Hand the saved scroll position to background; the content script picks it
    // up on CONTENT_SCRIPT_READY. Never wait more than 300 ms for the reply.
    if (savedScrollX > 0 || savedScrollY > 0) {
        await notifyRestoring();
    }

    try {
        // Navigate to original URL using replace() to prevent back-button loop
        window.location.replace(originalUrl);
    } catch (error) {
        isRestoring = false;
        console.error('Failed to restore tab:', error);
        showError('Failed to restore tab. Please close this tab.');
    }
}

function notifyRestoring() {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, 300);
        try {
            chrome.runtime.sendMessage({
                type: 'SUSPENDED_RESTORING',
                url: originalUrl,
                scrollX: savedScrollX,
                scrollY: savedScrollY
            }).then(() => { clearTimeout(timer); resolve(); })
              .catch(() => { clearTimeout(timer); resolve(); });
        } catch (e) {
            clearTimeout(timer);
            resolve();
        }
    });
}

// Show error message to user
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #ef4444; color: white; padding: 12px 24px; border-radius: 8px; font-size: 14px; z-index: 9999;';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

// Also initialize immediately if DOM already loaded
if (document.readyState !== 'loading') {
    init();
}
