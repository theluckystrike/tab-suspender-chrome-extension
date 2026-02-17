# Tab Suspender — Technical Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│                   Chrome Browser                 │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Popup   │  │ Options  │  │Content Script │  │
│  │  (UI)    │  │  Page    │  │ (per tab)     │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │           │
│       └──────────┬───┘───────────────┘           │
│                  │ Chrome Messages API            │
│           ┌──────▼──────┐                        │
│           │   Service   │                        │
│           │   Worker    │                        │
│           │  (Background)│                       │
│           └──────┬──────┘                        │
│                  │                               │
│           ┌──────▼──────┐                        │
│           │chrome.storage│                       │
│           │   .local     │                       │
│           └─────────────┘                        │
└─────────────────────────────────────────────────┘
```

## Module Descriptions

| Module | File | Responsibility |
|--------|------|---------------|
| **Service Worker** | `background.js` | Tab lifecycle management, suspension timers, idle detection |
| **Popup UI** | `popup.js` | Quick controls, tab list, suspend/unsuspend actions |
| **Options Page** | `options.js` | User preferences, whitelist management, timer configuration |
| **Content Script** | `content.js` | Page state detection, form change monitoring |
| **Tab Manager** | `tab-manager.js` | Core suspension logic, tab state tracking |

## Data Flow

1. **Tab Monitoring**: The service worker listens to `chrome.tabs.onUpdated`, `chrome.tabs.onActivated`, and `chrome.idle.onStateChanged` events.
2. **Suspension Decision**: When a tab exceeds the configured idle timeout, the tab manager evaluates whitelist rules, pinned status, and audio state.
3. **Suspension**: The tab's URL is replaced with a lightweight placeholder page that displays the original title and favicon while freeing memory.
4. **Restoration**: Clicking the suspended tab or using the popup triggers navigation back to the original URL.

## Chrome Extension APIs Used

| API | Purpose |
|-----|---------|
| `chrome.tabs` | Tab querying, updating, and event monitoring |
| `chrome.storage.local` | Persisting settings and whitelist rules |
| `chrome.alarms` | Scheduling periodic suspension checks |
| `chrome.idle` | Detecting system idle state |
| `chrome.runtime` | Message passing between components |
| `chrome.action` | Badge text showing suspended tab count |

## Build & Development

```bash
# Clone the repository
git clone https://github.com/theluckystrike/tab-suspender-chrome-extension.git
cd tab-suspender-chrome-extension

# Load as unpacked extension
# 1. Open chrome://extensions
# 2. Enable Developer Mode
# 3. Click "Load unpacked" and select the project directory

# No build step required — plain JavaScript, no bundler
```

### Project Structure

```
├── manifest.json        # Extension manifest (MV3)
├── background.js        # Service worker entry point
├── popup/               # Popup UI files
├── options/             # Options page files
├── content/             # Content scripts
├── icons/               # Extension icons
└── lib/                 # Shared utilities
```

## Design Decisions

- **No Bundler**: The extension uses plain JavaScript to minimize tooling complexity and simplify contribution.
- **Manifest V3**: Built on the latest Chrome extension platform for long-term compatibility.
- **Local Storage Only**: All data stays on-device. No external servers or analytics.
- **Lightweight Suspend Page**: The placeholder page is a minimal HTML file to maximize memory savings.
