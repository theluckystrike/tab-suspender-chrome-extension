/**
 * Tab Suspender - Suspended Page JavaScript
 * Handles tab info display and restoration
 */

// Get URL parameters
const params = new URLSearchParams(window.location.search);
const originalUrl = params.get('url');
const title = params.get('title') || 'Suspended Tab';
const favicon = decodeURIComponent(params.get('favicon') || '');
const suspendedAt = parseInt(params.get('time')) || Date.now();

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

    // Set favicon
    if (favicon) {
        pageFavicon.href = favicon;
        faviconImg.src = favicon;
        faviconImg.style.display = 'block';
        faviconImg.onerror = function () {
            this.style.display = 'none';
        };
    } else {
        faviconImg.style.display = 'none';
    }

    // Set tab info
    tabTitle.textContent = title;
    tabUrl.textContent = getDomain(originalUrl);

    // Set memory saved (estimate based on common tab memory usage)
    memorySaved.textContent = '~50 MB';

    // Update time suspended
    updateTimeSuspended();
    setInterval(updateTimeSuspended, 1000);

    // Set up restoration handlers
    setupRestoreHandlers();
}

// Get domain from URL
function getDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return url || 'Unknown';
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
        // Don't restore when clicking external links
        if (e.target.closest('a[target="_blank"]')) return;
        restore();
    });

    // Press any key to restore
    document.addEventListener('keydown', (e) => {
        // Ignore modifier keys and common shortcuts
        if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return;
        if (e.ctrlKey || e.metaKey) return;
        restore();
    });
}

// Restore the original tab
async function restore() {
    if (!originalUrl) {
        console.error('No original URL to restore');
        return;
    }

    // Add visual feedback
    document.body.style.opacity = '0.5';
    document.body.style.pointerEvents = 'none';

    try {
        // Get scroll position and form data from URL params
        const scrollX = parseInt(params.get('scrollX')) || 0;
        const scrollY = parseInt(params.get('scrollY')) || 0;

        // Navigate to original URL
        window.location.href = originalUrl;

        // Note: The background script handles restoration of scroll position
        // and form data when the tab finishes loading
    } catch (error) {
        console.error('Failed to restore tab:', error);
        // Fallback: just navigate
        window.location.href = originalUrl;
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

// Also initialize immediately if DOM already loaded
if (document.readyState !== 'loading') {
    init();
}
