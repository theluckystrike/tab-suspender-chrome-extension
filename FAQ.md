# Frequently Asked Questions

## How does tab suspension work?

When a tab is suspended, Tab Suspender replaces its content with a lightweight local HTML page that shows the original page title, favicon, and a timestamp. The original URL is preserved as a parameter. This lets Chrome release the memory used by the original page's DOM, JavaScript runtime, and media. When you click a suspended tab, the extension navigates back to the original URL, reloading the page. Everything happens locally — no data is sent anywhere.

## Will I lose my tab content?

Suspended tabs retain the original URL, page title, and favicon. When restored, the page reloads from the original URL. Server-side state (like being logged in) is not affected. Client-side state that was not saved (such as unsubmitted form text) may be lost, but Tab Suspender detects unsaved form data and will not suspend a tab with pending input when the "Never suspend tabs with unsaved forms" setting is enabled (on by default).

## How do I whitelist websites?

There are four ways to whitelist a domain:
1. **Popup**: Click the shield icon while on the site.
2. **Keyboard**: Press `Alt+W` on the site.
3. **Context menu**: Right-click the page and select "Never suspend this site."
4. **Settings**: Open Settings, scroll to the Whitelist section, and type a domain.

Default whitelist: `mail.google.com`, `calendar.google.com`, `docs.google.com`.

## Does it work with Chrome tab groups?

Yes. Tab Suspender respects Chrome's tab groups. Suspended tabs stay in their groups and the group structure is preserved during suspension and restoration. The two features serve complementary purposes: tab groups for organization, Tab Suspender for memory management.

## How much memory will I save?

A typical web page uses 50-300 MB of RAM. When suspended, that drops to approximately 5-10 MB. With 25 tabs open and most suspended, you can save 1-4 GB of RAM. The popup and Statistics Dashboard track your actual savings over time.

## Is it open source?

Yes. Tab Suspender is fully open source under the MIT License. The complete source code is at [github.com/theluckystrike/tab-suspender-chrome-extension](https://github.com/theluckystrike/tab-suspender-chrome-extension). There are no minified files, no external dependencies, and no network requests. You can audit every line of code.

## How do I unsuspend all tabs?

Click the Tab Suspender icon and press "Restore All," or use the keyboard shortcut `Alt+R`. All suspended tabs across all windows will be restored.

## Does it conflict with other extensions?

Tab Suspender generally does not conflict with other extensions. Ad blockers, dark mode extensions, and similar tools work fine — they re-apply their modifications when a restored tab reloads. Avoid running two tab suspension extensions simultaneously, as they may interfere with each other.

## What permissions does it need and why?

| Permission | Purpose |
|---|---|
| `storage` | Save settings and statistics locally |
| `activeTab` | Identify the currently focused tab |
| `tabs` | List and manage tabs for suspension/restoration |
| `tabGroups` | Work with Chrome's tab groups |
| `scripting` | Detect user activity and unsaved forms on pages |
| `contextMenus` | Right-click menu options |
| `notifications` | Reserved for future use |
| `<all_urls>` | Run the activity detection content script on any page |

No data is collected or transmitted. See [SECURITY.md](SECURITY.md) for details.

## How do I report a bug?

Open an issue on the [GitHub Issues page](https://github.com/theluckystrike/tab-suspender-chrome-extension/issues) with:
- Description of the problem
- Steps to reproduce
- Expected vs. actual behavior
- Chrome version and OS
- Screenshots if applicable
