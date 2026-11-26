const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const popupSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup.js'), 'utf8');

function makeElement() {
    return {
        textContent: '',
        innerHTML: '',
        disabled: false,
        className: '',
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, contains: () => false },
        listeners: {},
        addEventListener(type, fn) { this.listeners[type] = fn; },
        querySelector: () => null
    };
}

// Runs popup.js in a vm with stubbed chrome and DOM APIs. Messages sent to the
// background are recorded, and any direct tab updates are recorded too.
function loadPopup({ tabs = [], responses = {} } = {}) {
    const sent = [];
    const updated = [];
    const actionButtons = [];

    const chrome = {
        runtime: {
            getURL: (page) => `chrome-extension://test/${page}`,
            sendMessage: async (message) => {
                sent.push(JSON.parse(JSON.stringify(message)));
                return responses[message.type];
            }
        },
        tabs: {
            query: async () => tabs,
            update: async (...args) => { updated.push(args); },
            reload: async () => {}
        },
        windows: { update() {} }
    };

    const document = {
        getElementById: () => makeElement(),
        createElement: () => {
            const item = makeElement();
            item.querySelector = (selector) => {
                if (selector !== '.tab-action') return null;
                const actionBtn = makeElement();
                actionButtons.push(actionBtn);
                return actionBtn;
            };
            return item;
        },
        addEventListener() {}
    };

    const context = vm.createContext({
        chrome,
        document,
        console: { log() {}, error() {} },
        setTimeout: () => 0,
        setInterval: () => 0,
        URL,
        URLSearchParams
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'suspended-url.js'), 'utf8'), context);
    vm.runInContext(popupSource, context);

    return { context, sent, updated, actionButtons };
}

test('popup Suspend All asks the background to suspend and shows its count (issue #17)', async () => {
    const { context, sent, updated } = loadPopup({
        tabs: [{ id: 2, url: 'https://news.example.org/', active: false }],
        responses: { SUSPEND_ALL: { success: true, count: 3 } }
    });

    await vm.runInContext('handleSuspendAll()', context);

    assert.deepEqual(sent, [{ type: 'SUSPEND_ALL' }], 'popup does not send SUSPEND_ALL to the background');
    assert.deepEqual(updated, [], 'popup suspended tabs itself instead of asking the background');
    assert.equal(vm.runInContext('suspendAllBtn.textContent', context), 'Suspended 3');
});

test('popup per-tab Suspend and Restore send the tab id to the background (issue #17)', async () => {
    const { context, sent, updated, actionButtons } = loadPopup();

    const suspendTab = { id: 7, url: 'https://news.example.org/', title: 'News', status: 'idle' };
    vm.runInContext(`createTabItem(${JSON.stringify(suspendTab)})`, context);
    actionButtons[0].dataset.action = 'suspend';
    await actionButtons[0].listeners.click({ stopPropagation() {} });

    const restoreTab = { id: 8, url: 'chrome-extension://test/suspended.html', title: 'Old', status: 'suspended' };
    vm.runInContext(`createTabItem(${JSON.stringify(restoreTab)})`, context);
    actionButtons[1].dataset.action = 'restore';
    await actionButtons[1].listeners.click({ stopPropagation() {} });

    assert.deepEqual(sent, [
        { type: 'SUSPEND_TAB', tabId: 7 },
        { type: 'RESTORE_TAB', tabId: 8 }
    ], 'popup does not send SUSPEND_TAB or RESTORE_TAB with the tab id');
    assert.deepEqual(updated, [], 'popup changed tab URLs itself instead of asking the background');
});

test('popup Restore All sends RESTORE_ALL to the background (issue #17)', async () => {
    const { context, sent, updated } = loadPopup({
        tabs: [{ id: 9, url: 'chrome-extension://test/suspended.html?url=x', active: false }]
    });

    await vm.runInContext('handleRestoreAll()', context);

    assert.deepEqual(sent, [{ type: 'RESTORE_ALL' }], 'popup does not send RESTORE_ALL to the background');
    assert.deepEqual(updated, [], 'popup restored tabs itself instead of asking the background');
});
