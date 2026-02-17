# Settings Guide

This document describes every setting available in Tab Suspender and what it does. Access the Settings page by clicking the gear icon in the Tab Suspender popup, or by going to `chrome://extensions/`, finding Tab Suspender, and clicking "Options."

## Suspension Timeout

**Setting:** Slider from 5 minutes to 24 hours
**Default:** 30 minutes

Controls how long a tab must be inactive before it is automatically suspended. Inactivity is defined as no mouse movement, keyboard input, scrolling, or touch events on the tab. Any user interaction resets the timer.

**Recommendations:**
- **Aggressive savings (10-15 min):** Best for users with many tabs who want maximum memory reclamation.
- **Balanced (30-60 min):** Good default for most users. Tabs you recently viewed stay active, while older tabs are cleaned up.
- **Conservative (2-4 hours):** Best for users who frequently switch between a smaller set of tabs and find frequent restoration disruptive.

## Memory Pressure Threshold

**Setting:** Slider from 50% to 95%
**Default:** 80%

When system RAM usage exceeds this threshold, Tab Suspender becomes more aggressive about suspending tabs. This acts as a safety net — even if tabs have not hit the timeout period, they may be suspended when system memory is critically low.

**Recommendations:**
- **70-75%:** Proactive memory management. Good for systems with 8 GB RAM or less.
- **80%:** Default. Balanced threshold that triggers only when memory is meaningfully constrained.
- **90%+:** Only suspend under severe memory pressure. Best for systems with 16+ GB RAM.

## Auto-Restore on Focus

**Setting:** Toggle (on/off)
**Default:** On

When enabled, clicking on a suspended tab automatically restores it to the original page. When disabled, you need to click the "Restore" button on the suspended page or use the popup to restore tabs.

Most users prefer this on, as it makes suspended tabs behave transparently — you click a tab and it loads, just with a brief reload delay.

## Never Suspend Tabs Playing Audio

**Setting:** Toggle (on/off)
**Default:** On

When enabled, any tab that is currently playing audio (music, video, podcasts, etc.) will not be suspended, regardless of how long it has been inactive. This ensures your Spotify, YouTube, or podcast streams are not interrupted.

Chrome indicates audio playback with a small speaker icon on the tab. Tab Suspender uses the `tab.audible` property to detect this.

## Never Suspend Tabs with Unsaved Forms

**Setting:** Toggle (on/off)
**Default:** On

When enabled, Tab Suspender's content script checks for unsaved form data on the page. If any input fields, textareas, or select elements have been modified from their default values, the tab will not be suspended. This prevents you from losing work in progress, such as a half-written email or a partially filled form.

**How it works:** The content script compares each form element's current value against its `defaultValue` (or `defaultChecked` for checkboxes/radio buttons). If any difference is detected, the tab is marked as having unsaved forms.

**Note:** This detection is best-effort. Some modern single-page applications manage state internally without standard HTML form elements, so the detection may not catch all cases.

## Never Suspend Pinned Tabs

**Setting:** Toggle (on/off)
**Default:** On

When enabled, pinned tabs are never automatically suspended. Pinned tabs are typically your most important, always-on tabs (email, chat, calendar), so keeping them active ensures they are always ready when you switch to them.

If you want pinned tabs to be suspended like any other tab, turn this off.

## Never Suspend the Active Tab

**Setting:** Toggle (on/off)
**Default:** On

When enabled, the tab you are currently viewing (the active/focused tab) is never suspended. This is a safety measure — you would not want the page you are looking at to suddenly be replaced with a suspended page.

This setting should almost always remain on.

## Domain Whitelist

**Setting:** List of domain strings with add/remove controls
**Default:** `mail.google.com`, `calendar.google.com`, `docs.google.com`

Domains on the whitelist are never automatically suspended. The matching is substring-based: a whitelisted domain matches any tab whose hostname contains that string. For example, whitelisting `google.com` would match `mail.google.com`, `docs.google.com`, and `www.google.com`.

### Adding Domains

There are four ways to add a domain:

1. **Settings page:** Type a domain in the input field and click "Add" or press Enter.
2. **Popup shield icon:** Click the shield icon in the popup header while on the site.
3. **Context menu:** Right-click the page and select "Never suspend this site."
4. **Keyboard shortcut:** Press `Alt+W` while on the site.

### Removing Domains

In the Settings page, click the X icon next to any whitelisted domain to remove it.

### Tips

- Whitelist communication tools (Slack, Teams, Discord) if you use them in the browser.
- Whitelist sites that log you out when the page is unloaded.
- Whitelist real-time dashboards or monitoring tools.
- You do not need to whitelist audio sites if "Never suspend tabs playing audio" is on — they are already protected while playing.

## Settings Import/Export

### Export

Click the **Export** button to download your current settings as a JSON file (`tab-suspender-settings.json`). This includes all settings and your whitelist.

### Import

Click the **Import** button and select a previously exported JSON file. Your current settings will be replaced with the imported settings.

This is useful for:
- Backing up your configuration before reinstalling.
- Transferring settings to a new computer.
- Sharing a recommended configuration with colleagues.

## View Statistics

Click the **View Statistics** button to open the Memory Savings Dashboard in a new tab. The dashboard shows:

- **Today's memory saved:** The estimated memory reclaimed by tab suspension today.
- **Lifetime tabs suspended:** The total number of tabs suspended since installation.
- **Historical charts:** Memory savings over time, broken down by day.

Memory savings are estimated at approximately 50 MB per suspended tab. Actual savings vary based on page complexity.

## Keyboard Shortcuts

These are configured in the extension's manifest and can be customized at `chrome://extensions/shortcuts`:

| Shortcut | Action |
|---|---|
| `Alt+S` | Suspend the current tab |
| `Alt+Shift+S` | Suspend all other tabs (except the active one) |
| `Alt+R` | Restore all suspended tabs |
| `Alt+W` | Add the current site to the whitelist |

### Customizing Shortcuts

1. Go to `chrome://extensions/shortcuts` in Chrome.
2. Find Tab Suspender in the list.
3. Click the pencil icon next to any shortcut to change it.
4. Press your desired key combination.

**Note:** If a shortcut conflicts with another extension or Chrome's built-in shortcuts, Chrome will warn you.

## Settings Storage

Settings are stored using `chrome.storage.sync`, which means they sync across Chrome instances if you use Chrome Sync. Memory statistics are stored using `chrome.storage.local` (not synced) because they are specific to each machine.
