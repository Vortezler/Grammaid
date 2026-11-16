import { AutoTokenizer, AutoModelForSeq2SeqLM, Tensor, type PreTrainedTokenizer, type PreTrainedModel, NllbTokenizer } from '@huggingface/transformers';
import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-web/webgpu';
import { TRANSLATION_LANGUAGES, TRANSLATION_MODELS, modelUrl, packModels, translationPlan, validateTranslation, type TranslationLanguage, type TranslationLeg, type TranslationModelId, type TranslationPackStatus, type TranslationResult } from '../shared/translation';
import { cachedFileSizes, modelCache } from './model-cache';
import { inferenceJob } from './inference-queue';

const STORAGE_KEY = 'translation-packs';
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Split at word boundaries or Unicode code points; never silently truncate input. */
export function translationChunks(text: string, tokenCount: (text: string) => number, limit = 180): string[] {
  if (!text) return [];
  if (tokenCount(text) <= limit) return [text];
  const points = Array.from(text);
  const middle = Math.floor(points.length / 2);
  if (!middle) throw new Error('This character cannot be encoded by the selected language pack.');
  let cut = middle;
  for (let i = middle; i > Math.floor(middle / 2); i--) {
    if (/[\s.!?。！？।]/u.test(points[i - 1])) { cut = i; break; }
  }
  return [...translationChunks(points.slice(0, cut).join(''), tokenCount, limit), ...translationChunks(points.slice(cut).join(''), tokenCount, limit)];
}
interface Loaded {
  id: TranslationModelId;
  translate(text: string, step: TranslationLeg): Promise<string>;
  count(text: string, step: TranslationLeg): number;
  dispose(): Promise<void>;
}
export function marianIds(text: string, prefix: string, tokenizer: Pick<PreTrainedTokenizer, 'get_vocab' | 'encode'>): number[] {
  const languageId = tokenizer.get_vocab().get(prefix.trim());
  if (languageId === undefined) throw new Error('The pack does not contain the selected target-language token.');
  return [languageId, ...tokenizer.encode(text)];
}
async function cachedBytes(id: TranslationModelId, name: string): Promise<Uint8Array> {
  const response = await modelCache.match(modelUrl(id, name));
  if (!response) throw new Error('A language-pack file is missing. Download the pack again.');
  return new Uint8Array(await response.arrayBuffer());
}
async function cachedJson(id: TranslationModelId, name: string): Promise<Record<string, unknown>> {
  const response = await modelCache.match(modelUrl(id, name));
  if (!response) throw new Error('A language-pack file is missing. Download the pack again.');
  return response.json() as Promise<Record<string, unknown>>;
}
async function loadStandard(id: TranslationModelId, device: 'cpu' | 'wasm'): Promise<Loaded> {
  const options = { revision: TRANSLATION_MODELS[id].revision, local_files_only: true };
  let model: PreTrainedModel | undefined;
  try {
    const tokenizer: PreTrainedTokenizer = await AutoTokenizer.from_pretrained(id, options);
    model = await AutoModelForSeq2SeqLM.from_pretrained(id, { ...options, dtype: 'q8', device });
    const engine = model;
    return {
      id,
      count: (text, step) => tokenizer.encode(text).length + (step.prefix ? 1 : 0),
      async translate(text, step) {
        const kwargs: Record<string, unknown> = { max_new_tokens: 256, do_sample: false, num_beams: 1 };
        let input = step.nllb
          ? (tokenizer as NllbTokenizer)._build_translation_inputs(text, {}, Object.assign(kwargs, { src_lang: step.nllb.source, tgt_lang: step.nllb.target }))
          : tokenizer(text, { truncation: false });
        if (step.prefix) {
          // Marian's v4 wrapper does not route _call through its language-prefix override.
          // Insert the verified vocabulary ID, not a BPE encoding of the visible tag.
          const ids = marianIds(text, step.prefix, tokenizer);
          input = { input_ids: new Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]), attention_mask: new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]) };
        }
        const output = await engine.generate({ ...input, ...kwargs }) as Tensor;
        const tokens = Array.from(output.data as BigInt64Array, Number);
        if (tokens.length >= 257 && tokens.at(-1) !== tokenizer.eos_token_id) throw new Error('Translation reached the model limit. Try a shorter passage.');
        const result = tokenizer.batch_decode(output, { skip_special_tokens: true })[0]?.trim();
        if (!result) throw new Error('The local model returned no translation. Try a shorter passage.');
        return result;
      },
      dispose: () => engine.dispose().then(() => undefined),
    };
  } catch (error) { await model?.dispose(); throw error; }
}

// These Indic languages use the model's native scripts: Devanagari, Perso-Arabic,
// Meitei Mayek and Ol Chiki. Other Indian scripts use verified OPUS target tokens.
const indicInput = (text: string, step: TranslationLeg) => `${step.indic!.source} ${step.indic!.target} ${text.normalize('NFC').replace(/\s+/gu, ' ').trim()}`;
async function loadIndic(id: TranslationModelId): Promise<Loaded> {
  const src = new Tokenizer(await cachedJson(id, 'tokenizer_src.json'), {});
  const tgt = new Tokenizer(await cachedJson(id, 'tokenizer_tgt.json'), {});
  const meta = await cachedJson(id, 'tokenizer_meta.json');
  const sessions: ort.InferenceSession[] = [];
  try {
    for (const name of ['encoder_model', 'decoder_model', 'decoder_with_past_model']) {
      const sidecar = name === 'encoder_model' ? 'encoder_model.onnx.data' : 'decoder_shared.onnx.data';
      sessions.push(await ort.InferenceSession.create(await cachedBytes(id, `${name}.onnx`), {
        executionProviders: ['wasm'], externalData: [{ path: sidecar, data: await cachedBytes(id, sidecar) }],
      }));
    }
    const [encoder, decoder, pastDecoder] = sessions;
    const tensor = (ids: number[]) => new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
    return {
      id,
      count: (text, step) => src.encode(indicInput(text, step)).ids.length,
      async translate(text, step) {
        const ids = src.encode(indicInput(text, step)).ids.map((id) => id < Number(meta.src_dict_size) ? id : Number(meta.unk_id));
        const attention = tensor(ids.map(() => 1));
        const inputIds = tensor(ids);
        let encoded: ort.InferenceSession.OnnxValueMapType | undefined;
        let previous: ort.InferenceSession.OnnxValueMapType | undefined;
        const generated: number[] = [];
        try {
          encoded = await encoder.run({ input_ids: inputIds, attention_mask: attention });
          let next = 2;
          for (let i = 0; i < 256; i++) {
            const stepInput = tensor([next]);
            const feeds: Record<string, ort.Tensor> = { input_ids: stepInput, encoder_attention_mask: attention };
            if (!previous) feeds.encoder_hidden_states = encoded.last_hidden_state;
            else for (const name of pastDecoder.inputNames) {
              if (!name.startsWith('past_key_values.')) continue;
              const key = name.replace('past_key_values.', 'present.');
              if (!previous[key]) throw new Error(`Missing decoder state ${key}.`);
              feeds[name] = previous[key];
            }
            let output: ort.InferenceSession.OnnxValueMapType;
            try { output = await (previous ? pastDecoder : decoder).run(feeds); }
            finally { stepInput.dispose(); }
            if (previous) for (const value of Object.values(previous)) value.dispose();
            previous = output;
            const logits = output.logits;
            const data = logits.data as Float32Array;
            const vocabulary = logits.dims.at(-1)!;
            const offset = data.length - vocabulary;
            next = 0;
            for (let token = 1; token < vocabulary; token++) if (data[offset + token] > data[offset + next]) next = token;
            generated.push(next);
            if (next === 2) break;
          }
          if (generated.at(-1) !== 2) throw new Error('Translation reached the model limit. Try a shorter passage.');
          const output = tgt.decode(generated.map((id) => id < Number(meta.tgt_dict_size) ? id : Number(meta.unk_id)), { skip_special_tokens: true }).trim();
          if (!output) throw new Error('The local model returned no translation.');
          return output;
        } finally {
          inputIds.dispose(); attention.dispose();
          for (const output of [encoded, previous]) if (output) for (const value of Object.values(output)) value.dispose();
        }
      },
      async dispose() { for (const session of sessions) await session.release(); },
    };
  } catch (error) { for (const session of sessions) await session.release(); throw error; }
}

export class LocalTranslator {
  constructor(private options: { device?: 'cpu' | 'wasm' } = {}) {}
  private loaded: Loaded | null = null;
  private download: { language: TranslationLanguage; controller: AbortController; loaded: number; total: number } | null = null;
  private errors = new Map<TranslationLanguage, string>();
  private installed = new Set<TranslationLanguage>();
  private initialized: Promise<void> | undefined;
  private busy = false;
  private init() {
    return this.initialized ??= browser.storage.local.get(STORAGE_KEY).then((raw) => {
      const languages: unknown = raw[STORAGE_KEY];
      if (Array.isArray(languages)) for (const language of TRANSLATION_LANGUAGES) if (languages.includes(language.code)) this.installed.add(language.code);
    });
  }
  private save() { return browser.storage.local.set({ [STORAGE_KEY]: [...this.installed] }); }
  async status(): Promise<TranslationPackStatus[]> {
    await this.init();
    const sizes = await cachedFileSizes();
    return TRANSLATION_LANGUAGES.map(({ code }) => {
      const models = packModels(code);
      const files = models.flatMap((id) => TRANSLATION_MODELS[id].files.map((file) => ({ ...file, url: modelUrl(id, file.name) })));
      const missing = files.filter((file) => sizes[file.url] !== file.bytes);
      const downloading = this.download?.language === code;
      return { language: code, state: downloading ? 'downloading' : this.errors.has(code) ? 'error' : (code === 'en' || this.installed.has(code)) && !missing.length ? 'ready' : 'missing',
        bytes: files.reduce((sum, file) => sum + file.bytes, 0), downloadBytes: missing.reduce((sum, file) => sum + file.bytes, 0),
        progress: downloading ? this.download!.loaded / Math.max(1, this.download!.total) : undefined,
        error: this.errors.get(code), shared: models.some((id) => /mul|ROMANCE|indictrans/.test(id)) };
    });
  }
  async startDownload(language: TranslationLanguage) {
    await this.init();
    if (!TRANSLATION_LANGUAGES.some((l) => l.code === language)) throw new Error('Unknown language pack.');
    if (this.download || this.busy) throw new Error('Wait for the current translation or download to finish.');
    const models = packModels(language);
    const total = models.flatMap((id) => TRANSLATION_MODELS[id].files).reduce((sum, file) => sum + file.bytes, 0);
    const controller = new AbortController();
    this.download = { language, controller, loaded: 0, total };
    this.errors.delete(language);
    void this.install(language, models, controller).catch((error) => {
      this.errors.set(language, controller.signal.aborted ? 'Download stopped. Resume to keep downloading missing files.' : `Download failed: ${errorText(error)}`);
    }).finally(() => { this.download = null; });
  }
  cancelDownload() { this.download?.controller.abort(); }
  private async install(language: TranslationLanguage, models: TranslationModelId[], controller: AbortController) {
    for (const id of models) for (const file of TRANSLATION_MODELS[id].files) {
      controller.signal.throwIfAborted();
      const url = modelUrl(id, file.name);
      const cached = await modelCache.match(url);
      if (cached && Number(cached.headers.get('content-length')) === file.bytes) { this.download!.loaded += file.bytes; continue; }
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} while downloading ${file.name}.`);
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let received = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(part.value); received += part.value.length; this.download!.loaded += part.value.length;
      }
      if (received !== file.bytes) throw new Error(`Incomplete file ${file.name}. Try downloading again.`);
      const blob = new Blob(chunks, { type: response.headers.get('content-type') ?? 'application/octet-stream' });
      await modelCache.put(url, new Response(blob, { headers: { 'content-length': String(file.bytes) } }));
      if (file.name === 'tokenizer_config.json') await modelCache.put(`https://huggingface.co/${id}/resolve/main/${file.name}`, new Response(blob));
    }
    controller.signal.throwIfAborted();
    this.installed.add(language);
    await this.save();
  }
  async remove(language: TranslationLanguage) {
    await this.init();
    if (this.download || this.busy) throw new Error('Wait for the current translation or download to finish.');
    this.installed.delete(language); this.errors.delete(language);
    await this.save();
    await inferenceJob(async () => {
      await this.loaded?.dispose(); this.loaded = null;
      const retained = new Set([...this.installed].flatMap(packModels));
      for (const id of packModels(language)) if (!retained.has(id)) {
        for (const file of TRANSLATION_MODELS[id].files) await modelCache.delete(modelUrl(id, file.name));
        await modelCache.delete(`https://huggingface.co/${id}/resolve/main/tokenizer_config.json`);
      }
    });
  }
  async unload() {
    if (this.download || this.busy) throw new Error('Finish translation or stop the download before clearing models.');
    await inferenceJob(async () => { await this.loaded?.dispose(); this.loaded = null; });
  }
  async forgetPacks() { this.installed.clear(); this.errors.clear(); await this.save(); }
  async translate(text: string, source: TranslationLanguage, target: TranslationLanguage): Promise<TranslationResult> {
    validateTranslation(text, source, target);
    if (this.busy || this.download) throw new Error('Wait for the current translation or download to finish.');
    this.busy = true;
    try {
      const status = await this.status();
      for (const code of [source, target]) if (status.find((pack) => pack.language === code)?.state !== 'ready') throw new Error(`Download the ${TRANSLATION_LANGUAGES.find((l) => l.code === code)?.name} pack first.`);
      const steps = translationPlan(source, target);
      const output = await inferenceJob(async () => {
        let output = text;
        for (const step of steps) {
          if (this.loaded?.id !== step.model) {
            await this.loaded?.dispose(); this.loaded = null;
            this.loaded = await (step.indic ? loadIndic(step.model) : loadStandard(step.model, this.options.device ?? 'wasm'));
          }
          const engine = this.loaded;
          const paragraphs: string[] = [];
          for (const paragraph of output.split(/(\r?\n+)/u)) {
            if (!paragraph.trim()) { paragraphs.push(paragraph); continue; }
            const results: string[] = [];
            for (const chunk of translationChunks(paragraph, (text) => engine.count(text, step))) results.push(await engine.translate(chunk, step));
            paragraphs.push(results.join(' '));
          }
          output = paragraphs.join('');
        }
        return output;
      });
      return { text: output, source, target, viaEnglish: steps.length > 1 };
    } catch (error) { throw new Error(`Local translation failed: ${errorText(error)}`); }
    finally { this.busy = false; }
  }
}
