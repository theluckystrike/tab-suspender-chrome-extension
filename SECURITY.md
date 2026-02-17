# Security Policy

## Our Commitment

Tab Suspender is built with security as a core principle. We collect no data, make no network requests, and run entirely locally in your browser. We take security vulnerabilities seriously and appreciate responsible disclosure.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. **Email** us at hello@zovo.one with:
   - A description of the vulnerability
   - Steps to reproduce the issue
   - The potential impact
   - Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: We will acknowledge your report within 48 hours
- **Assessment**: We will assess the vulnerability and determine its severity within 5 business days
- **Fix**: We will work on a fix and coordinate the release timeline with you
- **Credit**: With your permission, we will credit you in the release notes

## Security Design Principles

Tab Suspender follows these security principles:

- **No network requests**: The extension never contacts any external server
- **No data collection**: No user data is collected, stored externally, or transmitted
- **Minimal permissions**: We only request permissions strictly necessary for tab suspension functionality
- **Local storage only**: All settings and statistics are stored locally using Chrome's storage API
- **No remote code execution**: No code is loaded from external sources
- **Open source**: The entire codebase is publicly auditable

## Permissions Explained

| Permission | Why It's Needed |
|------------|----------------|
| `storage` | Store your settings and whitelist locally |
| `activeTab` | Detect the currently active tab |
| `tabs` | List and manage tabs for suspension/restoration |
| `tabGroups` | Respect tab group boundaries |
| `scripting` | Inject the content script for activity detection |
| `contextMenus` | Add right-click menu options |
| `notifications` | Show suspension notifications |

## Third-Party Dependencies

Tab Suspender has **zero** external dependencies. The extension is entirely self-contained with no third-party libraries, CDN resources, or external scripts.

## Contact

For security-related inquiries: hello@zovo.one
