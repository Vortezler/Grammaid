# Changelog

## 1.3.0 — 2026-11-15

- **Sharper UI:** rectangular controls and switches, graphite/platinum surfaces, subtle glossy
  highlights, shorter typography and small panel/press transitions. Reduced-motion preferences
  are respected, including the sidebar, recorder, inline popovers and standalone settings page.
- **Settings in a browser tab:** opens only from an explicit Settings command or browser
  Preferences; settings are no longer confined to the sidebar. No automatic startup/install tab.
- **True on-demand page activation:** click-only mode injects no page scripts until a toolbar
  click or explicit page action. Listed sites require automatic-site mode. Navigation revokes
  manual activation, disabling removes observers/overlays, and grammar/model startup is deferred.
  The background entry is now about 14 KB with heavy engines split into lazy local chunks.
- **Free-text-only privacy:** a shared structural HTML policy excludes password, account,
  contact, payment/card, identity and address fields before value access. Applies to checking,
  autocorrect, selection actions, page-text import and typing. Unknown single-line fields and
  read-only page selections are excluded. No screenshots, OCR or screen-reading classification.

- **Speech tab:** local Whisper Base speech recognition with a separate optional 76 MiB model
  download, microphone recording in an extension tab, and audio-file import. Up to two minutes
  per clip; 99 model language choices or automatic detection. Inference is cache-only; no
  browser/cloud speech service or audio upload. Recordings/transcripts are not saved to history.
- **Transcript cleanup:** model-generated punctuation, English “uh/um/umm” removal, capitalization,
  spacing, final punctuation and paragraphs at acoustic gaps after sentences. Original transcript
  remains available; edited results can be copied. No profanity/slur filter or semantic rewrites.
  The recognition model may still mishear/omit words. English filler removal requires English
  selected; it is not applied to automatically detected or other-language speech.
- **Type tab:** paste up to 20,000 characters, choose a browser tab and text field (including
  embedded frames), and start paced typing. Adjustable approximate speed, independently sampled
  character timing, word/punctuation hesitations and optional randomized sentence/paragraph pauses.
  Insert at the caret, replace a selection, or append; Pause, Resume, Stop and Escape controls.
  Changing focus or hiding the tab pauses; intervening edits, navigation and rejected input stop
  the session. Multilingual graphemes stay intact and autocorrect does not alter the source text.
  No typing history is stored. This uses ordinary editor input and does not guarantee that typing
  is indistinguishable from a human or bypass any history/detection system.
- **Local translation replaces website translation.** Download the languages you choose,
  translate offline, and read/copy results inside the sidebar. All 22 scheduled Indian
  languages and the existing world-language choices have pinned local model routes.
  Non-English pairs pass through English locally. Source language is chosen explicitly.
- **Language library:** exact download sizes, progress, stop/resume, removal, persistence,
  shared-file reuse and cache-only inference. Packs include both English directions; some
  multilingual weights are shared across languages. No automatic bulk download or web fallback.
  Most packs require 220–550 MB; Korean is about 1 GB and includes a CC BY-NC 4.0 model.
- **Refreshed interface:** readable navigation, clear focus states, an integrated translation
  editor and result card, with the final graphite/platinum visual polish described above.
- **Suggestion popups** after a typing pause near an issue and on underline hover, without
  moving keyboard focus. Clicking an underline still opens a keyboard-accessible card.
- **Optional auto-correct:** concrete English grammar/spelling fixes and known redundant or
  wordy phrases apply after a pause without per-fix confirmation. Focused fields only, with
  caret/selection preservation, IME handling, bounded batches, and an Undo notice / Alt+Shift+Z.
  Enable in Settings; existing installations keep auto-correct off until enabled.
- Removed translation website navigation and optional website-content transmission permission.

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
