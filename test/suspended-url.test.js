const test = require('node:test');
const assert = require('node:assert/strict');
const { isSuspendedUrl } = require('../src/lib/suspended-url.js');

// chrome.runtime.getURL('') returns the extension base URL with a trailing slash.
const BASE = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';

test('the extension own suspended page is a suspended tab (issue #16)', () => {
    assert.equal(isSuspendedUrl(BASE + 'suspended.html', BASE), true);
    assert.equal(isSuspendedUrl(BASE + 'suspended.html?url=https%3A%2F%2Fexample.org%2F&title=x', BASE), true);
});

test('a web page with suspended.html in its path is not a suspended tab (issue #16)', () => {
    assert.equal(isSuspendedUrl('https://example.com/account-suspended.html', BASE), false);
    assert.equal(isSuspendedUrl('https://example.com/suspended.html', BASE), false);
});

test('a web page with suspended.html only in its query string is not a suspended tab (issue #16)', () => {
    assert.equal(isSuspendedUrl('https://example.com/suspended.html?url=https://example.org/', BASE), false);
    assert.equal(isSuspendedUrl('https://example.com/?page=suspended.html', BASE), false);
});

test('another extension or a lookalike page name is not a suspended tab', () => {
    assert.equal(isSuspendedUrl('chrome-extension://otherid/suspended.html', BASE), false);
    assert.equal(isSuspendedUrl(BASE + 'suspended.htmlx', BASE), false);
});

test('missing or non-string input never throws', () => {
    assert.equal(isSuspendedUrl(undefined, BASE), false);
    assert.equal(isSuspendedUrl(null, BASE), false);
    assert.equal(isSuspendedUrl('', BASE), false);
    assert.equal(isSuspendedUrl(BASE + 'suspended.html', ''), false);
});
