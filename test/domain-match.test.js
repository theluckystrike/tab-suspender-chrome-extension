const test = require('node:test');
const assert = require('node:assert/strict');
const { hostMatches, isUrlAllowlisted, normalizeDomain } = require('../src/lib/domain-match.js');

test('a root domain covers its subdomains (issue #11)', () => {
    assert.ok(isUrlAllowlisted('https://client.example.com/board', ['example.com']));
    assert.ok(isUrlAllowlisted('https://a.b.example.com/', ['example.com']));
    assert.ok(isUrlAllowlisted('https://example.com/', ['example.com']));
    assert.ok(isUrlAllowlisted('https://www.example.com/', ['example.com']));
});

test('wildcard and www entries are accepted', () => {
    assert.ok(isUrlAllowlisted('https://api.example.com/', ['*.example.com']));
    assert.ok(isUrlAllowlisted('https://example.com/', ['www.example.com']));
    assert.equal(normalizeDomain(' https://Example.com/path '), 'example.com');
});

test('look-alike hosts do not match', () => {
    assert.equal(isUrlAllowlisted('https://notexample.com/', ['example.com']), false);
    assert.equal(isUrlAllowlisted('https://example.com.evil.net/', ['example.com']), false);
    assert.equal(isUrlAllowlisted('https://evil.net/?next=https://example.com', ['example.com']), false);
    assert.equal(hostMatches('mail.google.com', 'google.com.au'), false);
});

test('default allowlist still protects Gmail, Calendar and Docs', () => {
    const defaults = ['mail.google.com', 'calendar.google.com', 'docs.google.com'];
    assert.ok(isUrlAllowlisted('https://mail.google.com/mail/u/0/#inbox', defaults));
    assert.equal(isUrlAllowlisted('https://www.google.com/search?q=x', defaults), false);
});

test('bad input never throws', () => {
    assert.equal(isUrlAllowlisted('not a url', ['example.com']), false);
    assert.equal(isUrlAllowlisted('chrome://extensions', ['example.com']), false);
    assert.equal(isUrlAllowlisted('https://example.com', ['', null, undefined]), false);
});
