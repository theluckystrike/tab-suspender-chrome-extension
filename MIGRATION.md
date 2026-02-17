# Migration Guide — From The Great Suspender to Tab Suspender

## What Happened

The Great Suspender was the most popular tab suspension extension for Chrome, used by over 2 million people. In late 2020, the original developer sold the extension to an unknown entity. In February 2021, Google removed it from the Chrome Web Store after detecting that new versions contained code capable of executing remote scripts, effectively making it malware. Chrome disabled the extension for all users.

Because The Great Suspender stored suspended tabs using its own internal URL scheme, users who had many suspended tabs lost access to those pages when the extension was disabled.

This event demonstrated the risks of relying on closed-source browser extensions, especially ones that change ownership without transparency.

## Transitioning to Tab Suspender

### Step 1: Install Tab Suspender

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/tab-suspender-pro-save-me/ofgncemnlblfnocjbojdhamacfffcpnm). The extension starts working immediately with sensible defaults.

### Step 2: Recover Previously Suspended Tabs

If you still have tabs suspended by The Great Suspender or another extension, they may appear as broken pages with URLs like `chrome-extension://[old-extension-id]/suspended.html#...`. To recover these:

1. Look at the URL of each broken tab. The original URL is typically embedded as a parameter (e.g., after `uri=`).
2. Copy the original URL and paste it into the address bar.
3. Community recovery tools are available — search for "Great Suspender recovery" for options.

Tab Suspender cannot automatically recover tabs from other extensions because each extension uses its own internal URL scheme.

### Step 3: Configure Preferences

Open Settings (gear icon in the popup) and adjust to your preferences. See the feature mapping below.

### Step 4: Remove the Old Extension

Uninstall any previous tab suspension extension from `chrome://extensions/` to avoid conflicts.

## Feature Mapping

| Great Suspender Feature | Tab Suspender Equivalent | Notes |
|---|---|---|
| Auto-suspend after timeout | Suspension timeout slider | Configurable from 5 minutes to 24 hours |
| Whitelist URLs | Domain whitelist | Via Settings, popup, context menu, or Alt+W |
| Don't suspend pinned tabs | Pinned tab protection | Enabled by default |
| Don't suspend active tab | Active tab protection | Enabled by default |
| Don't suspend audio tabs | Audio tab protection | Enabled by default |
| Suspend all tabs | Suspend All button | Popup button or Alt+Shift+S |
| Unsuspend all tabs | Restore All button | Popup button or Alt+R |
| Keyboard shortcuts | Keyboard shortcuts | Alt+S, Alt+Shift+S, Alt+R, Alt+W |
| Context menu | Context menu | Suspend, restore, whitelist via right-click |
| Suspended tab page | Suspended tab page | Shows favicon, title, memory saved, time |
| Theme options | — | Clean default design |
| Screenshot on suspend | — | Not supported; prioritizes lightweight suspension |

### Features Unique to Tab Suspender

- **Unsaved form protection** — Tabs with pending form input are not suspended.
- **Memory savings dashboard** — Track RAM savings over time with historical charts.
- **Tab search and filtering** — Find any tab by title or URL, filter by status.
- **Settings import/export** — Back up and restore configuration as JSON.
- **Tab group support** — Works with Chrome's native tab groups.
- **Badge counter** — See suspended tab count on the extension icon.

## Recommended Settings for Former Great Suspender Users

- **Suspension timeout**: The Great Suspender defaulted to 60 minutes. Tab Suspender defaults to 30 minutes. Adjust to your preference.
- **Auto-restore on focus**: Enabled by default. Matches Great Suspender behavior where clicking a suspended tab restores it.
- **Protection rules**: All enabled by default (audio, forms, pinned, active tab).
- **Whitelist**: Add any domains you had whitelisted previously. Gmail, Google Calendar, and Google Docs are included by default.

## Why Tab Suspender

Tab Suspender was built from scratch to address the trust issues that led to The Great Suspender's removal:

- **100% open source** under MIT license — every line of code is public.
- **No external dependencies** — no network requests, no remote scripts.
- **Manifest V3** — Chrome's most secure extension platform.
- **No data collection** — no analytics, no telemetry, no tracking.
