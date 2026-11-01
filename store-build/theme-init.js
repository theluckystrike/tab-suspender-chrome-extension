/**
 * Tab Suspender Pro - Synchronous Theme Init
 * Runs before first paint to prevent white flash on dark-mode systems.
 * Must be loaded in <head> WITHOUT async/defer to block rendering.
 */
(function() {
    var saved = null;
    try { saved = localStorage.getItem('tsp-theme'); } catch {}
    if (saved === 'dark' || saved === 'light') {
        document.documentElement.dataset.theme = saved;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.dataset.theme = 'dark';
    }
})();
