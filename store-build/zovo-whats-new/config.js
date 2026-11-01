globalThis.ZOVO_WHATS_NEW = Object.freeze({
  "version": "1.0.40",
  "name": "Tab Suspender Pro",
  "id": "ofgncemnlblfnocjbojdhamacfffcpnm",
  "slug": "tab-suspender-pro",
  "date": "2026-10-31",
  "changes": [
    {
      "type": "fixed",
      "text": "Tabs you reopen from the Recovery list in Settings now go back into their tab group."
    },
    {
      "type": "improved",
      "text": "The What's new page is redesigned. It shows each change in plain words, and the popup has a link to it at the bottom."
    },
    {
      "type": "improved",
      "text": "This page now opens at most once in 30 days, and a checkbox at the bottom turns it off."
    },
    {
      "type": "improved",
      "text": "The rating note in the popup now waits 90 days after Not now, and it never shows again once you have written to me."
    },
    {
      "type": "improved",
      "text": "The review link on the stats page now gives both choices, a rating or a note about what's missing."
    }
  ],
  "stats": [
    {
      "area": "local",
      "key": "memoryStats",
      "path": "tabsSuspended",
      "label": "tabs put to sleep"
    }
  ],
  "tips": [
    "A suspended tab keeps its place in the tab strip. Click it to bring the page back.",
    "Settings has a Recovery list of filed tabs, so you can reopen them after a crash or a restart.",
    "Add a site to the whitelist in Settings to keep it awake."
  ],
  "signal": {
    "area": "local",
    "key": "memoryStats",
    "path": "tabsSuspended",
    "min": 50,
    "line": "You've put {n} tabs to sleep with it."
  },
  "installedAt": {
    "area": "local",
    "key": "installDate"
  },
  "icon": "icon.png"
});
