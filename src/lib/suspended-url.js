/**
 * Suspended-page detection for Tab Suspender.
 *
 * A URL is a suspended tab only when it is this extension's own suspended.html
 * page. Pass chrome.runtime.getURL('') as extensionBaseUrl. A web page that
 * merely has "suspended.html" in its path or query string is not suspended.
 */
(function (root) {
    function isSuspendedUrl(url, extensionBaseUrl) {
        if (typeof url !== 'string' || !extensionBaseUrl) return false;
        const page = String(extensionBaseUrl) + 'suspended.html';
        return url === page || url.startsWith(page + '?') || url.startsWith(page + '#');
    }

    const api = { isSuspendedUrl };
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TabSuspenderSuspendedUrl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
