Grammaid now scans a page the way Grammarly does, but only where you ask it to.

## What changed

- **Automatic scanning.** When Grammaid is on in a tab, it checks every text field on the page,
  including fields the page adds later. You no longer have to click into a field first, and
  underlines stay when a field loses focus.
- **Off by default.** Grammaid does nothing on a page until you turn it on:
  - **For one tab:** click the Grammaid toolbar button. The badge shows `on`. Click again to turn
    it off. It lasts until you close the tab.
  - **For a site, always:** sidebar → Settings → *Where Grammaid runs* → add the site, or press
    *Always check <site>* while you are on it. Subdomains are included.
- Settings shows whether Grammaid is running in the current tab.
- Synonyms and Rephrase from the right-click menu and the shortcuts still work on any page.

## Upgrading from v1

- The toolbar button no longer opens the sidebar. Use `Alt+Shift+G` or View → Sidebar → Grammaid.
- The old list of sites where Grammaid was switched off is gone. After upgrading, Grammaid is off
  everywhere until you add sites or click the toolbar button.

## Install

1. Download `grammaid-1.1.0.xpi` below.
2. In Waterfox: Menu → Add-ons and themes → gear icon → **Install Add-on From File…** → choose the
   file.
3. If Waterfox refuses it as unsigned: open `about:config`, set
   `xpinstall.signatures.required` to `false`, and try again.

## Known limitations

- **Still not tested inside Waterfox.** Verified with unit tests and by running the built
  extension in a browser harness. `docs/MANUAL_TEST.md` lists what was covered and what is left,
  including the real toolbar button and badge.
- At most 40 fields per frame are checked. Hidden fields are picked up when the page changes or
  when they get focus.
- The AI check is approximate and is not Turnitin. Rewrites from the small local model are modest.
- Google Docs is not supported. Waterfox / Firefox only, English only, unsigned, no auto-update.
