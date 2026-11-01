/**
 * Tab Suspender Pro - Content Script
 *
 * Runs on web pages to detect activity and capture state
 */

(function () {
    // Global flag to track if extension context is still valid
    // Once set to false, all chrome API calls will be skipped
    let contextValid = true;

    // Reference to the MutationObserver for cleanup
    let observer = null;

    // Helper function to check if extension context is still valid
    function isContextValid() {
        if (!contextValid) {
            return false;
        }
        try {
            const valid = chrome.runtime?.id !== undefined;
            if (!valid) {
                contextValid = false;
            }
            return valid;
        } catch (e) {
            // Any error checking context means context is invalid
            contextValid = false;
            return false;
        }
    }

    // Mark context as invalid and clean up resources
    function invalidateContext() {
        if (!contextValid) return; // Already invalidated
        contextValid = false;
        // Disconnect observer if it exists
        if (observer) {
            try {
                observer.disconnect();
            } catch (e) {
                // Silently ignore - observer may already be disconnected
            }
            observer = null;
        }
    }

    // Safe wrapper for chrome.runtime.sendMessage that handles context invalidation
    async function safeSendMessage(message) {
        if (!contextValid) {
            return undefined;
        }
        if (!isContextValid()) {
            return undefined;
        }
        try {
            return await chrome.runtime.sendMessage(message);
        } catch (e) {
            // Context invalidated - extension was reloaded/updated
            // This is expected behavior, so we silently invalidate and return
            if (e.message?.includes('Extension context invalidated') ||
                e.message?.includes('message port closed') ||
                e.message?.includes('Receiving end does not exist')) {
                invalidateContext();
                return undefined;
            }
            // For any other unexpected error, also invalidate to be safe
            invalidateContext();
            return undefined;
        }
    }

    // Track user activity
    let lastActivity = Date.now();
    let hasUnsavedForms = false;
    // True once the user typed into a text-like field, a textarea or a
    // contenteditable on this document. Until then the page is reported clean:
    // <select> menus, autofill and script-set values are not unsaved work.
    let interacted = false;
    let editableDirty = false;
    const TEXT_INPUT_SKIP = ['hidden', 'submit', 'button', 'reset', 'image', 'file', 'checkbox', 'radio'];

    // Activity events to track (removed mousemove - too noisy, fires 30-60x/second)
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];

    // Debounce settings - only notify background once per 30 seconds
    const ACTIVITY_DEBOUNCE_MS = 30000;
    let lastActivityNotification = 0;

    // Update activity timestamp (debounced to prevent message flooding)
    function updateActivity() {
        // Skip if context is invalid
        if (!contextValid) return;

        lastActivity = Date.now();

        // Only send message if 30+ seconds since last notification
        if (lastActivity - lastActivityNotification >= ACTIVITY_DEBOUNCE_MS) {
            lastActivityNotification = lastActivity;
            safeSendMessage({
                type: 'TAB_ACTIVITY',
                timestamp: lastActivity
            });
        }
    }

    // Is this element something the user types into?
    function isTextLikeField(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.isContentEditable) return true;
        const tag = el.tagName;
        if (tag === 'TEXTAREA') return true;
        if (tag !== 'INPUT') return false;
        const type = (el.type || 'text').toLowerCase();
        return !TEXT_INPUT_SKIP.includes(type);
    }

    // Report the form state to the background when it changes, including the
    // return to clean (so a cleared form lets the tab sleep again).
    function reportFormStatus(changed) {
        if (changed === hasUnsavedForms) return;
        hasUnsavedForms = changed;
        safeSendMessage({
            type: 'FORM_STATUS',
            hasUnsavedForms: changed
        });
    }

    // Check for unsaved form data. <select> elements are ignored (they have no
    // defaultValue and flagged every page with a menu); nothing counts until the
    // user has typed somewhere on this document.
    function checkFormChanges() {
        // Skip if context is invalid
        if (!contextValid) return;

        if (!interacted) {
            reportFormStatus(false);
            return;
        }

        let changed = editableDirty;
        if (!changed) {
            const inputs = document.querySelectorAll('input, textarea');
            for (const input of inputs) {
                if (input.disabled || input.readOnly) continue;
                const type = input.tagName === 'TEXTAREA' ? 'textarea' : (input.type || 'text').toLowerCase();
                if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' ||
                    type === 'image' || type === 'file' || type === 'password') continue;

                if (type === 'checkbox' || type === 'radio') {
                    if (input.checked !== input.defaultChecked) { changed = true; break; }
                } else if (input.value !== input.defaultValue) {
                    changed = true;
                    break;
                }
            }
        }

        reportFormStatus(changed);
    }

    // 'input' from a text-like field marks the document as interacted with.
    function onInputEvent(event) {
        if (!contextValid) return;
        const target = event.target;
        if (isTextLikeField(target)) {
            interacted = true;
            if (target.isContentEditable) editableDirty = true;
        }
        checkFormChanges();
    }

    // Scroll back to where the page was before suspension. Late-loading content
    // (images, infinite feeds) can make the first scrollTo land short, so retry a
    // few times while the document is still shorter than the target.
    function restoreScrollWithRetries(x, y) {
        const targetX = Number(x) || 0;
        const targetY = Number(y) || 0;
        if (targetX <= 0 && targetY <= 0) return;

        const attempt = () => {
            try {
                window.scrollTo(targetX, targetY);
            } catch (e) {
                // Ignore - page may forbid programmatic scroll
            }
        };
        const reachedTarget = () =>
            Math.abs(window.scrollY - targetY) <= 2 && Math.abs(window.scrollX - targetX) <= 2;

        attempt();
        [250, 750, 1500].forEach((delay) => {
            setTimeout(() => {
                if (!reachedTarget()) attempt();
            }, delay);
        });
    }

    // Listen for messages from background - wrapped in try-catch for context invalidation
    try {
        if (contextValid && chrome.runtime?.onMessage) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                // Skip processing if context has been invalidated
                if (!contextValid) {
                    return false;
                }

                try {
                    switch (message.type) {
                        case 'GET_PAGE_STATE':
                            // Background asks right before suspending; answer at once
                            sendResponse({
                                scrollX: window.scrollX || 0,
                                scrollY: window.scrollY || 0
                            });
                            break;
                    }
                } catch (e) {
                    // Silently handle any errors during message processing
                    invalidateContext();
                }
                return true;
            });
        }
    } catch (e) {
        // Context already invalid when trying to add listener - silently ignore
        invalidateContext();
    }

    // Set up activity listeners (only if context is valid)
    if (contextValid) {
        activityEvents.forEach(event => {
            document.addEventListener(event, updateActivity, { passive: true });
        });

        // Set up form change detection
        document.addEventListener('input', onInputEvent, { passive: true });
        document.addEventListener('change', checkFormChanges, { passive: true });
    }

    // Detect SPA navigation (URL changes without page reload)
    let lastUrl = location.href;
    const detectSpaNavigation = () => {
        // Skip if context is invalid
        if (!contextValid) return;

        if (location.href !== lastUrl) {
            lastUrl = location.href;
            // Reset form status on SPA navigation
            interacted = false;
            editableDirty = false;
            hasUnsavedForms = false;
            safeSendMessage({
                type: 'FORM_STATUS',
                hasUnsavedForms: false
            });
            // Re-check forms after navigation (only if context still valid)
            setTimeout(() => {
                if (contextValid) checkFormChanges();
            }, 100);
        }
    };

    // Listen for popstate (back/forward navigation) - only if context valid
    if (contextValid) {
        window.addEventListener('popstate', detectSpaNavigation);
    }

    // Use MutationObserver to detect SPA navigation via history.pushState
    // Store in module-level variable for cleanup on context invalidation
    try {
        if (contextValid && document.body) {
            observer = new MutationObserver(() => {
                // Skip if context is invalid
                if (!contextValid) {
                    try {
                        observer.disconnect();
                    } catch (e) {
                        // Silently ignore
                    }
                    return;
                }
                detectSpaNavigation();
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    } catch (e) {
        // Silently handle any observer setup errors
        observer = null;
    }

    // Notify background that content script is ready. The reply carries a scroll
    // position when this page load is a restore from suspended.html.
    safeSendMessage({ type: 'CONTENT_SCRIPT_READY' }).then((reply) => {
        if (reply && reply.scroll && typeof reply.scroll === 'object') {
            restoreScrollWithRetries(reply.scroll.x, reply.scroll.y);
        }
    }).catch(() => {
        // safeSendMessage never rejects; kept for safety
    });
})();
