# Manual test record (v1.0.0)

## What was and was not run

**Not run: the checklist inside Waterfox itself.** The build environment could not drive a
Waterfox window, so no step below was observed in Waterfox. Before relying on the release, run the
"To do in Waterfox" list at the end.

**Run instead:** the built extension (`dist/`) was exercised in a Chromium-based browser through
`npm run harness`, which loads the real `background.js`, `content.js` and `sidebar.js` and replaces
only the `browser.*` extension API with a stand-in. That covers the engines, the overlay, text
mapping, fix application, the models and the sidebar. It does **not** cover anything specific to
Waterfox or to the real extension API: installing the `.xpi`, the extension CSP, context menus,
keyboard shortcuts, `sidebar_action`, cross-process messaging, or `all_frames` injection.

Automated: `npm run lint`, `npm test` (104 tests), `npm run build` and `web-ext lint` (0 errors)
all pass. `npm run calibrate` ran against the real scoring model (results in DECISIONS.md).

## Checklist

| # | Step | Harness (Chromium) | Waterfox |
| --- | --- | --- | --- |
| 1 | Playground: spelling underlines appear within about a second in textarea, text input, contenteditable | Pass. Underlines aligned in all three; pill shows the count | Not run |
| 1 | Click an underline and accept a fix | Pass in textarea and in the React-style controlled input (page state updated) | Not run |
| 1 | Ctrl+Z undoes the fix | Pass in textarea | Not run |
| 1 | Iframe containing a contenteditable | Not checked (the harness injects the script by hand, which says nothing about `all_frames`) | Not run |
| 2 | Scroll and resize: underlines stay aligned | Not checked visually | Not run |
| 3 | Accepted fix appears in Stats; several forms of one word ranked by count | Pass. An accepted fix was recorded; with seeded fixes the tab showed `definately ×9, definitly ×3, defanitely ×1` | Not run |
| 4 | Synonyms popover, ranked; apply one; inflection | Pass. "important" (page text) gave ranked options with a/an corrected; "running" in a textarea gave -ing forms and clicking one replaced the word | Not run |
| 5 | Rephrase: options with diff; Tighten without the model | Partly. Tighten and the active-voice hint appeared with a diff; the model produced no rewrite that survived the filters in that run (one beam-search candidate was added afterwards and not re-checked in the browser) | Not run |
| 6 | AI Check: AI fixture clearly higher than human fixture | Pass. `ai-2-climate` 100 % "Likely AI" (with the larger 236 MB model file; 77 % with the shipped 85 MB file under Node), `human-2-narrative` 0 % "Likely human" | Not run |
| 6 | Short text shows the too-short message | Covered by a unit test only | Not run |
| 7 | Off on sites that are not listed → no overlay; password fields never checked | 1.0.0: unit tests only. 1.1.0: see the additions below | Not run |
| 8 | Offline after models are cached | Not run. Models were served from the IndexedDB cache on a second page load, but the network was never disconnected | Not run |

Model download inside a browser (ONNX Runtime WASM + IndexedDB cache) worked in the harness for
both models.

## 1.1.0 additions (harness, Chromium; not run in Waterfox)

| Step | Result |
| --- | --- |
| Page load with no listed site: nothing is scanned | Pass. 0 underlines, badge off |
| Toolbar click: every field is checked with none focused | Pass. 18 underlines across textarea, input, contenteditable, controlled input, plus 3 inside the iframe; badge `on`; toast shown |
| A field added to the page later is checked | Pass |
| A script changes a field's text | Pass. Typos underlined, then cleared after the text was corrected |
| Second toolbar click turns it off | Pass. 0 underlines, badge off |
| Adding the site to the list turns scanning on without a click; removing it turns it off | Pass |
| Clicking an underline in a field opens the card | Pass |
| Settings shows the tab's state, "Turn on in this tab" and "Always check <site>" | Pass |

Not checkable in the harness and still to verify in Waterfox: the real toolbar button and badge,
activation surviving navigation in the tab and ending when the tab closes, and iframes following
the top-level site.

## To do in Waterfox

1. Install the release `.xpi` (see the README; unsigned add-ons may need
   `xpinstall.signatures.required = false`).
2. Open `test/fixtures/playground.html` and go through steps 1 to 8 above.
3. Pay particular attention to what the harness cannot show:
   - the background page starts without CSP errors (`about:debugging` → Inspect);
   - right-click → *Grammaid: Synonyms / Rephrase* and the three shortcuts work;
   - the toolbar button turns scanning on and off for the tab (badge `on`), and `Alt+Shift+G`
     toggles the sidebar; the pill either opens it or shows
     the "Press Alt+Shift+G" toast;
   - the contenteditable inside the iframe gets underlines;
   - the model download completes and survives a browser restart.

## 1.2.0 translator verification (2026-11-13)

Automated: ESLint/TypeScript and 121 tests pass. New tests exercise the 22-language catalog,
all 1,089 source/target combinations (including eight English-intermediate routes), preservation
of Unicode/newlines/URL-like text, runtime limits, website code mappings, explicit-click-only
transmission, denied/revoked Firefox data permission, backend navigation failure, and the two-step UI.

Browser: Chromium harness at 360px sidebar width, using the real built sidebar/background with
stubbed extension APIs. Six tabs and translation controls render without overlap. The Hindi
button opened Google Translate with “Hello, how are you?” prefilled and displayed
“नमस्ते, आप कैसे हैं?”. The Bodo button opened Bing with `from=en&to=brx`, preserved that source
text and displayed a Bodo result. Bodo → Santali showed two English-intermediate steps with the
second button disabled until input. Live provider menus were checked for coverage and codes.

Packaged `artifacts/grammaid-1.2.0.xpi` successfully (about 14.1 MB). `web-ext lint` reports
0 errors and 5 warnings: the four previously documented warnings plus Android support for
`permissions.request` at minimum version 115. Android is not a supported target.

Still unverified: installation and real `browser.tabs.create` in Waterfox, native Firefox optional
data-consent prompts, selection import from real pages/iframes into Translate, translation
quality for every language pair, and website behavior at the full input limit. Website menus
and availability can change independently of the extension. No translation API was called.

## 1.3.0 local translation, corrections and visual refresh

Automated: 128 tests pass, with ESLint/TypeScript passing. Coverage includes all 1,089 configured
language pairs, native-script Indic routes, pinned revisions, actual multilingual target-token
insertion, Unicode-safe chunking, missing-pack failures, selected-pack-only downloads, retries,
shared-file reuse/removal, stored pack state and missing cached files. Correction tests cover
single-fix selection, completed words, selection protection, overlapping edits, caret boundaries,
batch inverse edits, default settings, IME composition, unfocused fields, native undo and automatic
popup focus. Local sidebar tests check pack installation and rendering results without web navigation.

Real model smoke tests downloaded model data into `%TEMP%/grammaid-mt`. For inference, both global
fetch and Transformers.js fetch were replaced with a function that throws on every request.
All of the following translated English → target → English with **zero attempted network requests
during inference**: Spanish, Bodo, Dogri, Kashmiri, Konkani, Manipuri (Meitei), Nepali, Santali
(Ol Chiki), Tamil and Korean. These exercise dedicated OPUS, multilingual OPUS, native-script
IndicTrans2 and NLLB. Standard smoke tests use Node CPU; Indic tests use the same WASM-only
runtime as the browser build. The tests verify execution and scripts, not translation quality.

Two real compatibility issues were found and fixed: cache-only loading requires the library's
local-model flag; the v4 Marian tokenizer bypasses the older prefix override, so multilingual
language IDs must be inserted explicitly. Before the latter fix Tamil output was incorrect.
Afterward it produced Tamil script. Korean and Tamil round trips still show the limitations
of small/quantized models; this is not a quality benchmark.

Chromium harness verification with the real built sidebar/background/content bundles:

- The new dark-theme navigation and translation editor render at 360px sidebar width.
- A Spanish pack downloaded with visible progress. English “Hello, how are you?” translated
  to “Hola, ¿cómo estás?” inside the sidebar using browser WASM, without opening another website.
- Auto-correct changed “I has an apple. In order to see the end result, I waited.” to
  “I have an apple. To see the result, I waited.” after a pause, keeping focus and the caret.
- Undo restored the original text and did not immediately apply the same changes again.
- With auto-correct off, “I definately agree.” caused a Spelling suggestion card to appear
  without clicking an underline. Focus stayed in the textarea. This exposed an anchor timing
  issue when paint was delayed; direct field geometry now supplies the anchor in that case.

Still unverified: real Waterfox installation, restart persistence inside the installed extension,
all language-pair translation quality, full-size input performance, and every framework/editor's
native undo behavior. Google Docs canvas remains unsupported. Models are not bundled into the XPI;
users download their chosen packs after installation. These checks preceded the final 1.3 release work below.

## Paced typing verification (2026-11-14)

Automated checks cover varied/bounded timing, optional sentence pauses, Unicode grapheme
segmentation/fallback, validation, selection replacement, append, pause/resume/stop/Escape,
focus/caret/visibility changes, intervening edits, removed/read-only fields, maxlength, excluded
password fields, rich-editor and empty-field insertion, native NBSP conversion, rejection of
arbitrary editor rewrites, autocorrect suppression, sender/frame validation, stale status,
overlapping sessions, navigation, missing frames and cancellation of an in-flight start.
Sidebar tests check explicit Start, destination requirements and pause/resume/stop controls.

Built-extension Chromium harness checks at 360px sidebar width:

- Typed “Hello. नमस्ते 中文 👩🏽‍💻” and a second line into the chosen textarea. Pause froze the
  partial text, and Resume completed the exact source. Other fields stayed unchanged.
- Selected a contenteditable inside the fixture iframe and completed “ Frame test.” only there.
  This found native trailing-space NBSP conversion; it is now accepted without accepting other
  rewrites. Text/selection snapshots use the browser's actual representation after insertion.
- Typed multiple paragraphs, including a blank paragraph, into that embedded editor. The editor
  used native div/BR paragraph structure and the session reached Complete, 38/38.
- Started a 100-character source in the React-style controlled input at 15 WPM, then pressed
  Stop at 5/100. The field and its backing state contained the same partial text; a later read
  confirmed no further characters were added.
- Inspected the dark Type panel, seven-section navigation, destination controls and status card.

Final checks passed: `npm run lint`; `npm test` (154 tests in 13 files); `npm run package`;
`git diff --check`; `npx web-ext lint --source-dir dist` (0 errors, 4 pre-existing compatibility/
bundled-library warnings). Rebuilt `artifacts/grammaid-1.3.0.xpi` with the Type feature.
This remains browser-harness verification; installed Waterfox and every third-party rich editor
are not verified. Native input/history behavior depends on the destination editor. No claim of
human indistinguishability or history/detection bypass is made.

## Local speech verification (2026-11-15)

- Unit coverage: conservative filler removal, consecutive fillers/paragraph starts, meaningful
  “uh-huh/uh-oh”, non-English words, disabled cleanup, uncensored profanity/quoted slurs, original
  preservation, CJK/segment paragraph matching, bounded PCM transport, silence/malformed input,
  missing/partial packs, pinned cache-only loading, reuse/removal, session cancellation and
  overlapping jobs. Recorder tests cover late permission after cancellation, stopping tracks
  before transcription and cleanup when MediaRecorder construction fails. UI tests cover explicit
  download, no automatic microphone activation, recorder-page launch, file import, both transcript
  versions, editing/copying, reapplying cleanup and clearing the in-memory result.
- `npm run smoke:speech` downloaded the pinned Whisper Base files and a public 11-second JFK WAV.
  Node CPU transcription returned the recognizable excerpt, with punctuation. Both global fetch
  and Transformers.js fetch threw on every inference request: **zero attempted requests**.
- The built speech page in the Chromium harness downloaded 76.0 MiB with visible progress and
  enabled recording/import only after installation. Importing the same local WAV used the real
  browser WASM runtime and produced an editable transcript plus the original model text. The
  transcript matched the Node result; the speech page rendered correctly in the dark theme.
- No live microphone was activated during automated browser checks. Actual Waterfox microphone
  permission/codec behavior, installed-extension restart behavior, all 99 language/accent quality,
  and long/noisy recordings remain unverified. This is record-then-transcribe, not live streaming.

Final validation: `npm run lint`, `npm test` (172 tests in 16 files), real offline speech smoke,
`npm run package`, `git diff --check`, and `npx web-ext lint --source-dir dist` (0 errors,
5 compatibility/bundled-library warnings; the additional Preact warning is repeated in the
standalone speech bundle). Rebuilt `artifacts/grammaid-1.3.0.xpi`; final release work is recorded below.

## Final 1.3 release: settings, visuals, activation and privacy (2026-11-15)

- Cold-start lifecycle tests verify no content injection, automatic site registration, settings
  tab opening or engine creation in default click-only mode. Model status/settings requests stay
  lightweight. A writing request creates the engine once. Automatic-site mode registers only
  listed patterns; switching back unregisters them. Toolbar toggles and navigation revoke approval.
- Structural privacy tests cover password/contact/account/payment/address/identity metadata,
  autocomplete, labels, patterns/input modes, unknown one-line inputs, owner forms, checkout/auth
  context and later changes to a target's purpose. Throwing getters verify exclusion before value
  reads in selection, extraction, replacement and typing. Surrounding page text is not inspected.
- Built Chromium harness: no overlay before toolbar activation; manually opening the sidebar
  did not start checking. Settings opened a new full tab only after its button was clicked.
  The page rendered boxy glossy controls, and activation-mode changes survived a reload. A cold
  options-page/backend initialization race was found; bounded retries/loading feedback fixed it.
- Clicking the toolbar started real Harper underlines in eligible fields. Type discovery listed
  only the textarea, Message/Draft inputs, rich editor and iframe editor. The test card, username,
  address and password fields were absent. A 26-character source completed in the chosen textarea.
  Clicking the toolbar off removed the overlay completely (DOM count zero).
- All 213 tests pass (19 files) and lint/TypeScript pass before final packaging. The background
  bootstrap is about 14 KB; heavy engines are separate lazy chunks. Native Waterfox dynamic
  registration/permission behavior remains an installation check; this harness emulates its APIs.
- Final add-on validation: 0 errors, 6 warnings (two data-consent/minimum-version warnings,
  bundled Preact innerHTML branches in sidebar/options/speech, one bundled library import).
