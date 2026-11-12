Grammaid is an offline, Grammarly-style writing assistant for Waterfox. Nothing you type leaves
your computer.

## Features

- Inline spelling, grammar and style underlines in any text field, with a suggestion card
- Grammar and spelling by Harper; American, British, Canadian and Australian English
- Style rules: wordy phrases, redundant pairs, weak intensifiers, hedging, passive voice, repeated
  words, long sentences
- Synonyms for a selected word, ranked by how well they fit the sentence (`Alt+Shift+S`)
- Rephrase for a selected sentence, with a word-level diff (`Alt+Shift+R`)
- Local AI-likelihood check with per-sentence highlighting
- Spelling stats: your most-misspelled words and the top three ways you misspell each
- Sidebar with Check, AI Check, Rewrite, Stats and Settings (`Alt+Shift+G`)

## Install

1. Download `grammaid-1.0.0.xpi` below.
2. In Waterfox: Menu → Add-ons and themes → gear icon → **Install Add-on From File…** → choose the
   file.
3. If Waterfox refuses it as unsigned: open `about:config`, set
   `xpinstall.signatures.required` to `false`, and try again.

Synonyms, rewriting and the AI check download two small models (about 180 MB) from Hugging Face
the first time you use them. After that everything works offline.

## Known limitations

- **Not yet tested inside Waterfox.** The release was verified with unit tests and by running the
  built extension in a browser harness, not by installing it in Waterfox. See
  `docs/MANUAL_TEST.md` for exactly what was covered and the checks still to do.
- The AI check is approximate. It is not Turnitin, can wrongly flag formal or non-native writing,
  and is never proof of anything.
- Rewrites come from a very small model and are modest; sometimes none is offered.
- Google Docs is not supported. Paste text into the sidebar's Check tab instead.
- Waterfox / Firefox only, English only, unsigned, no auto-update.
