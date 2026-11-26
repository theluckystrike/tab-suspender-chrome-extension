const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = file => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');

function event() {
    let listener;
    return {
        addListener(callback) { listener = callback; },
        emit(...args) {
            assert.ok(listener, 'Expected an event listener to be registered');
            return listener(...args);
        }
    };
}

function createBackground() {
    const tabs = new Map([
        [1, { id: 1, url: 'https://example.org/active', title: 'Active', active: true, pinned: false, audible: false }],
        [2, { id: 2, url: 'https://example.org/form', title: 'Form', active: false, pinned: false, audible: false }],
        [3, { id: 3, url: 'https://example.org/clean', title: 'Clean', active: false, pinned: false, audible: false }]
    ]);
    const updates = [];
    const onUpdated = event();
    const onRemoved = event();
    const chrome = {
        runtime: {
            onInstalled: event(),
            onStartup: event(),
            onMessage: event(),
            getURL: url => `chrome-extension://test/${url}`
        },
        contextMenus: { onClicked: event() },
        commands: { onCommand: event() },
        tabs: {
            onActivated: event(), onUpdated, onRemoved, onCreated: event(),
            get: async id => tabs.get(id),
            query: async (_query, callback) => {
                const list = [...tabs.values()];
                if (callback) callback(list);
                return list;
            },
            update: async (id, change) => {
                updates.push({ id, ...change });
                tabs.set(id, { ...tabs.get(id), ...change });
            }
        },
        storage: {
            sync: { get: async () => ({}), set: async () => {} },
            local: { get: async () => ({}), set: async () => {} }
        },
        action: {
            setBadgeText: async () => {},
            setBadgeBackgroundColor: async () => {}
        },
        windows: { getAll: async () => [] }
    };
    const context = vm.createContext({
        chrome,
        console: { log() {}, error() {} },
        importScripts(...files) { for (const file of files) vm.runInContext(source(file), context, { filename: file }); },
        TabSuspenderDomainMatch: { isUrlAllowlisted: () => false },
        URL, URLSearchParams, Date, Map, Promise,
        setTimeout: () => 1,
        clearTimeout() {}
    });
    vm.runInContext(source('background.js'), context, { filename: 'background.js' });

    return {
        tabs, updates, onUpdated, onRemoved,
        handleMessage: vm.runInContext('handleMessage', context),
        shouldSuspendTab: vm.runInContext('shouldSuspendTab', context),
        suspendAllExcept: vm.runInContext('suspendAllExcept', context)
    };
}

function createContent(inputs) {
    const sent = [];
    const listeners = new Map();
    const document = {
        readyState: 'complete',
        querySelectorAll: () => inputs,
        addEventListener: (name, handler) => listeners.set(name, handler)
    };
    const chrome = {
        runtime: {
            onMessage: { addListener() {} },
            sendMessage: message => {
                sent.push(message);
                return Promise.resolve({ success: true });
            }
        }
    };
    const context = { document, chrome, window: { addEventListener() {} }, Date };
    vm.runInNewContext(source('contentScript.js'), context, { filename: 'contentScript.js' });
    return {
        statuses: () => sent.filter(message => message.type === 'FORM_STATUS').map(message => message.hasUnsavedForms),
        check: () => listeners.get('change')()
    };
}

test('dirty form status prevents suspension by default', async () => {
    const worker = createBackground();
    assert.equal(await worker.shouldSuspendTab(2), true);
    await worker.handleMessage({ type: 'FORM_STATUS', hasUnsavedForms: true }, { tab: { id: 2 } });
    assert.equal(await worker.shouldSuspendTab(2), false);
    assert.equal(await worker.shouldSuspendTab(3), true);
});

test('clearing a form allows suspension again', async () => {
    const worker = createBackground();
    await worker.handleMessage({ type: 'FORM_STATUS', hasUnsavedForms: true }, { tab: { id: 2 } });
    await worker.handleMessage({ type: 'FORM_STATUS', hasUnsavedForms: false }, { tab: { id: 2 } });
    assert.equal(await worker.shouldSuspendTab(2), true);
});

test('user can disable unsaved-form protection', async () => {
    const worker = createBackground();
    await worker.handleMessage({ type: 'FORM_STATUS', hasUnsavedForms: true }, { tab: { id: 2 } });
    await worker.handleMessage({ type: 'SAVE_SETTINGS', settings: { neverSuspendUnsavedForms: false } }, {});
    assert.equal(await worker.shouldSuspendTab(2), true);
});

test('form status must originate from a tab and carry a boolean', async () => {
    const worker = createBackground();
    await worker.handleMessage({ type: 'FORM_STATUS', hasUnsavedForms: true }, {});
    await worker.handleMessage({ type: 'FORM_STATUS', hasUnsavedForms: 'true' }, { tab: { id: 2 } });
    assert.equal(await worker.shouldSuspendTab(2), true);
});

test('navigation clears stale unsaved-form state', async () => {
    const worker = createBackground();
    await worker.handleMessage({ type: 'FORM_STATUS', hasUnsavedForms: true }, { tab: { id: 2 } });
    worker.onUpdated.emit(2, { status: 'loading' }, worker.tabs.get(2));
    assert.equal(await worker.shouldSuspendTab(2), true);
});

test('closing a tab clears its unsaved-form state', async () => {
    const worker = createBackground();
    await worker.handleMessage({ type: 'FORM_STATUS', hasUnsavedForms: true }, { tab: { id: 2 } });
    worker.onRemoved.emit(2);
    assert.equal(await worker.shouldSuspendTab(2), true);
});

test('suspend others skips edited forms but suspends clean tabs', async () => {
    const worker = createBackground();
    await worker.handleMessage({ type: 'FORM_STATUS', hasUnsavedForms: true }, { tab: { id: 2 } });
    const count = await worker.suspendAllExcept(1);
    assert.equal(count, 1);
    assert.deepEqual(worker.updates.map(change => change.id), [3]);
});

test('unchanged select does not report an unsaved form', () => {
    const select = {
        tagName: 'SELECT', type: 'select-one', value: 'first',
        options: [
            { selected: true, defaultSelected: true },
            { selected: false, defaultSelected: false }
        ]
    };
    const content = createContent([select]);
    assert.deepEqual(content.statuses(), []);
    select.options[0].selected = false;
    select.options[1].selected = true;
    content.check();
    assert.deepEqual(content.statuses(), [true]);
    select.options[0].selected = true;
    select.options[1].selected = false;
    content.check();
    assert.deepEqual(content.statuses(), [true, false]);
});

test('multi-select options use selected versus defaultSelected', () => {
    const select = {
        tagName: 'SELECT', type: 'select-multiple',
        options: [
            { selected: true, defaultSelected: true },
            { selected: false, defaultSelected: false }
        ]
    };
    const content = createContent([select]);
    assert.deepEqual(content.statuses(), []);
    select.options[1].selected = true;
    content.check();
    assert.deepEqual(content.statuses(), [true]);
});

test('text input and checkbox changes still report status', () => {
    const text = { tagName: 'INPUT', type: 'text', value: '', defaultValue: '' };
    const checkbox = { tagName: 'INPUT', type: 'checkbox', checked: false, defaultChecked: false };
    const content = createContent([text, checkbox]);
    text.value = 'unfinished';
    content.check();
    assert.deepEqual(content.statuses(), [true]);
    text.value = '';
    checkbox.checked = true;
    content.check();
    assert.deepEqual(content.statuses(), [true]);
    checkbox.checked = false;
    content.check();
    assert.deepEqual(content.statuses(), [true, false]);
});
