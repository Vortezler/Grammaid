// Imported only by an explicit writing/model feature. Startup never warms a WASM engine.
import { env } from '@huggingface/transformers';
import { HarperEngine } from './harper';
import { LintPipeline } from './lint';
import { TransformersLanguageModel } from './model';
import { modelCache } from './model-cache';
import { LocalTranslator } from './translation';
import { LocalSpeech } from './speech';
import { getSettings, onSettingsChanged } from './settings';
import type { Lexicon, Sense } from './synonyms';
import type { Engines } from './messages';

export async function createEngines(): Promise<Engines> {
  env.allowLocalModels = true; env.localModelPath = browser.runtime.getURL('models/');
  env.useBrowserCache = false; env.useCustomCache = true; env.customCache = modelCache; env.useWasmCache = false;
  if (env.backends.onnx.wasm) { env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.wasmPaths = browser.runtime.getURL('vendor/ort/'); }
  const settings = await getSettings();
  const model = new TransformersLanguageModel({ scoringModelId: async () => (await getSettings()).scoringModelId, rewriteModelId: async () => (await getSettings()).rewriteModelId });
  const harper = new HarperEngine(browser.runtime.getURL('vendor/harper/harper_wasm_bg.wasm'), settings.dialect, settings.userDictionary);
  const lint = new LintPipeline((text) => harper.lint(text), getSettings);
  onSettingsChanged((next) => { lint.clearCache(); void harper.configure(next.dialect, next.userDictionary).catch((error) => console.warn('Grammaid: could not update grammar preferences', error)); });
  let lexiconPromise: Promise<Lexicon> | null = null;
  const lexicon = () => lexiconPromise ??= (async () => {
    const result: Lexicon = {};
    for (const pos of ['n', 'v', 'a', 'r'] as const) {
      const part = await fetch(browser.runtime.getURL(`data/wordnet-${pos}.json`)).then((response) => response.json()) as Record<string, Sense[]>;
      for (const [lemma, senses] of Object.entries(part)) (result[lemma] ??= {})[pos] = senses;
    }
    return result;
  })().catch((error) => { lexiconPromise = null; throw error; });
  return { lint, model, lexicon, translator: new LocalTranslator(), speech: new LocalSpeech() };
}
