Grammaid 1.2 adds a Translate tab for all 22 scheduled Indian languages and the requested world languages.

## What's new

- Choose source and target languages, swap them, paste up to 5,000 characters, or import a page selection.
- Translation opens Google Translate or Bing Translator in a new tab with text and languages
  filled in. Read or copy the result there. No translation API, API key, account, or model download is required.
- Supported languages: English, Spanish, Chinese (Simplified and Traditional), Portuguese,
  Russian, German, French, Japanese, Korean and Dutch; plus Assamese, Bengali, Bodo, Dogri,
  Gujarati, Hindi, Kannada, Kashmiri, Konkani, Maithili, Malayalam, Manipuri (Meitei), Marathi,
  Nepali, Odia, Punjabi, Sanskrit, Santali (Ol Chiki), Sindhi, Tamil, Telugu and Urdu.
- Bodo and Kashmiri use Bing Translator; other choices use Google Translate. Pairs between
  Bodo/Kashmiri and Manipuri/Santali use a guided two-step route through English, with a manual
  copy/paste between steps. Choose Bodo or Kashmiri input explicitly instead of auto-detect.

## Privacy

Translation is online: only clicking a translate button sends that step's text to its translation
website. Text appears in the new tab's URL and may remain in browser history. Grammaid stores no
translation history. Firefox versions with built-in data consent may request optional website
content permission; declining prevents translation. The existing writing tools stay local.

## Install or upgrade

1. Download `grammaid-1.2.0.xpi` from this release.
2. In Waterfox: Menu → Add-ons and themes → gear icon → **Install Add-on From File…**, then choose the XPI.
3. Open the sidebar with `Alt+Shift+G` or View → Sidebar → Grammaid, then choose **Translate**.

This unsigned add-on has no automatic updater. See the README for unsigned add-on installation instructions.
Your settings, dictionary and spelling stats are preserved when upgrading.

## Validation and limitations

- ESLint and TypeScript pass; all 121 tests pass; build and XPI packaging pass.
- `web-ext lint`: 0 errors, 5 documented warnings (version compatibility and bundled library code).
- Browser harness verified the sidebar, a Hindi translation on Google, a Bodo translation on Bing,
  and the two-step controls. Real installation and native extension APIs in Waterfox remain untested.
- Internet access is required for translation. Results stay on the provider's website; they do not
  return to the sidebar. Provider availability, scripts and translation quality can change.
- Writing checks remain English only. Existing AI-check, rewrite and Google Docs limitations remain.
