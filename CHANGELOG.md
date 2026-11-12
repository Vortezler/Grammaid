# Changelog

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
