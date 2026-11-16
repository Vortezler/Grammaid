Grammaid 1.3 brings speech recognition and translation fully on device, adds paced typing and
automatic corrections, and refreshes the interface with a dedicated settings tab and stricter
field privacy. This release includes all changes since v1.2.

## Local speech to text

- New **Speech** tool with an optional **Whisper Base multilingual** pack: 76 MiB, downloaded
  once when requested. No speech API, account or online recognition service.
- Record in a Grammaid tab or choose a local audio file. Maximum two minutes / 25 MB per clip.
  The microphone starts only after explicit Start and browser permission, and stops before
  transcription. Discard and cancellation controls are included. This is not live streaming.
- Automatic model punctuation, optional English “uh/um/umm” removal, capitalization/spacing
  cleanup and paragraph breaks at suitable acoustic pauses. “Like”, “you know”, “uh-huh” and
  “uh-oh” are preserved. English filler removal requires English to be selected.
- Editable cleaned transcript, original model transcript, copy, explicit reapply-cleanup and
  clear controls. No profanity/slur filter or semantic paraphrasing. The model can mishear/omit
  any word; uncensored processing is not a promise of perfect verbatim recognition.
- 99 model language choices plus automatic detection. Speech does **not** cover every one of
  India's 22 scheduled languages; its coverage differs from translation.

## Offline translation and language packs

- Local translation replaces the Google/Bing website handoff from v1.2. Results appear and can
  be copied inside Grammaid. No API, account, text upload, translation URL or online fallback.
- Download/remove the languages you choose, with exact sizes, progress, stop/resume and shared
  cache reuse. Nothing bulk-downloads automatically. Non-English pairs use English locally.
- English, Spanish, Simplified/Traditional Chinese, Portuguese, Russian, German, French,
  Japanese, Korean and Dutch, plus **all 22 scheduled Indian languages**: Assamese, Bengali,
  Bodo, Dogri, Gujarati, Hindi, Kannada, Kashmiri, Konkani, Maithili, Malayalam, Manipuri,
  Marathi, Nepali, Odia, Punjabi, Sanskrit, Santali, Sindhi, Tamil, Telugu and Urdu.
- Most packs need 220–550 MB; Korean needs roughly 1 GB. Some languages share multilingual
  weights rather than having small independent models. Korean includes CC BY-NC 4.0 weights;
  see the in-app notice and [model attribution](https://github.com/Vortezler/Grammaid/blob/v1.3/docs/TRANSLATION_MODELS.md).

## Writing and typing

- Suggestion cards can appear after a pause near an issue or on underline hover without
  taking typing focus. Clicking still opens a keyboard-accessible card.
- Optional autocorrect applies concrete English grammar/spelling fixes and known redundant
  wording after a pause, without per-change confirmation. Off by default. Undo notice and
  Alt+Shift+Z, caret/selection preservation, IME safeguards and bounded batches are included.
- **Type** accepts up to 20,000 characters and targets an explicit tab, frame and free-text
  field. Adjustable 15–150 approximate WPM, fresh random character timing, punctuation/word
  hesitations and optional sentence/paragraph pauses. Pause, Resume, Stop and Escape controls.
- Insert at the caret, replace a selection or append. Focus/caret changes pause; intervening
  edits, navigation, removed fields or rejected editor input stop. Unicode graphemes are kept
  together. Autocorrect does not rewrite the source while it is being typed. No typing history
  is stored and no claim of human indistinguishability/history-detection bypass is made.

## Interface and activation

- Rectangular, boxier controls and switches; graphite/platinum light/dark surfaces; subtle
  glossy highlights and small transitions. Reduced-motion preferences are respected.
- **Settings opens in its own browser tab**, only from the sidebar Settings button, toolbar
  context menu or browser Preferences command. No automatic settings tab on startup/install.
- **Only when I click** mode injects no page scripts until a toolbar click or explicit page
  action. The automatic site list is ignored in this mode. Navigation revokes manual activation;
  switching checking off disconnects observers and removes the overlay.
- Automatic-site mode registers only listed domains. Existing saved automatic sites migrate
  to that mode; an explicit click-only choice always takes precedence.
- No startup grammar/WASM warm-up. Heavy engine code loads on demand in local chunks. A small
  browser command router remains available to receive user commands.

## Field privacy

- Shared HTML-structure policy across checks, autocorrect, selection actions, page-text import
  and typing. Password/account/contact, card/payment, identity and address fields are excluded
  **before their values are accessed**. Unknown single-line text fields are skipped unless
  metadata identifies a free-text purpose; read-only page selections are no longer imported.
- Uses field type, autocomplete, input mode, validation pattern, names/labels and form context.
  **No screen capture, OCR or visual screen-reading classification.** Geometry only positions
  underlines in eligible editors. This is conservative metadata detection, not a guarantee about
  arbitrary mislabeled websites or private information deliberately pasted into a free-text editor.
- Speech audio and transcripts remain in memory without history; model blobs are cached locally.
  No telemetry, account, online fallback or new microphone-wide manifest permission.

## Install or upgrade

1. Download **grammaid-1.3.0.xpi** from this release.
2. Waterfox → Add-ons and themes → gear → **Install Add-on From File…**; select the XPI.
3. Open Grammaid's sidebar with **Alt+Shift+G**. Use **Settings ↗** for preferences.
4. Download only the speech/translation packs you want, then use them offline.

Settings, dictionary and spelling stats are preserved. This unsigned build has no automatic
updater; see the [README](https://github.com/Vortezler/Grammaid/blob/v1.3/README.md) for installation details.

## Validation and limits

- ESLint/TypeScript, **213 unit tests**, build and XPI packaging verified.
- Add-on validator: **0 errors, 6 warnings** (two minimum-version data-consent compatibility
  warnings, Preact's unused innerHTML branch in three bundles, and a bundled library import).
- Real Whisper Node CPU test: both fetch paths disabled during inference, **zero attempted
  network requests**. Browser WASM/import verified separately. Real offline translation smoke
  coverage includes Spanish, Bodo, Dogri, Kashmiri, Konkani, Manipuri, Nepali, Santali, Tamil and Korean.
- Browser harness verified the polished sidebar/settings, explicit settings launch, preference
  persistence, click activation/shutdown, field exclusion and typed-text insertion. Prior checks
  verified autocorrect/undo, suggestion popups, local speech and translation results.
- Native Waterfox microphone permission/codec behavior and installed-extension restart behavior
  remain unverified. Small local models can be slow and inaccurate, especially on low-resource
  languages/noisy audio. Browser metadata varies. Google Docs canvas and every custom editor
  are not supported. Grammar/style checks remain English-only; the AI score remains approximate.
