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
