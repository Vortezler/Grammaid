import { AutoTokenizer, AutoProcessor, AutoModelForSpeechSeq2Seq, AutomaticSpeechRecognitionPipeline, StoppingCriteria, type PreTrainedModel } from '@huggingface/transformers';
import { cachedFileSizes, modelCache } from './model-cache';
import { inferenceJob } from './inference-queue';
import { cleanTranscript, decodeSpeech, hasAudibleSignal, SPEECH_MODEL, SPEECH_RATE, speechParagraphs, speechUrl, validateSpeechOptions, type SpeechOptions, type SpeechResult, type SpeechStatus } from '../shared/speech';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
class CancelSpeech extends StoppingCriteria {
  cancelled = false;
  _call(ids: number[][]): boolean[] {
    if (this.cancelled) throw new Error('Transcription cancelled.');
    if (ids.some((row) => row.length >= 440 && Number(row.at(-1)) !== 50257)) throw new Error('The speech model reached its segment limit. Try a shorter clip or slower speech.');
    return ids.map(() => false);
  }
}
async function loadSpeech(device: 'wasm' | 'cpu'): Promise<AutomaticSpeechRecognitionPipeline> {
  // The v4 pipeline() convenience loader probes main before forwarding revision/local_files_only.
  // Assemble its public components directly so every lookup is pinned and cache-only.
  const options = { revision: SPEECH_MODEL.revision, local_files_only: true };
  let model: PreTrainedModel | undefined;
  try {
    const tokenizer = await AutoTokenizer.from_pretrained(SPEECH_MODEL.id, options);
    const processor = await AutoProcessor.from_pretrained(SPEECH_MODEL.id, options);
    model = await AutoModelForSpeechSeq2Seq.from_pretrained(SPEECH_MODEL.id, { ...options, dtype: 'q8', device });
    return new AutomaticSpeechRecognitionPipeline({ task: 'automatic-speech-recognition', tokenizer, processor, model });
  } catch (error) { await model?.dispose(); throw error; }
}
export class LocalSpeech {
  private loaded: AutomaticSpeechRecognitionPipeline | null = null;
  private download: { controller: AbortController; loaded: number; total: number } | null = null;
  private job: { id: string; stop: CancelSpeech; phase: 'loading' | 'transcribing' } | null = null;
  private error: string | undefined;
  constructor(private device: 'cpu' | 'wasm' = 'wasm') {}
  async status(): Promise<SpeechStatus> {
    const sizes = await cachedFileSizes();
    const bytes = SPEECH_MODEL.files.reduce((n, file) => n + file.bytes, 0);
    const downloadBytes = SPEECH_MODEL.files.reduce((n, file) => n + (sizes[speechUrl(file.name)] === file.bytes ? 0 : file.bytes), 0);
    return { bytes, downloadBytes, state: this.download ? 'downloading' : this.job ? this.job.phase : this.error ? 'error' : downloadBytes ? 'missing' : 'ready',
      progress: this.download ? this.download.loaded / Math.max(1, this.download.total) : undefined, error: this.error, jobId: this.job?.id };
  }
  async startDownload() {
    if (this.download || this.job) throw new Error('Finish the current speech operation first.');
    const controller = new AbortController(); this.error = undefined;
    this.download = { controller, loaded: 0, total: SPEECH_MODEL.files.reduce((n, f) => n + f.bytes, 0) };
    void this.install(controller).catch((error) => { this.error = controller.signal.aborted ? 'Download stopped. Resume to download the remaining files.' : `Speech download failed: ${errorText(error)}`; }).finally(() => { this.download = null; });
  }
  private async install(controller: AbortController) {
    const sizes = await cachedFileSizes();
    for (const file of SPEECH_MODEL.files) {
      controller.signal.throwIfAborted(); const url = speechUrl(file.name);
      if (sizes[url] === file.bytes) { this.download!.loaded += file.bytes; continue; }
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${file.name}.`);
      const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let received = 0;
      while (true) { const part = await reader.read(); if (part.done) break; chunks.push(part.value); received += part.value.length; this.download!.loaded += part.value.length; if (received > file.bytes) { await reader.cancel(); throw new Error(`Unexpected size for ${file.name}.`); } }
      if (received !== file.bytes) throw new Error(`Incomplete file ${file.name}. Resume the download.`);
      controller.signal.throwIfAborted();
      await modelCache.put(url, new Response(new Blob(chunks), { headers: { 'content-length': String(received) } }));
    }
    // Transformers.js also probes tokenizer_config at main while resolving processors.
    const tokenizerConfig = await modelCache.match(speechUrl('tokenizer_config.json'));
    if (tokenizerConfig) await modelCache.put(`https://huggingface.co/${SPEECH_MODEL.id}/resolve/main/tokenizer_config.json`, tokenizerConfig);
  }
  cancelDownload() { this.download?.controller.abort(); }
  cancel(jobId: string) { if (this.job?.id === jobId) this.job.stop.cancelled = true; }
  async unload() {
    if (this.download || this.job) throw new Error('Finish transcription or stop the speech download before clearing models.');
    await inferenceJob(async () => { await this.loaded?.dispose(); this.loaded = null; });
  }
  async remove() {
    await this.unload();
    for (const file of SPEECH_MODEL.files) await modelCache.delete(speechUrl(file.name));
    await modelCache.delete(`https://huggingface.co/${SPEECH_MODEL.id}/resolve/main/tokenizer_config.json`);
    this.error = undefined;
  }
  async transcribe(jobId: string, pcm: string, language: string, options: SpeechOptions): Promise<SpeechResult> {
    validateSpeechOptions(language, options);
    if (typeof jobId !== 'string' || !jobId || jobId.length > 100) throw new Error('Invalid speech session.');
    if (this.job || this.download) throw new Error('Finish the current speech operation first.');
    const audio = decodeSpeech(pcm);
    if (audio.length < SPEECH_RATE / 4) throw new Error('Record at least a quarter of a second.');
    if (!hasAudibleSignal(audio)) throw new Error('No audible speech found. Check the microphone or choose another recording.');
    const job = { id: jobId, stop: new CancelSpeech(), phase: 'loading' as 'loading' | 'transcribing' };
    this.job = job; this.error = undefined;
    try {
      if ((await this.status()).downloadBytes) throw new Error('Download the speech model before transcribing.');
      const transcript = await inferenceJob(async () => {
        if (job.stop.cancelled) throw new Error('Transcription cancelled.');
        this.loaded ??= await loadSpeech(this.device);
        if (job.stop.cancelled) throw new Error('Transcription cancelled.');
        job.phase = 'transcribing';
        const result = await this.loaded(audio, { ...(language === 'auto' ? {} : { language }), task: 'transcribe', chunk_length_s: 30, stride_length_s: 5,
          return_timestamps: true, max_new_tokens: 440, do_sample: false, stopping_criteria: [job.stop] });
        if (job.stop.cancelled) throw new Error('Transcription cancelled.');
        if (!result.text.trim()) throw new Error('No speech was recognized. Try a clearer recording.');
        // Use acoustic gaps only at existing sentence boundaries; avoid inventing paragraphs mid-sentence.
        const raw = result.text.trim();
        return { raw, formattedSource: result.chunks?.length ? speechParagraphs(raw, result.chunks) : raw };
      });
      return { ...transcript, ...cleanTranscript(options.format ? transcript.formattedSource : transcript.raw, language, options), seconds: audio.length / SPEECH_RATE, language };
    } finally { if (this.job === job) this.job = null; }
  }
}
