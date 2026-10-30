const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const srcDir = path.join(__dirname, '..', 'src');
const read = (file) => fs.readFileSync(path.join(srcDir, file), 'utf8');

const events = () => ({ addListener() {} });

// Runs background.js in a vm with stubbed chrome APIs. Tab changes are applied to
// `tabs` so later queries see the suspended or restored URLs.
function loadBackground(tabs) {
    const updates = [];

    const chrome = {
        runtime: { getURL: (page) => `chrome-extension://test/${page}`, onInstalled: events(), onStartup: events(), onMessage: events() },
        tabs: {
            query: async () => tabs,
            get: async (id) => tabs.find(t => t.id === id),
            update: async (id, props) => {
                updates.push({ id, url: props.url });
                tabs.find(t => t.id === id).url = props.url;
            },
            reload: async () => {},
            onActivated: events(),
            onUpdated: events(),
            onRemoved: events(),
            onCreated: events()
        },
        storage: {
            sync: { get: async () => ({}), set: async () => {} },
            local: { get: async () => ({}), set: async () => {} }
        },
        action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
        contextMenus: { onClicked: events() },
        commands: { onCommand: events() }
    };

    const context = vm.createContext({
        chrome,
        console: { log() {}, error: console.error, warn: console.warn },
        URL,
        URLSearchParams,
        setTimeout: () => 0,
        clearTimeout() {},
        setInterval: () => 0
    });
    context.importScripts = (...files) => files.forEach(file => vm.runInContext(read(file), context));
    vm.runInContext(read('background.js'), context);

    const handle = async (message) => JSON.parse(JSON.stringify(
        await vm.runInContext(`handleMessage(${JSON.stringify(message)}, {})`, context)
    ));
    return { handle, updates };
}

test('SUSPEND_ALL suspends only ordinary inactive tabs and returns the count (issue #17)', async () => {
    const tabs = [
        { id: 1, url: 'https://news.example.org/today', active: true },
        { id: 2, url: 'https://news.example.org/a', active: false },
        { id: 3, url: 'https://mail.google.com/mail/u/0/#inbox', active: false },
        { id: 4, url: 'https://pinned.example.net/', active: false, pinned: true },
        { id: 5, url: 'https://music.example.net/', active: false, audible: true },
        { id: 6, url: 'chrome://settings/', active: false }
    ];
    const { handle, updates } = loadBackground(tabs);

    const response = await handle({ type: 'SUSPEND_ALL' });

    assert.deepEqual(response, { success: true, count: 1 }, 'background SUSPEND_ALL did not return count 1');
    assert.deepEqual(updates.map(u => u.id), [2], 'background suspended a tab that the allowlist, pinned or audio rules protect');
    assert.match(updates[0].url, /suspended\.html/);
});

test('SUSPEND_TAB and RESTORE_TAB act on the tab id they are sent (issue #17)', async () => {
    const original = 'https://news.example.org/b';
    const tabs = [
        { id: 7, url: 'https://news.example.org/b', active: false },
        { id: 8, url: 'https://news.example.org/c', active: false }
    ];
    const { handle, updates } = loadBackground(tabs);

    assert.deepEqual(await handle({ type: 'SUSPEND_TAB', tabId: 7 }), { success: true });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, 7);

    assert.deepEqual(await handle({ type: 'RESTORE_TAB', tabId: 7 }), { success: true });
    assert.deepEqual(updates[1], { id: 7, url: original });
});

test('RESTORE_ALL restores only suspended tabs and returns the count (issue #17)', async () => {
    const tabs = [
        { id: 9, url: `chrome-extension://test/suspended.html?url=${encodeURIComponent('https://news.example.org/x')}`, active: false },
        { id: 10, url: 'https://news.example.org/y', active: false }
    ];
    const { handle, updates } = loadBackground(tabs);

    const response = await handle({ type: 'RESTORE_ALL' });

    assert.deepEqual(response, { success: true, count: 1 });
    assert.deepEqual(updates, [{ id: 9, url: 'https://news.example.org/x' }]);
});
