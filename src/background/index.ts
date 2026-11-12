// Background page: the only place heavy work happens (Harper, language models, WordNet, stats).
import { env } from '@huggingface/transformers';
import { HarperEngine } from './harper';
import { LintPipeline } from './lint';
import { TransformersLanguageModel } from './model';
import { modelCache } from './model-cache';
import { SpellingStore } from './spelling-store';
import { getSettings, loadSettings, onSettingsChanged } from './settings';
import { createHandlers, listen } from './messages';
import { registerMenus } from './menus';
import { registerActivation } from './activation';
import type { Lexicon, Sense } from './synonyms';

// --- ONNX Runtime / Transformers.js wiring -------------------------------------------------
// Models come from Hugging Face on first use and are then served from IndexedDB. The WASM runtime
// itself ships inside the extension, single-threaded (no SharedArrayBuffer needed).
env.allowLocalModels = false;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = modelCache;
// The WASM-factory cache turns the runtime into a blob: URL, which the extension CSP forbids.
env.useWasmCache = false;
const onnxWasm = env.backends.onnx.wasm;
if (onnxWasm) {
  onnxWasm.numThreads = 1;
  onnxWasm.wasmPaths = browser.runtime.getURL('vendor/ort/');
}

const model = new TransformersLanguageModel({
  scoringModelId: async () => (await getSettings()).scoringModelId,
  rewriteModelId: async () => (await getSettings()).rewriteModelId,
});

const harper = new HarperEngine(browser.runtime.getURL('vendor/harper/harper_wasm_bg.wasm'), 'American', []);
const lint = new LintPipeline((text) => harper.lint(text), getSettings);
const spelling = new SpellingStore(browser.storage.local as never);

// The synonym index ships as one file per part of speech; merge them on first use.
const POS = ['n', 'v', 'a', 'r'] as const;
async function loadLexicon(): Promise<Lexicon> {
  const parts = await Promise.all(
    POS.map((pos) => fetch(browser.runtime.getURL(`data/wordnet-${pos}.json`)).then((r) => r.json() as Promise<Record<string, Sense[]>>)),
  );
  const lexicon: Lexicon = {};
  parts.forEach((part, i) => {
    for (const [lemma, senses] of Object.entries(part)) (lexicon[lemma] ??= {})[POS[i]] = senses;
  });
  return lexicon;
}
let lexiconPromise: Promise<Lexicon> | null = null;
const lexicon = () =>
  (lexiconPromise ??= loadLexicon().catch((e) => {
    lexiconPromise = null;
    throw e;
  }));

listen(createHandlers({ lint, model, spelling, lexicon }));
registerMenus();
registerActivation();

void loadSettings().then(async (settings) => {
  await harper.configure(settings.dialect, settings.userDictionary);
  // Warm Harper up so the first check in a page is fast.
  harper.setup().catch((e) => console.error('Grammaid: Harper failed to start', e));
});

onSettingsChanged((next) => {
  lint.clearCache();
  harper.configure(next.dialect, next.userDictionary).catch((e) => console.error('Grammaid: Harper reconfigure failed', e));
});
