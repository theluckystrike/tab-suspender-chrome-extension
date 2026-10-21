/**
 * Allowlist matching for Tab Suspender.
 *
 * An entry matches its own host and every subdomain of it, on a label boundary.
 * "example.com" matches example.com, www.example.com and app.example.com,
 * but never notexample.com or example.com.evil.net. A leading "*." and a
 * leading "www." are accepted and ignored. Matching is case-insensitive.
 */
(function (root) {
    function normalizeDomain(entry) {
        let d = String(entry || '').trim().toLowerCase();
        d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');   // tolerate a pasted URL
        d = d.split('/')[0].split(':')[0];
        if (d.startsWith('*.')) d = d.slice(2);
        if (d.startsWith('www.')) d = d.slice(4);
        return d.replace(/\.$/, '');
    }

    function hostMatches(hostname, entry) {
        const d = normalizeDomain(entry);
        if (!d) return false;
        let h = String(hostname || '').toLowerCase().replace(/\.$/, '');
        if (h.startsWith('www.')) h = h.slice(4);
        return h === d || h.endsWith('.' + d);
    }

    function isUrlAllowlisted(url, entries) {
        try {
            const { hostname } = new URL(url);
            return (entries || []).some(entry => hostMatches(hostname, entry));
        } catch {
            return false;
        }
    }

    const api = { normalizeDomain, hostMatches, isUrlAllowlisted };
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TabSuspenderDomainMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
