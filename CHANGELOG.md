# Changelog

## 1.2.0

- **Translate tab.** Source/target language selectors, automatic source detection, swap, page
  selection import, Unicode text entry and a 5,000-character limit. All 22 scheduled Indian
  languages plus English, Spanish, Chinese (Simplified and Traditional), Portuguese, Russian,
  German, French, Japanese, Korean and Dutch.
- Translation opens Google Translate or Bing Translator's normal website in a new tab. No
  translation API, API key, account or local translation pack is required. Results are read and
  copied on the website. Bodo and Kashmiri use Bing; pairs between them and Manipuri/Santali
  have a guided two-step English intermediate, with a manual copy/paste between steps.
- Translation explicitly sends text online; other writing features remain local. Added an
  in-product disclosure, accurate privacy documentation, and an optional `websiteContent` data
  permission for Firefox versions with built-in data consent. Older Waterfox versions show
  the disclosure beside the explicit translate button.

## 1.1.0

- **Automatic scanning.** When Grammaid is on in a tab it now checks every text field on the
  page, including fields added later, instead of only the field that has focus. Underlines stay
  when a field loses focus.
- **Off by default, on where you choose.** The list of sites where Grammaid was switched off is
  replaced by a list of sites where it runs. Anywhere else, click the toolbar button to turn it
  on for the current tab (until the tab is closed). The button's badge shows `on`.
- The toolbar button no longer toggles the sidebar; use `Alt+Shift+G` or View → Sidebar.
- Settings shows whether Grammaid is running in the current tab, with one-click "Turn on in this
  tab" and "Always check this site".
- Upgrading from 1.0.0: the old "sites where Grammaid is off" list is dropped, and Grammaid is
  off everywhere until you add sites or click the button.

## 1.0.0

First release.

- Inline spelling, grammar and style checking in textareas, text inputs and contenteditable
  elements (including inside iframes), drawn in an overlay that never touches the page's text.
- Suggestion card with up to five fixes, "Add to dictionary" and "Ignore this".
- Harper (WASM) as the grammar and spelling engine, with American, British, Canadian and
  Australian English.
- Style rules: wordy phrases, redundant pairs, weak intensifiers, hedging, passive voice,
  repeated words, long sentences.
- Context-aware synonyms for a selected word: WordNet candidates, inflected to match, ranked by a
  local language model.
- Rephrase for a selected sentence: local model rewrites with a word-level diff, plus "Tighten"
  and an active-voice hint that need no model.
- AI-likelihood check in the sidebar, computed locally, with per-sentence highlighting and a
  breakdown of the signals.
- Spelling stats: most-misspelled leaderboard, top three misspellings per word, JSON/CSV export.
- Sidebar with Check, AI Check, Rewrite, Stats and Settings tabs.
