# Decisions

Choices made while building v1 that the build plan left open, or where the installed library
versions forced a change from the plan. The plan's own decisions (offline only, Manifest V2,
Harper + custom rules, accepted-fix-only spelling stats, and so on) are not repeated here.

## Changes from the plan

| Plan | What was built | Why |
| --- | --- | --- |
| `background.scripts: ["background.js"]` | `background.page: "background.html"` loading `background.js` as an ES module | Harper and Transformers.js are ES modules that use `import.meta.url`; a module script needs a page. Still a persistent MV2 background |
| Transformers.js v3 | v4.3.2 (what npm installs today) | Same API for what Grammaid uses |
| `env.useBrowserCache = true` (Cache API) | Custom cache in IndexedDB (`src/background/model-cache.ts`) | The Cache API has been unreliable in extension pages of Firefox-based browsers; IndexedDB with `unlimitedStorage` is dependable and makes "cache size" and "clear models" simple |
| ORT `.wasm`/`.mjs` loaded via `wasmPaths` | ONNX Runtime's WASM-only bundle is aliased in at build time; only `ort-wasm-simd-threaded.wasm` is fetched from `vendor/ort/` | Waterfox has no WebGPU. The WASM-only build is half the size and needs no dynamic import of glue code. `env.useWasmCache` is off because it creates a `blob:` script URL that the extension CSP forbids |
| Models "~80 MB and ~60–100 MB" | 85 MB + 95 MB, about 180 MB | Transformers.js picks `model_quantized.onnx` (236 MB) for `Xenova/distilgpt2` by default; Grammaid asks for `decoder_model_merged_quantized.onnx` (85 MB) and falls back to the default name for other repos. flan-t5-small q8 is a 36 MB encoder plus a 59 MB decoder |
| Harper kind "Spelling" → spelling, everything else → grammar | "Spelling" **and "Typo"** → spelling | Harper reports slips like "teh" as "Typo". To the user they are spelling mistakes, and they should count in the spelling stats |
| One `wordnet-synonyms.json` | Committed as one file (the plan's shape); the build splits it into four files, one per part of speech | The add-on linter rejects JSON files over 5 MB. The index is fetched lazily on the first synonym lookup rather than bundled into `background.js` |
| WordNet synonyms from each synset | Plus "similar to" neighbours for adjectives; hyphenated candidates are dropped | Adjective synsets are tiny ("important" had three synonyms); neighbours give the ranker enough to choose from. Hyphenated compounds ("life-and-death") scored deceptively well and rarely fit |
| Rephrase: 4 sampled candidates | 1 beam-search candidate + 3 sampled | Sampling alone from flan-t5-small often produced nothing that survived the filters |
| Detector constants `ln(45)`, burstiness cut-offs 0.3 / 0.7 | Midpoint 85, cut-offs 0.5 / 0.75 | Calibration, below |

## Additions

- **`npm run harness`**: serves the built extension against the playground page in any browser
  with a stand-in for the `browser` API (`test/harness/shim.js`). This is how the UI was verified
  during the build.
- **Underlines follow the text while you type.** Between an edit and the next lint, existing
  issues are shifted by the edit instead of being left at stale positions (`shiftIssues`).
- **`data_collection_permissions: none`** in the manifest, which newer Firefox versions ask for.
- **Tests beyond the plan's list**: lint pipeline, diff, rephrase filters, settings, apply fallback.
- CI runs on Node 24, not the plan's Node 20: the installed vitest 5 and jsdom 31 need Node 22.12 or newer.
- The repo's local git config uses the GitHub no-reply address for commits, because the global
  git email on the build machine was a placeholder.

## 1.1.0: automatic scanning, opt-in per site or per tab

- **Opt-in replaces opt-out.** `disabledSites` became `enabledSites`. Nothing is scanned unless
  the tab's site is listed or the user clicked the toolbar button in that tab. The decision is
  made in the background page (`src/background/activation.ts`) from the tab's top-level URL, so
  iframes follow the page they are in rather than their own hostname.
- **Per-tab activation lives in memory.** It lasts for the life of the tab, survives navigation
  inside it, and is forgotten when the tab closes or the browser restarts. Nothing is stored.
- **The toolbar button toggles the tab instead of the sidebar.** The request was "activated
  (clicked on)". The sidebar keeps `Alt+Shift+G` and the View → Sidebar menu.
- **All fields, not just the focused one.** The watcher registers every visible checkable field
  and uses a MutationObserver (debounced 500 ms) to pick up new ones. First lints are staggered
  40 ms apart. Capped at 40 fields per frame so huge forms and grids cannot stall a page.
  Fields scrolled out of view are skipped when painting.
- **Explicit actions ignore the gate.** Right-click Synonyms/Rephrase and the shortcuts work on
  any page; the floating *Syn* button appears only where Grammaid is on.
- **Hidden fields are not checked** (no layout box). They are picked up when the page next
  changes its DOM, or when they receive focus.

## Detector calibration

`npm run calibrate` runs the real `Xenova/distilgpt2` (85 MB quantized file) over the twelve texts
in `test/fixtures/`. Final constants (all in `src/background/detector-config.ts`):

- `pplScore = sigmoid(2.5 × (ln 85 − ln perplexity))`
- `sentenceScore = 0.7·pplScore + 0.2·phraseScore + 0.1·openerScore`, smoothed 0.25 / 0.5 / 0.25
- flag threshold 0.60, −0.05 when burstiness < 0.5, +0.05 when > 0.75; "uncertain" band 0.1 below
- burstiness = mean of min(1, std(ln ppl) / 0.9) and min(1, CV(sentence length) / 0.6)
- labels: < 20 % Likely human, 20–60 % Mixed, > 60 % Likely AI

Results with those constants:

| Fixture | Mean perplexity | Words flagged | Label |
| --- | --- | --- | --- |
| ai-1-technology | 41 | 91 % | Likely AI |
| ai-2-climate | 33 | 77 % | Likely AI |
| ai-3-education | 35 | 84 % | Likely AI |
| ai-4-teamwork | 63 | 42 % | Mixed |
| ai-5-health | 42 | 60 % | Mixed |
| ai-6-reading | 45 | 79 % | Likely AI |
| human-1-casual | 161 | 0 % | Likely human |
| human-2-narrative | 152 | 0 % | Likely human |
| human-3-argument | 185 | 0 % | Likely human |
| human-4-technical | 265 | 0 % | Likely human |
| human-5-review | 123 | 0 % | Likely human |
| human-6-email | 149 | 0 % | Likely human |

Caveats: twelve texts is a tiny sample; the "AI" fixtures are deliberately generic essays and the
"human" ones are informal. Polished, formal human prose will have lower perplexity than these
human fixtures and can be flagged. The numbers show the signals separate these samples, not that
the detector is accurate in general.

## `web-ext lint`

0 errors. Four warnings, all accepted:

- `KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION` (and the Android twin): `data_collection_permissions`
  is newer than the minimum version 115. Older browsers ignore the key.
- `UNSAFE_VAR_ASSIGNMENT` in `sidebar.js`: Preact's own `dangerouslySetInnerHTML` support.
  Grammaid never uses it.
- `UNSAFE_VAR_ASSIGNMENT` in `background.js`: dynamic `import()` inside ONNX Runtime and Harper,
  on code paths that are not taken in the extension.

The `<all_urls>` permission and the `wasm-unsafe-eval` CSP are required: the first to check text
on any site, the second to run WebAssembly in the background page.

## 1.2.0: optional website translation

- **User-selected online mode without translation APIs or accounts.** The user allowed online
  translation provided it did not depend on APIs or accounts, with per-language local packs as
  the fallback. Implemented normal website navigation with prefilled URL parameters, not an
  undocumented endpoint, scraped result, embedded website, or hosted inference API. No new
  packages or local translation models. The user reads/copies the result on the provider site.
- **All 22 scheduled Indian languages** is the confirmed scope, alongside the ten requested
  world languages (Chinese has Simplified/Traditional choices). One shared catalog controls
  selectors, runtime validation and website routing. Language names include native script labels.
- **Coverage was verified against live website menus on 2026-11-13.** Despite Google's 2024
  [announcement](https://blog.google/intl/en-in/google-translate-new-languages-2024/), its current
  menu did not offer Bodo or Kashmiri. Bing's menu did offer them, but not Manipuri or Santali.
  Bodo/Kashmiri therefore use Bing; all other choices use Google. Eight directed combinations
  between Bodo/Kashmiri and Manipuri/Santali require two website steps through English. The UI
  provides both steps, with manual copying of the English result. It never sends an unsupported
  language code and lets the website silently substitute another language.
- **No silent transmission.** Typing, language changes and selection import stay local.
  Only a translate button opens a fixed HTTPS provider URL with the text for that step.
  The UI explains the destination, online processing and browser-history exposure before the
  action. Text stays in component memory, not extension storage. Backend validation rejects
  empty input, unsupported codes and input above 5,000 characters without opening a tab.
- **Privacy declaration updated.** The manifest keeps no required data collection and declares
  optional `websiteContent`. On browsers exposing `permissions.getAll().data_collection`, the
  sidebar requests this permission directly in the click handler; the background checks it
  again before navigation. Decline, revoke and permission-check errors stop navigation. Older
  browsers use the inline disclosure and explicitly labelled action. See Mozilla's
  [data consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
- **Writing tools remain English and local.** This does not add non-English grammar rules or
  change scanning activation. Translation is a sixth sidebar tab; all tabs remain mounted.
- **Release naming.** Version 1.2.0 uses tag `v1.2`, following the existing `v1` / `v1.1` release
  convention. The user authorized committing, pushing and publishing this version on 2026-11-13.

## 1.3.0: local language library, corrections and interface refresh

- **Local replaces online.** The prior website handoff is removed, along with its data
  transmission permission. Results are generated and displayed inside the extension. A user
  explicitly downloads each desired language pack; translation uses cached files only and
  has no website or cloud fallback. Source language is explicit to avoid a separate detector.
- **Per-language choices with shared weights.** A pack provides both directions with English.
  OPUS-MT supplies dedicated world-language pairs and shared multilingual pairs where verified
  language tokens exist. Seven native-script Indian languages use shared IndicTrans2 int8
  encoder/decoder files. NLLB supplies Korean output. These models cannot be sliced into tiny
  independent per-language weights; the UI discloses shared engines and exact sizes, reuses
  files, and downloads only the dependencies of the user's selected pack. The Korean model's
  CC BY-NC license appears before download. See `docs/TRANSLATION_MODELS.md` for attribution.
- **Pinned files.** `translation-models.json` records immutable revisions, expected file names
  and sizes. No remote code executes. Downloads are streamed, validated for expected length,
  and marked installed only after complete IndexedDB writes. Complete files can resume after
  interruption; incomplete current files restart. Removing a pack retains shared dependencies
  used by other installed packs. Clearing models clears pack registrations as well.
- **Runtime compatibility fixes found by real-model tests.** Transformers.js requires
  `allowLocalModels=true` for cache-only loading; the fallback local path is extension-owned.
  The v4 Marian wrapper bypasses its older language-prefix encoder override, so multilingual
  target IDs are inserted explicitly from the tokenizer vocabulary. IndicTrans uses separate
  source/target tokenizers and a local WASM encoder/cached-decoder loop in its native scripts.
- **Bounded local inference.** Models load one at a time; inference shares a queue with writing
  models. Non-English pairs pass through English locally. A 2,000-character input cap and
  Unicode-safe token-bounded chunks control latency without silently truncating input.
  Reaching generation limits returns an error. Lower-resource translation remains experimental.
- **Suggestion popups.** Hovering an underline or pausing near an issue opens a card without
  focusing it; clicking still focuses its controls. Geometry can be measured before the next
  animation frame, so delayed painting does not drop a requested popup.
- **Auto-correct is a setting, not per-fix confirmation.** Off by default; when enabled,
  one concrete grammar/spelling fix or the first known wordy/redundant replacement can apply
  automatically. Only a focused field edited by the user is changed, at word boundaries, after
  a pause; at most 20 edits per batch. Selected text, IME composition and native undo/redo are
  protected. Changes preserve caret/selection and scroll position. No AI rewrites are applied.
- **Undo.** A notice and Alt+Shift+Z reverse the latest batch while its text is unchanged.
  Inverse edits preserve surrounding markup; undo suppresses immediate re-correction.
  Automatic changes do not increment manually accepted spelling statistics.
- **Visual refresh.** Two-row navigation, mint/slate light and dark themes, softer cards,
  visible keyboard focus, and an integrated translation editor, result card and pack library.
- **Delivery state.** The combined 1.3.0 release was requested after speech, typing, local translation and UI work. See `docs/RELEASE_NOTES_v1.3.md` for the full release scope.
- **Paced typing.** A single background coordinator pins an explicit user-selected tab/frame/
  field; discovery uses nonce-bound reports and browser-provided sender identities. The content
  controller owns insertion timers and validates field contents, focus, caret, visibility,
  read-only/maxlength changes and editor acceptance on every step. Session IDs and monotonically
  increasing report sequences prevent stale or unrelated frame reports from retargeting a job.
  Start cancellation also stops a late-arriving content session. No draft is persisted.
- **Timing and input.** Fresh cryptographic random samples feed bounded lognormal character
  intervals, smooth word-level tempo changes, punctuation delays, occasional hesitations and
  probabilistic sentence/paragraph pauses. Speed is approximate. Grapheme segmentation preserves
  multilingual input; an older-browser fallback groups combining marks and common emoji clusters.
  Normal insertText/native undo is preferred, with existing input-event fallbacks. No trusted-event
  spoofing or history alteration. Human indistinguishability/detection bypass is not promised.
- **Rich-editor compatibility.** Native trailing-space NBSP conversions are accepted without
  accepting arbitrary rewrites. Element caret anchors cover empty paragraphs, explicit breaks and
  positions after a final block. A native newline's placeholder break is accepted; other changes
  stop the session. Autocorrect and suggestion popups are suppressed on actively typed fields.
- **Local speech.** A separate optional 76 MiB q8 multilingual Whisper Base pack uses pinned
  revision/file sizes and the shared model cache. No SpeechRecognition/browser cloud service.
  Microphone permission/recording runs in a user-opened extension tab; sidebar audio-file import
  is also available. Maximum 120 seconds/25 MB. MediaRecorder owns and releases tracks on stop,
  discard, timeout, failure, navigation and late permission grants after cancellation. Browser
  audio decoding/downmixing/resampling produces 16 kHz mono PCM, sent only to the local background.
- **Cache-only ASR loading.** The Transformers.js v4 pipeline helper probes main metadata before
  forwarding its local-only options. Construct its public tokenizer, processor, speech model
  and pipeline components directly, with the pinned revision and local_files_only on each loader.
  A real-model Node CPU test blocks both fetch paths and asserts zero attempted requests. The
  built browser/WASM path was separately verified with imported audio.
- **Conservative speech cleanup.** Whisper supplies punctuation; acoustic segment gaps after
  sentence boundaries can add paragraphs. English-only hesitation removal, whitespace/casing and
  final marks are optional. Never delete ambiguous phrases, paraphrase, censor profanity/slurs
  or change the original model transcript. Keep the original result separate from formatted text,
  including CJK spacing; reapply only by explicit action. Model misrecognition remains possible.
  The language list comes from this model's 99 tokens, not the translation library's 22 scheduled
  Indian-language promise. Near silence is rejected, cancellation is checked between model steps,
  and reaching the decoder segment cap errors instead of silently returning a truncated transcript.
- **Speech privacy.** No audio/transcription history or persisted drafts. Only model blobs are
  stored. The microphone stays off until explicit Start; Stop releases it before inference.
  Settings clear-models unloads the speech engine too; an active speech job/download blocks it.

## 1.3.0 final UI, activation and field privacy

- Settings uses `options_ui` with `open_in_tab`, launched only by explicit commands. The sidebar
  retains writing tools and a Settings link. A standalone responsive rail/page shares the same
  settings component; it does not try to activate its own extension tab. Gloss is limited to
  quiet gradients/highlights, rectangular controls, brief motion and reduced-motion overrides.
- The manifest no longer injects a content script on every site. `contentScripts.register` is
  scoped to automatic-site domains; `tabs.executeScript` handles manual page actions. Click-only
  mode overrides saved sites. Navigation revokes manual approval. Disabling stops watchers,
  disconnects observers and destroys the overlay. Typing listeners exist only during a session.
- The background entry contains command routing, settings, stats and activation. Heavy engines
  are imported from local split chunks only when requested. Startup no longer warms Harper.
  Opening settings/model status does not initialize an engine. The lightweight background router
  remains registered to receive clicks; this is not a claim that the browser unloads the extension.
- A shared structural policy guards extraction, selection, checking, replacement and typing.
  It uses HTML attributes, associated static labels, form owners/actions, auth/payment controls
  and ancestor metadata, never field values or screenshots for classification. Email, password,
  address, payment, account/identity/contact and structured validation/input modes are blocked.
  Unknown single-line text inputs require a positive free-text purpose. Read-only selections are
  excluded. Policy is rechecked during jobs and metadata mutations remove tracked fields.
- Metadata cannot prove a site's intent. No claim that a mislabeled textarea or sensitive prose
  intentionally entered in a free-text editor can be identified without inspecting its contents.
  Unit tests use throwing value getters to verify blocked fields are never read by these paths.
