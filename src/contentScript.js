/**
 * Tab Suspender - Content Script
 * 
 * Runs on web pages to detect activity and capture state
 */

(function () {
    // Track user activity
    let lastActivity = Date.now();
    let hasUnsavedForms = false;

    // Activity events to track
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'mousemove', 'touchstart'];

    // Update activity timestamp
    function updateActivity() {
        lastActivity = Date.now();
        chrome.runtime.sendMessage({
            type: 'TAB_ACTIVITY',
            timestamp: lastActivity
        }).catch(() => { });
    }

    // Check for unsaved form data
    function checkFormChanges() {
        const inputs = document.querySelectorAll('input, textarea, select');
        let changed = false;

        inputs.forEach(input => {
            if (input.type === 'password' || input.type === 'file') return;

            if (input.type === 'checkbox' || input.type === 'radio') {
                if (input.checked !== input.defaultChecked) changed = true;
            } else {
                if (input.value !== input.defaultValue) changed = true;
            }
        });

        if (changed !== hasUnsavedForms) {
            hasUnsavedForms = changed;
            chrome.runtime.sendMessage({
                type: 'FORM_STATUS',
                hasUnsavedForms: changed
            }).catch(() => { });
        }
    }

    // Get current scroll position
    function getScrollPosition() {
        return {
            x: window.scrollX,
            y: window.scrollY
        };
    }

    // Get form data for preservation
    function getFormData() {
        const forms = {};
        const inputs = document.querySelectorAll('input, textarea, select');

        inputs.forEach((input, idx) => {
            if (input.type === 'password' || input.type === 'file') return;

            const id = input.id || input.name || `field_${idx}`;
            forms[id] = {
                value: input.value,
                type: input.type,
                checked: input.checked,
                tagName: input.tagName.toLowerCase()
            };
        });

        return forms;
    }

    // Restore form data
    function restoreFormData(formData) {
        Object.entries(formData).forEach(([id, data]) => {
            let el = document.getElementById(id);
            if (!el) el = document.querySelector(`[name="${id}"]`);
            if (!el && id.startsWith('field_')) {
                const idx = parseInt(id.replace('field_', ''));
                const inputs = document.querySelectorAll('input, textarea, select');
                el = inputs[idx];
            }

            if (el) {
                if (data.type === 'checkbox' || data.type === 'radio') {
                    el.checked = data.checked;
                } else {
                    el.value = data.value;
                }
            }
        });
    }

    // Restore scroll position
    function restoreScrollPosition(x, y) {
        window.scrollTo(x, y);
    }

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case 'GET_TAB_STATE':
                sendResponse({
                    scrollPosition: getScrollPosition(),
                    formData: getFormData(),
                    lastActivity: lastActivity,
                    hasUnsavedForms: hasUnsavedForms
                });
                break;

            case 'RESTORE_STATE':
                if (message.scrollPosition) {
                    restoreScrollPosition(message.scrollPosition.x, message.scrollPosition.y);
                }
                if (message.formData) {
                    restoreFormData(message.formData);
                }
                sendResponse({ success: true });
                break;

            case 'GET_ACTIVITY':
                sendResponse({
                    lastActivity: lastActivity,
                    idleTime: Date.now() - lastActivity
                });
                break;
        }
        return true;
    });

    // Set up activity listeners
    activityEvents.forEach(event => {
        document.addEventListener(event, updateActivity, { passive: true });
    });

    // Set up form change detection
    document.addEventListener('input', checkFormChanges, { passive: true });
    document.addEventListener('change', checkFormChanges, { passive: true });

    // Initial form check after page load
    if (document.readyState === 'complete') {
        checkFormChanges();
    } else {
        window.addEventListener('load', checkFormChanges);
    }

    // Notify background that content script is ready
    chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' }).catch(() => { });
})();
