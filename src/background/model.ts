// Local language models (Transformers.js + ONNX Runtime Web). Lazy: nothing is downloaded or
// loaded until a smart feature is first used. Environment-specific setup (WASM paths, cache)
// is done by the caller so this file also runs under Node for `npm run calibrate`.
import {
  AutoTokenizer,
  AutoModelForCausalLM,
  AutoModelForSeq2SeqLM,
  Tensor,
  type PreTrainedTokenizer,
  type PreTrainedModel,
} from '@huggingface/transformers';
import type { LoadState } from '../shared/types';

export interface SentenceScoreResult {
  meanLogProb: number;
  perplexity: number;
  tokens: number;
}

export interface LanguageModel {
  scoreSentences(sentences: string[]): Promise<SentenceScoreResult[]>;
  rephrase(text: string, n: number): Promise<string[]>;
  status(): { gpt2: LoadState; t5: LoadState; progress?: number; error?: string };
}

export interface ModelConfig {
  scoringModelId: () => string | Promise<string>;
  rewriteModelId: () => string | Promise<string>;
  onStatus?: () => void;
  /** ONNX execution device: 'wasm' in the browser (default), 'cpu' under Node. */
  device?: 'wasm' | 'cpu';
}

export const MIN_TOKENS = 6;
const MAX_TOKENS = 256;
const SCORE_CACHE_MAX = 800;

interface ProgressEvent {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

interface Loaded {
  id: string;
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch|network|Failed to|NetworkError|ENOTFOUND|offline/i.test(msg)) {
    return 'Could not download the model. Check your internet connection and try again. It is only needed once.';
  }
  if (/Could not locate file|404|Unauthorized|not a valid model/i.test(msg)) {
    return `The model could not be found on Hugging Face (${msg.slice(0, 120)}). Check the model id in Settings.`;
  }
  return `The model failed to load: ${msg.slice(0, 200)}`;
}

/** Mean log-probability of each token given the tokens before it, from raw next-token logits. */
export function meanLogProbFromLogits(logits: Float32Array, vocab: number, ids: number[]): number {
  // logits row t predicts ids[t + 1]
  let total = 0;
  const steps = ids.length - 1;
  for (let t = 0; t < steps; t++) {
    const off = t * vocab;
    let max = -Infinity;
    for (let v = 0; v < vocab; v++) if (logits[off + v] > max) max = logits[off + v];
    let sum = 0;
    for (let v = 0; v < vocab; v++) sum += Math.exp(logits[off + v] - max);
    total += logits[off + ids[t + 1]] - max - Math.log(sum);
  }
  return total / steps;
}

export class TransformersLanguageModel implements LanguageModel {
  private gpt2: Loaded | null = null;
  private t5: Loaded | null = null;
  private gpt2Loading: Promise<Loaded> | null = null;
  private t5Loading: Promise<Loaded> | null = null;
  private state: { gpt2: LoadState; t5: LoadState } = { gpt2: 'idle', t5: 'idle' };
  private error: string | undefined;
  private files = new Map<string, { loaded: number; total: number }>();
  private scoreCache = new Map<string, SentenceScoreResult>();
  // Inference is serialized: ONNX Runtime's single WASM thread cannot run two sessions at once.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private config: ModelConfig) {}

  status() {
    let loaded = 0;
    let total = 0;
    for (const f of this.files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    const loading = this.state.gpt2 === 'loading' || this.state.t5 === 'loading';
    return {
      ...this.state,
      progress: loading && total > 0 ? Math.min(1, loaded / total) : undefined,
      error: this.error,
    };
  }

  private notify() {
    try {
      this.config.onStatus?.();
    } catch {
      // status listeners are best-effort
    }
  }

  private onProgress = (e: ProgressEvent) => {
    if (e.status === 'progress' && e.file && typeof e.total === 'number' && e.total > 0) {
      this.files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
      this.notify();
    }
  };

  private async load(kind: 'gpt2' | 't5'): Promise<Loaded> {
    const id = await (kind === 'gpt2' ? this.config.scoringModelId() : this.config.rewriteModelId());
    this.state[kind] = 'loading';
    this.error = undefined;
    this.notify();
    try {
      const options = { dtype: 'q8' as const, device: this.config.device ?? ('wasm' as const), progress_callback: this.onProgress };
      const tokenizer = await AutoTokenizer.from_pretrained(id, { progress_callback: this.onProgress });
      const model =
        kind === 'gpt2'
          ? // Xenova/distilgpt2 ships two quantized files: "model_quantized" (236 MB, the default
            // pick) and "decoder_model_merged_quantized" (85 MB). Prefer the small one; fall back
            // to the default name for repos that do not have it.
            await AutoModelForCausalLM.from_pretrained(id, { ...options, model_file_name: 'decoder_model_merged' }).catch(() =>
              AutoModelForCausalLM.from_pretrained(id, options),
            )
          : await AutoModelForSeq2SeqLM.from_pretrained(id, options);
      this.state[kind] = 'ready';
      this.notify();
      return { id, tokenizer, model };
    } catch (e) {
      this.state[kind] = 'error';
      this.error = friendlyError(e);
      this.notify();
      throw new Error(this.error);
    }
  }

  /** Loads (downloading on first use) the scoring model; reloads if the id changed in settings. */
  async ensureGpt2(): Promise<Loaded> {
    const id = await this.config.scoringModelId();
    if (this.gpt2 && this.gpt2.id === id) return this.gpt2;
    this.gpt2Loading ??= this.load('gpt2')
      .then((l) => {
        this.scoreCache.clear();
        return (this.gpt2 = l);
      })
      .finally(() => {
        this.gpt2Loading = null;
      });
    return this.gpt2Loading;
  }

  async ensureT5(): Promise<Loaded> {
    const id = await this.config.rewriteModelId();
    if (this.t5 && this.t5.id === id) return this.t5;
    this.t5Loading ??= this.load('t5')
      .then((l) => (this.t5 = l))
      .finally(() => {
        this.t5Loading = null;
      });
    return this.t5Loading;
  }

  /** Drops loaded models so the next use reloads them (after the cache was cleared). */
  async unload(): Promise<void> {
    for (const l of [this.gpt2, this.t5]) {
      try {
        await l?.model.dispose();
      } catch {
        // already disposed
      }
    }
    this.gpt2 = null;
    this.t5 = null;
    this.state = { gpt2: 'idle', t5: 'idle' };
    this.error = undefined;
    this.files.clear();
    this.scoreCache.clear();
    this.notify();
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job, job);
    this.chain = run.catch(() => undefined);
    return run;
  }

  async scoreSentences(sentences: string[]): Promise<SentenceScoreResult[]> {
    const { tokenizer, model } = await this.ensureGpt2();
    const bos = tokenizer.bos_token_id ?? tokenizer.eos_token_id ?? 50256;
    const out: SentenceScoreResult[] = [];
    for (const sentence of sentences) {
      const cached = this.scoreCache.get(sentence);
      if (cached) {
        out.push(cached);
        continue;
      }
      const result = await this.serial(async (): Promise<SentenceScoreResult> => {
        const encoded = tokenizer.encode(sentence).slice(0, MAX_TOKENS - 1);
        if (encoded.length < MIN_TOKENS) return { meanLogProb: NaN, perplexity: NaN, tokens: encoded.length };
        const ids = [bos, ...encoded];
        const shape = [1, ids.length];
        const input_ids = new Tensor('int64', BigInt64Array.from(ids.map((x) => BigInt(x))), shape);
        const attention_mask = new Tensor('int64', new BigInt64Array(ids.length).fill(1n), shape);
        const output = (await model({ input_ids, attention_mask })) as { logits: Tensor };
        const vocab = output.logits.dims[2];
        const meanLogProb = meanLogProbFromLogits(output.logits.data as Float32Array, vocab, ids);
        return { meanLogProb, perplexity: Math.exp(-meanLogProb), tokens: encoded.length };
      });
      if (this.scoreCache.size >= SCORE_CACHE_MAX) {
        const first = this.scoreCache.keys().next().value;
        if (first !== undefined) this.scoreCache.delete(first);
      }
      this.scoreCache.set(sentence, result);
      out.push(result);
    }
    return out;
  }

  async rephrase(text: string, n: number): Promise<string[]> {
    const { tokenizer, model } = await this.ensureT5();
    const prompt = `Paraphrase the following sentence so it is clearer and more concise: ${text}`;
    const results: string[] = [];
    for (let i = 0; i < n; i++) {
      const decoded = await this.serial(async () => {
        const inputs = tokenizer(prompt, { truncation: true, max_length: 256 }) as { input_ids: Tensor };
        const inputTokens = tokenizer.encode(text).length;
        // The first candidate uses beam search (steady, conservative); the rest are sampled for variety.
        const strategy = i === 0 ? { num_beams: 4, do_sample: false } : { do_sample: true, temperature: 0.8, top_p: 0.9 };
        const output = (await model.generate({
          ...inputs,
          ...strategy,
          max_new_tokens: Math.max(16, Math.ceil(inputTokens * 1.4)),
        })) as Tensor;
        return tokenizer.batch_decode(output, { skip_special_tokens: true })[0] ?? '';
      });
      const clean = decoded.trim();
      if (clean) results.push(clean);
    }
    return results;
  }
}
