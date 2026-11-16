// Real model smoke test: npm run smoke:translation [language]. Text is synthetic.
import 'fake-indexeddb/auto';
import { env } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LocalTranslator } from '../src/background/translation';
import { modelCache } from '../src/background/model-cache';
import type { TranslationLanguage } from '../src/shared/translation';

const storage: Record<string, unknown> = {};
Object.assign(globalThis, { browser: { storage: { local: { get: async (key: string) => ({ [key]: storage[key] }), set: async (values: Record<string, unknown>) => { Object.assign(storage, values); } } } } });
const folder = path.join(process.env.TEMP ?? '.', 'grammaid-mt');
await mkdir(folder, { recursive: true });
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const file = path.join(folder, createHash('sha256').update(url).digest('hex'));
  try { return new Response(await readFile(file)); } catch { /* download a missing model file */ }
  const response = await nativeFetch(input, init);
  if (!response.ok) return response;
  const bytes = await response.arrayBuffer();
  await writeFile(file, new Uint8Array(bytes));
  return new Response(bytes, { headers: response.headers });
};
env.allowLocalModels = true; env.localModelPath = folder; env.useBrowserCache = false; env.useCustomCache = true; env.customCache = modelCache;
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmBinary = new Uint8Array(await readFile(path.resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm')));
const engine = new LocalTranslator({ device: 'cpu' });
const language = (process.argv[2] ?? 'es') as TranslationLanguage;
await engine.startDownload(language);
let last = '';
while (true) {
  const status = (await engine.status()).find((p) => p.language === language)!;
  const progress = `${status.state} ${Math.floor((status.progress ?? 0) * 100)}%`;
  if (progress !== last) { console.log(language, progress); last = progress; }
  if (status.state === 'error') throw new Error(status.error);
  if (status.state === 'ready') break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
let blockedRequests = 0;
globalThis.fetch = env.fetch = async () => { blockedRequests++; throw new Error('Network disabled for offline inference test'); };
const result = await engine.translate('Hello, how are you?', 'en', language);
console.log('OFFLINE RESULT', JSON.stringify(result));
const back = await engine.translate(result.text, language, 'en');
console.log('BACK TO ENGLISH', JSON.stringify(back));
console.log('NETWORK REQUESTS DURING INFERENCE', blockedRequests);
if (blockedRequests) throw new Error('Offline inference attempted network access');
await engine.unload();
