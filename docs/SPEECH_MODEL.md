# Local speech model

Grammaid uses [onnx-community/whisper-base](https://huggingface.co/onnx-community/whisper-base),
an ONNX conversion of [OpenAI Whisper Base](https://huggingface.co/openai/whisper-base).
The conversion repository declares Apache-2.0; original Whisper code/model weights are MIT.
The library/runtime ships in the XPI; speech model weights download only on an explicit click.

Revision: `27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c`.
`src/data/speech-model.json` pins all seven required files, exact byte lengths and model language
tokens. Total: **79,664,191 bytes**, about **76 MiB**. The two ONNX files use q8 quantization.
An interrupted current file restarts; complete files remain cached. Removing the pack or clearing
all downloaded models removes cached files. No remote code or speech service is used.

The pack is multilingual, with 99 language tokens and optional automatic language detection.
Select the spoken language to improve results; the task is always `transcribe`, never translation.
Its Indian-language coverage differs from Grammaid's 22-language translation library. Unsupported
speech languages are not presented as supported choices. Accuracy varies by language/accent/noise.

Microphone capture uses browser `getUserMedia` and `MediaRecorder` in a user-opened extension tab.
Import/recording audio is decoded locally, downmixed/resampled by `OfflineAudioContext` to 16 kHz
mono, and passed to the background as bounded PCM16. Maximum clip length is 120 seconds and file
size is 25 MB. Model inference uses WASM inside Waterfox and the shared inference queue.
Near-silent input is rejected; this amplitude check is not full voice-activity detection.

The Transformers.js 4.3.2 `pipeline()` helper performs unpinned `main` metadata lookups before
honoring `local_files_only`. Grammaid constructs `AutoTokenizer`, `AutoProcessor`, the speech model
and ASR pipeline directly with the pinned revision and cache-only flags. A real-model smoke test
blocks both global and library fetch during transcription, asserting zero attempted requests.

Whisper supplies sentence punctuation. Acoustic gaps of at least 1.8 seconds following a sentence
can become paragraph breaks. Conservative, reversible cleanup removes English hesitation words,
normalizes spacing/capitalization and supplies a final mark when missing. No profanity/slur list,
redaction, semantic rewriting or online punctuation service is used. The original model transcript
remains available. The model itself can misrecognize or omit offensive words, like any other word.

`npm run smoke:speech` downloads this pack and the public JFK sample from the Transformers.js
documentation dataset into `%TEMP%/grammaid-speech`, then tests local inference on Node CPU with
network calls disabled. The browser harness separately exercises the real WASM runtime and local
file import. The sample is the public-domain John F. Kennedy inaugural speech excerpt distributed
at `Xenova/transformers.js-docs/jfk.wav`; it is test input, not bundled in the XPI.
