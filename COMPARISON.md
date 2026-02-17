# Tab Management Tools — Honest Comparison

This document provides a factual comparison of Tab Suspender with other tab management tools. Genuine strengths and weaknesses are noted for each.

## Tab Suspender (Zovo)

Tab Suspender replaces inactive tabs with a lightweight local page, freeing memory used by the original page's DOM, JavaScript runtime, and media resources. Built from scratch on Chrome's Manifest V3.

**Strengths:**
- Fully open source (MIT license) with no external dependencies
- Built on Manifest V3, Chrome's latest and most secure extension platform
- No data collection, no analytics, no network requests
- Comprehensive protection rules: audio, unsaved forms, pinned tabs, active tab
- Domain whitelist with multiple access points (popup, context menu, keyboard shortcut, settings)
- Memory savings dashboard with historical tracking
- Keyboard shortcuts for all common actions
- Settings import/export as JSON
- Tab search and filtering by title, URL, or status
- Chrome tab group awareness

**Weaknesses:**
- Newer project with a smaller user base compared to established alternatives
- Memory savings are estimated (~50 MB/tab) rather than precisely measured per tab
- Restoring a suspended tab reloads the page, so ephemeral client-side state is lost
- No cross-browser support outside Chromium-based browsers

## The Great Suspender

**Status:** Removed from Chrome Web Store (February 2021)

The most popular tab suspender historically, with over 2 million users. Removed after an ownership change led to malware injection.

**Strengths (when active):** Large user base, mature feature set, many configuration options, tab screenshots on suspension.

**Weaknesses:** Sold to unknown entity, injected malware (remote script execution), built on deprecated Manifest V2, no longer available, abandoned codebase.

## Auto Tab Discard

**Status:** Active on Chrome Web Store

Uses Chrome's native `chrome.tabs.discard()` API to unload tab memory without replacing the page with a custom suspended page.

**Strengths:**
- Uses Chrome's built-in tab discarding mechanism
- Minimal visual disruption (discarded tabs look the same in the tab bar)
- No custom suspended page
- Open source

**Weaknesses:**
- Less control over which tabs are discarded (Chrome's API has limitations)
- No memory savings tracking or dashboard
- No visual indicator showing which tabs are discarded
- Limited configuration options compared to dedicated suspender extensions
- Chrome may override discarding decisions
- Some users report unreliable behavior with Chrome's native discarding

## The Marvellous Suspender

**Status:** Active on Chrome Web Store

A community fork of The Great Suspender. Maintainers stripped the malicious code and continued development.

**Strengths:**
- Familiar interface for former Great Suspender users
- Community maintained
- Preserves much of The Great Suspender's feature set

**Weaknesses:**
- Based on The Great Suspender's older codebase
- Originally Manifest V2 (migration to V3 underway)
- Carries the legacy of the compromised original
- Smaller development team

## OneTab

**Status:** Active on Chrome Web Store

Collapses all open tabs into a single list page. A tab decluttering tool rather than a tab suspender.

**Strengths:**
- Drastically reduces the number of open tabs
- Simple, focused interface
- Good for batch-saving tabs for later
- Long track record

**Weaknesses:**
- Tabs are closed and replaced with a list, not suspended in place
- Not transparent (tabs disappear from the tab bar)
- Cannot restore individual tabs to their previous position easily
- Requires manual action (does not work automatically in the background)
- Closed source
- Fundamentally different use case from tab suspension

## Feature Comparison

| Feature | Tab Suspender | The Great Suspender | Auto Tab Discard | Marvellous Suspender | OneTab |
|---------|:---:|:---:|:---:|:---:|:---:|
| Available on CWS | Yes | Removed | Yes | Yes | Yes |
| Open Source | Yes | No | Yes | Yes | No |
| Manifest V3 | Yes | No (V2) | No (V2) | Partial | Yes |
| No Data Collection | Yes | No | Yes | Yes | Unknown |
| Auto-Suspend | Yes | Yes | Yes | Yes | No |
| Configurable Timeout | 5m - 24h | 20s - 3d | Limited | 20s - 3d | N/A |
| Domain Whitelist | Yes | Yes | Limited | Yes | No |
| Audio Protection | Yes | No | No | Partial | N/A |
| Form Protection | Yes | No | No | No | N/A |
| Pinned Tab Protection | Yes | Yes | No | Yes | N/A |
| Keyboard Shortcuts | 4 shortcuts | Yes | No | Yes | No |
| Context Menu | Yes | Yes | No | Yes | No |
| Memory Dashboard | Yes | No | No | No | No |
| Settings Import/Export | Yes | No | No | No | No |
| Tab Search/Filter | Yes | No | No | No | List search |
| Tab Group Support | Yes | No | No | No | No |

## Choosing the Right Tool

- **For automatic tab suspension with full control:** Tab Suspender
- **For Chrome's native memory management:** Auto Tab Discard
- **For collapsing tabs into a list:** OneTab
- **For a familiar Great Suspender experience:** The Marvellous Suspender
