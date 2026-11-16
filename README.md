# Grammaid

An offline, Grammarly-style writing assistant for [Waterfox](https://www.waterfox.net/). It checks
spelling, grammar and style inline in eligible free-text fields, suggests synonyms that fit the sentence,
offers rephrasings, estimates how AI-written a text looks, and tracks which words you misspell
most. Translation also runs locally, using language packs you choose to download. Your text stays on your computer.

## Features

- **Automatic scanning, only where you want it.** Grammaid is off by default. It checks every
  eligible free-text field in a tab (not just the one you are typing in) when automatic site mode is enabled, or
  after you click the Grammaid toolbar button in that tab. See [Where it runs](#where-it-runs).
- **Inline checking** in eligible `<textarea>`, identified free-text/search inputs and `contenteditable` editors,
  including inside iframes. Red wavy underlines for spelling and grammar, blue for style. Click an
  underline for a card with fixes, "Add to dictionary" and "Ignore this". A small rectangular control at the
  field's corner shows the issue count.
- **Suggestion popups** appear after you pause near an issue, or hover an underline. They do not
  take keyboard focus. Click an underline to open a keyboard-accessible suggestion card.
- **Optional auto-correct** applies concrete English grammar/spelling fixes after a typing pause,
  without asking for each change. It can also shorten known wordy phrases and redundant pairs.
  Enable it in Settings → Suggestions & auto-correct. Undo using the correction notice or
  `Alt+Shift+Z`. Existing text in unfocused fields is not automatically rewritten.
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
- **Translate** (sidebar): choose source and target languages, type or paste up to 2,000 characters,
  or import a page selection. Download individual language packs, then translate and copy the result
  inside the sidebar, offline. No API, account, online translation website or text upload.
  Supports English, Spanish, Simplified/Traditional Chinese, Portuguese, Russian, German, French,
  Japanese, Korean, Dutch, and all 22 scheduled Indian languages. See [Translation](#translation).
- **Paced typing** (sidebar → Type): paste text, choose a tab and field, then start. Variable
  character timing, occasional hesitations, adjustable speed and optional sentence/paragraph pauses.
  Pause, resume or stop; standard inputs, textareas and compatible rich editors, including frames.
- **Local speech to text** (sidebar → Speech): record a clip or choose an audio file, then get
  a punctuated, editable transcript. Optional English filler removal and formatting cleanup;
  original transcript always available. Download the speech model once (76 MiB), then work offline.
- **Sidebar** (`Alt+Shift+G`, or View → Sidebar → Grammaid): Check, AI Check, Rewrite, Translate, Type, Speech and Stats.
- **Dedicated settings tab:** use the sidebar's **Settings ↗** button, the toolbar icon's right-click
  menu, or the browser's add-on Preferences command. It opens only on request. A restrained glossy,
  rectangular interface replaces rounded pills; brief transitions respect reduced-motion settings.

## Where it runs

Automatic checking stays off until you turn it on, in one of two ways:

- **Only when I click** (default): click the Grammaid toolbar button. Eligible free-text fields are checked,
  including fields the page adds later. The button's badge shows `on`. Click again to turn it
  off. Navigating to another page revokes that activation. No content script is injected into
  unrequested pages, and no grammar/model warm-up runs at startup.
- **Automatically on listed sites:** open **Settings ↗ → Where Grammaid runs**, choose this mode,
  and add the site. Subdomains are included, so
  `example.com` also covers `mail.example.com`.

The saved site list is ignored in click-only mode. Existing installations with saved automatic
sites migrate to automatic site mode; an explicit click-only choice always wins. A lightweight
browser command router remains available to receive clicks; page observers and model inference
stay idle until requested. Switching checking off disconnects observers and removes its overlay.

Paced typing, page-text import, Synonyms and Rephrase are explicit page actions and can load the
page bridge on request. They operate only in eligible free-text editors, including frames.

## Install in Waterfox

1. Download the `grammaid-<version>.xpi` file from the [latest release](../../releases/latest).
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

- Writing checks, synonyms, rewrites, the AI check and translation run on your computer.
- Translation models download from Hugging Face only when you press a language pack's download
  button. Translation itself loads cached files only. Text is never put into URLs or sent to
  a translation website. There is no online fallback or translation history.
- No telemetry, no accounts, no analytics. Settings, your dictionary and spelling stats live in
  the browser's local extension storage; you can export or delete them in Settings.
- Paced typing keeps the draft/session in memory without saving a typing history. It sends the
  text only to the browser tab/frame you explicitly choose. That page can read and transmit text
  entered there just as it can when you type manually.
- Speech recognition also runs locally. Only its model files download from Hugging Face when
  requested; microphone audio/imported files and transcripts are not uploaded or saved in a
  transcription history. The current transcript stays in memory until cleared or the page closes.
- Grammaid never captures the screen or uses OCR. Field eligibility is decided **before reading
  its value**, from HTML type, autocomplete, input mode, validation pattern, identifiers, associated
  labels, form purpose/action and ancestor metadata. Passwords, account/contact details, payment,
  identity and address fields are excluded across scanning, correction, typing and page-text import.
  Unknown single-line text fields are skipped unless their metadata identifies a free-text purpose.
  Read-only page text is no longer imported or used by selection actions. Geometry is used only
  to position underlines on allowed editors; it is not a screenshot. This is conservative structural
  detection, not a guarantee about arbitrary mislabeled websites or sensitive prose pasted into
  a free-text editor.

## Speech to text

Open **Speech** and press **Download speech model** once. The pinned, quantized multilingual
Whisper Base pack is 79,664,191 bytes (about 76 MiB / 80 MB). Downloads can be stopped/resumed;
completed files are reused. Remove it in Speech, or use Settings → Clear downloaded models.

For the microphone, press **Open microphone recorder**. Grammaid opens an extension tab so
Waterfox can display its microphone permission prompt. Choose the spoken language, press
**Start recording**, and allow microphone access. Press **Stop & transcribe** to release the
microphone and process the recording. **Discard** stops and forgets a recording. Recording
stops automatically at two minutes and is stopped when the recording page closes/navigates.
Alternatively choose a local audio file, up to two minutes and 25 MB, in a format your browser
can decode (commonly WAV, MP3, WebM or Ogg). Clips transcribe after recording/import, not live.

Whisper supplies automatic punctuation in the spoken language. Optional cleanup removes
standalone English “uh”, “um”, “umm” hesitations, tidies spacing/capitalization and adds a final
punctuation mark if needed. Sentence boundaries with an acoustic pause can become paragraphs.
Select English for filler removal; automatic detection and other languages skip this step to
avoid deleting real words (for example Portuguese “um”). “Like”, “you know”, “uh-huh” and “uh-oh”
are preserved. Cleanup does not paraphrase meaning or apply a profanity/slur filter.

Review/edit **Your transcript**, compare **Original model transcript**, then **Copy transcript**.
You can change cleanup options and explicitly **Reapply cleanup** to the original, or **Clear
transcript**. Cancelling transcription stops after the current model step. Only one speech job
runs at once, sharing the local inference queue with other model features. CPU/WASM transcription
can be considerably slower than the audio on older systems.

The model offers 99 language tokens, including many Indian languages, but **does not cover all
22 scheduled Indian languages**. This is separate from translation's language coverage. Small
speech models can mishear, omit words or hallucinate on noise; no censorship is applied by
Grammaid, but verbatim recognition and punctuation accuracy are not guaranteed. See
[speech model details](docs/SPEECH_MODEL.md).

## Paced typing

Open **Type**, paste up to 20,000 characters, select the browser tab and text field, then press
**Start typing**. **Refresh fields** finds newly added editors; **Focus field** scrolls to the
chosen destination without writing. Place the caret or select text there before starting, or
choose **At the end of the field**. Selecting text replaces that selection when typing begins.

Set an approximate speed from 15–150 WPM. Fresh random samples vary each character interval,
with word/punctuation hesitations and optional sentence/paragraph pauses of roughly 2–8 seconds.
WPM is a pacing setting, not a promised average. The text itself is preserved; deliberate typos
are not added. Unicode graphemes (including Indic text and emoji) are inserted together.

Use **Pause**, **Resume** or **Stop** in the sidebar, or **Escape** on the target page. Typing
pauses when the tab is hidden, focus changes, the keyboard is used or the caret moves. Resume
returns to the saved insertion point. Editing the field, closing/navigating the tab, removing
the field or an editor rejecting or rewriting input ends the session. Stop leaves inserted
text in place. Only one session runs at a time, pinned to its chosen tab, frame and field.

Autocorrect does not rewrite text being entered by the typing assistant. Password, disabled,
read-only, browser/protected pages and canvas editors such as Google Docs are unsupported.
Custom editors may reject programmatic input. The feature uses normal editor operations; it
does not modify history, spoof trusted hardware events or guarantee human indistinguishability
or bypass of history checks. It works within browser fields, not other desktop apps.

## Translation

Open the sidebar → **Translate**. Choose both languages, install their packs, then enter text or
press **Use selection** and **Translate**. Read/copy the result inside the sidebar. English is
included as the intermediate language and needs no separate pack. Other pairs translate through
English automatically, entirely on the device. Choose the source explicitly; no detection model
is downloaded. Long inputs are split into model-sized chunks without silently dropping text.

The **Language library** lets you search, download, stop/resume or remove individual packs.
Downloads continue if you switch sidebar tabs. Completed files survive an interrupted download;
the current partial file restarts. No packs download automatically. Removing a pack retains
shared files still needed by another installed pack. Settings → Clear models removes all models.

Most packs need roughly 220–550 MB for both directions with English. Korean needs roughly 1 GB.
Exact download sizes appear before downloading and account for files already cached. Several
Indian-language packs share a multilingual engine, so enabling another language can need no
additional download. These are per-language choices with shared weights, not separate tiny
models trained for each language. Local inference can be slow on older computers.

Indian languages: Assamese, Bengali, Bodo, Dogri, Gujarati, Hindi, Kannada, Kashmiri, Konkani,
Maithili, Malayalam, Manipuri (Meitei), Marathi, Nepali, Odia, Punjabi, Sanskrit, Santali (Ol Chiki),
Sindhi, Tamil, Telugu and Urdu.

Translation uses OPUS-MT, IndicTrans2 and NLLB. Smaller-language translation is experimental and
can be inaccurate; review the output. The Korean output engine is licensed CC BY-NC 4.0
(non-commercial use); other model licenses are documented in [translation models](docs/TRANSLATION_MODELS.md).

Auto-correct leaves ambiguous fixes, passive-voice advice and subjective style suggestions for
manual review. It waits for a word boundary, avoids selected text, respects IME composition,
and applies at most 20 concrete fixes per pause in the focused field. It is off by default.
Spelling stats continue to count manually accepted fixes, not automatic replacements.

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
- Waterfox / Firefox only (Manifest V2). No Chrome, no mobile. Writing checks are English only;
  the translator supports the languages listed above.
- The add-on is unsigned and does not update itself.

## Development

Requires Node 22.12 or newer (24 recommended).

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
| `npm run package` | Builds and writes `artifacts/grammaid-<version>.xpi` |
| `npm run build:wordnet` | Regenerates `src/data/wordnet-synonyms.json` from WordNet |
| `npm run calibrate` | Runs the real detector over `test/fixtures/*.txt` and prints the scores |
| `npm run smoke:translation -- es` | Downloads a selected test pack, then runs real forward/back translation with networking blocked during inference |
| `npm run verify:translation-packs` | Refreshes pinned translation file revisions and exact sizes from Hugging Face metadata |

### Architecture

```
content script  ──messages──►  background page  ◄──messages──  sidebar
(fields, overlay, card)        (Harper, models, WordNet, stats)   (Preact, six tabs)
```

- **Background page** (`src/background/`): the only place heavy work happens. Hosts Harper, the
  language models (Transformers.js on ONNX Runtime Web, single-threaded WASM), the synonym index,
  settings and the spelling-stats store.
- **Content script** (`src/content/`): when the background says the tab is active, finds every
  editable field (and watches for new ones), maps text offsets to screen
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
