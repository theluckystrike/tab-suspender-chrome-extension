# Changelog

All notable changes to Tab Suspender will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-12-01

### Added

- Auto-suspend inactive tabs after configurable timeout (5 minutes to 24 hours)
- Auto-restore tabs when clicked/focused
- Domain whitelist to protect important sites from suspension
- Default whitelist includes Gmail, Google Calendar, and Google Docs
- Suspend all inactive tabs with one click
- Restore all suspended tabs with one click
- Whitelist current site from the popup
- Tab search and filtering (all, active, suspended, idle)
- Memory savings tracking (per-session and all-time)
- Statistics dashboard with historical charts
- Tab protection rules:
  - Never suspend tabs playing audio
  - Never suspend tabs with unsaved form data
  - Never suspend pinned tabs
  - Never suspend the active tab
- Memory pressure threshold for automatic suspension
- Keyboard shortcuts:
  - `Alt+S` - Suspend current tab
  - `Alt+Shift+S` - Suspend all other tabs
  - `Alt+R` - Restore all tabs
  - `Alt+W` - Whitelist current site
- Right-click context menu integration
- Settings import/export
- Onboarding flow for new users
- Suspended tab page showing original favicon, title, memory saved, and time suspended
- Badge counter showing number of suspended tabs
- Built on Chrome Manifest V3

[1.0.0]: https://github.com/theluckystrike/tab-suspender-chrome-extension/releases/tag/v1.0.0
