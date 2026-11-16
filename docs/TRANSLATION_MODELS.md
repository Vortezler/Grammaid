# Local translation models

Language-pack downloads contain model data and JSON tokenizers, never executable remote code.
The exact repository revisions, required files and byte sizes are pinned in
`src/data/translation-models.json`. Refresh using `npm run verify:translation-packs`.

## Engines and licenses

- [Helsinki-NLP OPUS-MT](https://huggingface.co/Helsinki-NLP), converted for the browser by
  [Xenova](https://huggingface.co/Xenova). Most packs use their own English pair; Portuguese uses
  the Romance pair. Japanese output, Traditional Chinese output and several Indian languages
  reuse the `en-mul` / `mul-en` pair. OPUS-MT licenses vary by repository: Apache-2.0 or CC BY 4.0.
  Credit: Language Technology Research Group, University of Helsinki, and the OPUS-MT contributors.
- [AI4Bharat IndicTrans2](https://huggingface.co/ai4bharat/indictrans2-en-indic-dist-200M), MIT.
  Local ONNX bundles by [Hari31416](https://github.com/Hari31416/indictrans2-onnx-export), MIT:
  `hari31416/indictrans2-{en-indic,indic-en}-dist-200M-ONNX-int8`.
  Used for Bodo, Dogri, Kashmiri, Konkani, Manipuri, Nepali and Santali. Those languages use the
  engine's native Devanagari, Perso-Arabic, Meitei Mayek or Ol Chiki scripts. Other Indian scripts
  use OPUS with verified target-language vocabulary IDs. The custom encoder/decoder loop follows
  the published model interface; no downloaded Python or other remote code is executed.
- [Meta NLLB-200 distilled 600M](https://huggingface.co/facebook/nllb-200-distilled-600M), converted
  by [Xenova](https://huggingface.co/Xenova/nllb-200-distilled-600M). **CC BY-NC 4.0: non-commercial
  use only.** Used for English → Korean. Korean → English uses OPUS. Installing Korean downloads
  this larger shared model; its full size is shown in the UI.

The extension itself remains MIT; downloaded model weights retain their own licenses.
Translation accuracy is not guaranteed and is particularly variable for low-resource languages.

## Offline operation

Only the explicit download path fetches model files. Each pack includes both directions with
English, with dependency files reused between packs. Installation is recorded only after all
required pinned files have been cached successfully. Translation checks those files and then
uses cache-only model loading. Missing or corrupt-size files produce an error, not a web fallback.

Text never enters a network URL or request body. Non-English pairs pass through English locally.
Only one translation model is loaded at a time, with inference serialized alongside writing
models. Unicode-safe chunking limits input tokens; reaching the generation limit returns an
error rather than presenting a silently truncated translation.

The user can remove packs independently. Shared files remain until their last dependent pack
is removed. Stopping a download retains complete files so they need not be fetched again.
