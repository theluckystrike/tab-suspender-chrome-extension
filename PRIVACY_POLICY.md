# Privacy Policy — Tab Suspender

**Last updated:** February 2026

## Overview

Tab Suspender is committed to protecting your privacy. This extension operates entirely within your browser and does not collect, transmit, or share any personal data.

## Data Access

Tab Suspender accesses the following browser data solely to provide its core functionality:

- **Tab URLs and titles** — Used to display tab information and restore suspended tabs to their original pages.
- **Tab activity state** — Used to determine which tabs are idle and eligible for suspension.
- **Favicons** — Displayed on the suspension placeholder page so you can identify tabs visually.

## Data Storage

All data is stored locally on your device using `chrome.storage.local`:

| Data | Purpose | Location |
|------|---------|----------|
| Whitelist rules | Prevent specific sites from being suspended | Local storage |
| Suspension settings | Timer duration, behavior preferences | Local storage |
| Suspended tab URLs | Restore tabs to original pages | Local storage |

**No data is stored on external servers.**

## Data Transmission

Tab Suspender does **not** transmit any data to external servers. Specifically:

- No analytics or telemetry are collected
- No browsing history is recorded or sent
- No personal information is shared with third parties
- No cookies are set by the extension
- No network requests are made by the extension

## Third-Party Services

Tab Suspender uses **no** third-party services, SDKs, or libraries that collect data.

## Permissions Explained

| Permission | Why it's needed |
|------------|----------------|
| `tabs` | Monitor tab activity and manage suspension |
| `storage` | Save your settings locally |
| `alarms` | Schedule periodic suspension checks |
| `idle` | Detect when the system is idle |

## Data Retention

Suspension data is stored only while tabs are suspended. Whitelist rules and settings persist until you uninstall the extension or clear them manually.

## Children's Privacy

This extension does not knowingly collect any information from children under 13.

## Changes to This Policy

We may update this policy as the extension evolves. Changes will be reflected in the "Last updated" date above.

## Contact

If you have questions about this privacy policy, please open an issue on our [GitHub repository](https://github.com/theluckystrike/tab-suspender-chrome-extension/issues) or contact us at support@zovo.dev.
