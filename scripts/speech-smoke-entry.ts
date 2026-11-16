import 'fake-indexeddb/auto';
import { env } from '@huggingface/transformers';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LocalSpeech } from '../src/background/speech';
import { modelCache } from '../src/background/model-cache';
import { DEFAULT_SPEECH_OPTIONS, encodeSpeech, SPEECH_RATE } from '../src/shared/speech';

const folder = path.join(process.env.TEMP ?? '.', 'grammaid-speech');
await mkdir(folder, { recursive: true });
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const file = path.join(folder, createHash('sha256').update(String(input)).digest('hex'));
  try { return new Response(await readFile(file)); } catch { /* download only missing fixture/model data */ }
  const response = await nativeFetch(input, init); if (!response.ok) return response;
  const bytes = await response.arrayBuffer(); await writeFile(file, new Uint8Array(bytes)); return new Response(bytes, { headers: response.headers });
};
env.allowLocalModels = true; env.localModelPath = `${folder}/`; env.useBrowserCache = false; env.useCustomCache = true; env.customCache = modelCache; env.useWasmCache = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmBinary = new Uint8Array(await readFile(path.resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm')));
}
const engine = new LocalSpeech('cpu');
await engine.startDownload();
let last = '';
while (true) {
  const status = await engine.status(); const progress = `${status.state} ${Math.floor((status.progress ?? 0) * 100)}%`;
  if (progress !== last) { console.log(progress); last = progress; }
  if (status.state === 'error') throw new Error(status.error);
  if (status.state === 'ready') break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const response = await fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav');
if (!response.ok) throw new Error('Could not download the public JFK speech fixture.');
const wav = new Uint8Array(await response.arrayBuffer()); await writeFile(path.join(folder, 'speech-jfk.wav'), wav);
const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
let channels = 0; let rate = 0; let bits = 0; let format = 0; let data: Uint8Array | undefined;
for (let offset = 12; offset + 8 <= wav.length;) {
  const name = String.fromCharCode(...wav.subarray(offset, offset + 4)); const size = view.getUint32(offset + 4, true);
  if (name === 'fmt ') { format = view.getUint16(offset + 8, true); channels = view.getUint16(offset + 10, true); rate = view.getUint32(offset + 12, true); bits = view.getUint16(offset + 22, true); }
  if (name === 'data') data = wav.subarray(offset + 8, offset + 8 + size);
  offset += 8 + size + size % 2;
}
if (format !== 1 || bits !== 16 || !data || channels < 1) throw new Error('Expected PCM16 WAV fixture.');
const pcm = new DataView(data.buffer, data.byteOffset, data.byteLength); const frames = data.length / 2 / channels;
const mono = new Float32Array(frames);
for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) mono[frame] += pcm.getInt16((frame * channels + channel) * 2, true) / 32768 / channels;
const samples = new Float32Array(Math.floor(frames * SPEECH_RATE / rate));
for (let i = 0; i < samples.length; i++) { const point = i * rate / SPEECH_RATE; const lo = Math.floor(point); const fraction = point - lo; samples[i] = mono[lo] * (1 - fraction) + mono[Math.min(frames - 1, lo + 1)] * fraction; }
let blockedRequests = 0;
globalThis.fetch = env.fetch = async (input) => { blockedRequests++; throw new Error(`Network disabled for offline speech smoke test: ${String(input)}`); };
const result = await engine.transcribe('offline-smoke', encodeSpeech(samples), 'en', DEFAULT_SPEECH_OPTIONS);
console.log('OFFLINE SPEECH RESULT', JSON.stringify(result));
console.log('NETWORK REQUESTS DURING TRANSCRIPTION', blockedRequests);
if (blockedRequests || !/country/i.test(result.raw)) throw new Error('Offline speech smoke test failed.');
await engine.unload();
