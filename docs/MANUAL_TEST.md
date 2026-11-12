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
