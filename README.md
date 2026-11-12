# Grammaid

An offline, Grammarly-style writing assistant for [Waterfox](https://www.waterfox.net/). It checks
spelling, grammar and style inline in any text field, suggests synonyms that fit the sentence,
offers rephrasings, estimates how AI-written a text looks, and tracks which words you misspell
most. Nothing you type leaves your computer.

> Screenshots: add `docs/screenshots/inline.png` (underlines and the suggestion card),
> `docs/screenshots/synonyms.png` (the synonyms popover), `docs/screenshots/ai-check.png` and
> `docs/screenshots/stats.png` (sidebar tabs), then link them here.

## Features

- **Inline checking** in `<textarea>`, text/search/email inputs and `contenteditable` editors,
  including inside iframes. Red wavy underlines for spelling and grammar, blue for style. Click an
  underline for a card with fixes, "Add to dictionary" and "Ignore this". A small pill at the
  field's corner shows the issue count.
- **Grammar and spelling** by [Harper](https://writewithharper.com/) (WebAssembly), in American,
  British, Canadian or Australian English.
- **Style rules**: wordy phrases ("in order to" → "to"), redundant pairs ("end result"), weak
  intensifiers, hedging, passive voice, repeated words, very long sentences.
- **Synonyms in context**: select a word, then right-click → *Grammaid: Synonyms*, press
  `Alt+Shift+S`, or click the floating *Syn* button. Candidates come from WordNet, are inflected to
  match your word ("running" → "flowing", not "flow"), and are ranked by how naturally the whole
  sentence reads with each one.
- **Rephrase**: select four or more words, then right-click → *Grammaid: Rephrase* or press
  `Alt+Shift+R`. You get up to three rewrites with a word-level diff, plus *Tighten* and an
  *Active voice hint* that work without any model.
- **AI check** (sidebar): an approximate, local estimate of how AI-written a text looks, with the
  percentage of words flagged, per-sentence highlighting, and the signals behind the score.
- **Spelling stats** (sidebar): a leaderboard of the words you misspell most. Select a word to see
  its top three misspellings. Export as JSON or CSV.
- **Sidebar** (`Alt+Shift+G` or the toolbar button): Check, AI Check, Rewrite, Stats, Settings.

## Install in Waterfox

1. Download `grammaid-1.0.0.xpi` from the [latest release](../../releases/latest).
2. In Waterfox: Menu → **Add-ons and themes** → gear icon → **Install Add-on From File…** → choose
   the `.xpi`.
3. If Waterfox refuses the add-on because it is unsigned: open `about:config`, set
   `xpinstall.signatures.required` to `false`, and try again.

To try it without installing: open `about:debugging#/runtime/this-firefox` →
**Load Temporary Add-on…** → pick `dist/manifest.json` from a local build.

The first time you use synonyms, rewriting or the AI check, Grammaid downloads two small language
models (about 180 MB in total) from Hugging Face. After that everything works offline. Spelling,
grammar and style checking never need a download.

## Privacy

- Your text is processed on your computer, inside the extension. It is never sent anywhere.
- The only network traffic is the one-time model download from `huggingface.co`.
- No telemetry, no accounts, no analytics. Settings, your dictionary and spelling stats live in
  the browser's local extension storage; you can export or delete them in Settings.

## Honest limitations

- **The AI check is approximate. It is not Turnitin** and does not predict what Turnitin will say.
  It combines a small model's perplexity with a few statistics, tuned on twelve sample texts. It
  can wrongly flag formal writing and writing by non-native speakers, and it can miss AI text. It
  is never proof of anything.
- **Rewrites are modest.** `flan-t5-small` is a very small model: often it only shortens or
  lightly rewords a sentence, and sometimes nothing usable comes back. *Tighten* always works. You
  can set a larger model id in Settings.
- **Synonym ranking is only as good as a small model.** WordNet supplies the candidates;
  `distilgpt2` orders them. Expect a few odd suggestions.
- **Google Docs is not supported** (it draws text on a canvas, so there is nothing to underline).
  Paste your text into the sidebar's Check tab instead.
- Underlines can be drawn over other content when a field sits inside a separately scrolling
  container and is partly scrolled out of view.
- Waterfox / Firefox only (Manifest V2). No Chrome, no mobile. English only.
- The add-on is unsigned and does not update itself.

## Development

Requires Node 20 or newer.

```bash
npm install
```

```bash
npm run build
```

| Command | What it does |
| --- | --- |
| `npm run build` | Bundles the extension into `dist/` |
| `npm run dev` | Builds, then runs it in Waterfox with `web-ext` (set `WATERFOX_BIN` if it is not in the default location) |
| `npm run harness` | Serves the built extension against `test/fixtures/playground.html` at `http://localhost:4173` in any browser, using a stand-in for the extension API. Good for UI work |
| `npm test` | Unit tests (vitest + jsdom) |
| `npm run lint` | ESLint and the TypeScript type check |
| `npm run package` | Builds and writes `artifacts/grammaid-1.0.0.xpi` |
| `npm run build:wordnet` | Regenerates `src/data/wordnet-synonyms.json` from WordNet |
| `npm run calibrate` | Runs the real detector over `test/fixtures/*.txt` and prints the scores |

### Architecture

```
content script  ──messages──►  background page  ◄──messages──  sidebar
(fields, overlay, card)        (Harper, models, WordNet, stats)   (Preact, five tabs)
```

- **Background page** (`src/background/`): the only place heavy work happens. Hosts Harper, the
  language models (Transformers.js on ONNX Runtime Web, single-threaded WASM), the synonym index,
  settings and the spelling-stats store.
- **Content script** (`src/content/`): finds editable fields, maps text offsets to screen
  positions, draws underlines in a click-through shadow-DOM overlay, shows the card and popovers,
  and applies fixes through `execCommand('insertText')` so undo and framework listeners keep
  working. It contains no engines and never modifies the page's own DOM text.
- **Sidebar** (`src/sidebar/`): a small Preact app.
- **Shared** (`src/shared/`): message types, sentence splitter, settings schema, diff.

Design decisions and the detector's calibration numbers are in
[docs/DECISIONS.md](docs/DECISIONS.md). What was and was not tested is in
[docs/MANUAL_TEST.md](docs/MANUAL_TEST.md).

## License

[MIT](LICENSE). Third-party components and their licenses are listed at the end of the license
file.
