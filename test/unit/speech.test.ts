import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanTranscript, DEFAULT_SPEECH_OPTIONS, decodeSpeech, encodeSpeech, hasAudibleSignal, MAX_SPEECH_SECONDS, SPEECH_RATE, speechParagraphs, validateSpeechOptions } from '../../src/shared/speech';
import { LocalSpeech } from '../../src/background/speech';
import { Blob as NodeBlob } from 'node:buffer';

const mocks = vi.hoisted(() => ({ cache: new Map<string, string>(), infer: vi.fn(), dispose: vi.fn(), load: vi.fn() }));
vi.mock('../../src/background/model-cache', () => ({
  cachedFileSizes: async () => Object.fromEntries([...mocks.cache].map(([key, text]) => [key, text.length])),
  modelCache: { match: async (key: string) => mocks.cache.has(key) ? new Response(mocks.cache.get(key)) : undefined,
    put: async (key: string, response: Response) => { mocks.cache.set(key, await response.text()); }, delete: async (key: string) => mocks.cache.delete(key) },
}));
vi.mock('../../src/data/speech-model.json', async (original) => {
  const data = await original<{ default: { files: { name: string; bytes: number }[] } }>();
  return { default: { ...data.default, files: data.default.files.map((file) => ({ ...file, bytes: 2 })) } };
});
vi.mock('@huggingface/transformers', async (original) => ({ ...await original<typeof import('@huggingface/transformers')>(),
  AutoTokenizer: { from_pretrained: vi.fn(async () => ({})) }, AutoProcessor: { from_pretrained: vi.fn(async () => ({})) },
  AutoModelForSpeechSeq2Seq: { from_pretrained: mocks.load }, AutomaticSpeechRecognitionPipeline: class { constructor() { return Object.assign(mocks.infer, { dispose: mocks.dispose }); } },
}));
const audio = () => encodeSpeech(new Float32Array(8000).map((_, i) => Math.sin(i / 12) * .2));
beforeEach(() => {
  mocks.cache.clear(); mocks.infer.mockReset(); mocks.load.mockReset(); mocks.dispose.mockReset();
  mocks.infer.mockResolvedValue({ text: 'um, i, uh, agree. do you?', chunks: [{ text: 'um, i, uh, agree.', timestamp: [0, 2] }, { text: 'do you?', timestamp: [4, 5] }] });
  mocks.load.mockResolvedValue(Object.assign(mocks.infer, { dispose: mocks.dispose }));
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
});
afterEach(() => vi.unstubAllGlobals());
async function installed() {
  const engine = new LocalSpeech(); await engine.startDownload();
  await vi.waitFor(async () => expect((await engine.status()).state).toBe('ready'));
  return engine;
}
describe('speech cleanup', () => {
  it('removes standalone hesitations, polishes casing, and preserves questions', () => {
    expect(cleanTranscript('umm, i, uh, agree. do you?', 'en', DEFAULT_SPEECH_OPTIONS)).toEqual({ text: 'I agree. Do you?', removedFillers: 2 });
    expect(cleanTranscript('Um. hello world', 'en', DEFAULT_SPEECH_OPTIONS).text).toBe('Hello world.');
  });
  it('leaves vocabulary, profanity and quoted slurs uncensored', () => {
    expect(cleanTranscript('um, they quoted "faggot", uh, and said fuck.', 'en', DEFAULT_SPEECH_OPTIONS).text).toBe('They quoted "faggot" and said fuck.');
    expect(cleanTranscript('human umbrella like you know', 'en', DEFAULT_SPEECH_OPTIONS).text).toBe('Human umbrella like you know.');
  });
  it('does not remove ordinary words in other languages or auto-detected speech', () => {
    expect(cleanTranscript('um livro', 'pt', DEFAULT_SPEECH_OPTIONS).text).toBe('Um livro.');
    expect(cleanTranscript('um livro', 'auto', DEFAULT_SPEECH_OPTIONS).removedFillers).toBe(0);
    expect(cleanTranscript('नमस्ते', 'hi', DEFAULT_SPEECH_OPTIONS).text).toBe('नमस्ते।');
    expect(cleanTranscript('你好', 'zh', DEFAULT_SPEECH_OPTIONS).text).toBe('你好。');
  });
  it('allows cleanup to be disabled and keeps the original unchanged', () => {
    const raw = '  um, i agree  ';
    expect(cleanTranscript(raw, 'en', { format: false, removeFillers: false })).toEqual({ text: 'um, i agree', removedFillers: 0 });
    expect(raw).toBe('  um, i agree  ');
  });
  it('cleans consecutive hesitations and paragraph starts while preserving uh-huh and uh-oh', () => {
    expect(cleanTranscript('um, umm, uh, hello.\n\nUm, yes', 'en', DEFAULT_SPEECH_OPTIONS)).toEqual({ text: 'Hello.\n\nYes.', removedFillers: 4 });
    expect(cleanTranscript('uh-huh, uh-oh, uh huh, uh oh', 'en', DEFAULT_SPEECH_OPTIONS).removedFillers).toBe(0);
  });
  it('preserves original words and CJK spacing when adding acoustic paragraphs', () => {
    expect(speechParagraphs('你好。世界。', [{ text: '你好。', timestamp: [0, 1] }, { text: '世界。', timestamp: [3, 4] }])).toBe('你好。\n\n世界。');
    expect(speechParagraphs('你好世界', [{ text: '你好', timestamp: [0, 1] }, { text: '世界', timestamp: [3, 4] }])).toBe('你好世界');
    expect(speechParagraphs('Keep all of this.', [{ text: 'Metadata mismatch', timestamp: [3, 4] }])).toBe('Keep all of this.');
  });
});
describe('speech PCM transport and validation', () => {
  it('round trips audio through portable PCM with finite, bounded samples', () => {
    const values = new Float32Array([-2, -1, -.3, 0, .4, 1, 2]); const decoded = decodeSpeech(encodeSpeech(values));
    values.forEach((value, i) => expect(decoded[i]).toBeCloseTo(Math.max(-1, Math.min(1, value)), 3));
  });
  it('rejects malformed, empty, nonfinite, excessive and unsupported input', () => {
    expect(() => decodeSpeech('!bad')).toThrow(); expect(() => decodeSpeech('YQ==')).toThrow();
    expect(() => encodeSpeech(new Float32Array())).toThrow(); expect(() => encodeSpeech(new Float32Array([NaN]))).toThrow();
    expect(() => encodeSpeech(new Float32Array(SPEECH_RATE * MAX_SPEECH_SECONDS + 1))).toThrow();
    expect(() => validateSpeechOptions('bodo', DEFAULT_SPEECH_OPTIONS)).toThrow();
  });
  it('rejects silence without pretending to be full voice-activity detection', () => {
    expect(hasAudibleSignal(new Float32Array(8000))).toBe(false); expect(hasAudibleSignal(decodeSpeech(audio()))).toBe(true);
  });
});
describe('local speech model', () => {
  it('downloads only on request and loads inference strictly from cache', async () => {
    const missing = new LocalSpeech(); expect((await missing.status()).state).toBe('missing'); expect(fetch).not.toHaveBeenCalled();
    await expect(missing.transcribe('missing', audio(), 'en', DEFAULT_SPEECH_OPTIONS)).rejects.toThrow('Download');
    const engine = await installed(); vi.mocked(fetch).mockClear();
    const result = await engine.transcribe('one', audio(), 'en', DEFAULT_SPEECH_OPTIONS);
    expect(mocks.load).toHaveBeenCalledWith('onnx-community/whisper-base', expect.objectContaining({ local_files_only: true, device: 'wasm', dtype: 'q8', revision: expect.stringMatching(/^[a-f0-9]{40}$/) }));
    expect(mocks.infer).toHaveBeenCalledWith(expect.any(Float32Array), expect.objectContaining({ language: 'en', task: 'transcribe', chunk_length_s: 30 }));
    expect(result.raw).toBe('um, i, uh, agree. do you?'); expect(result.text).toBe('I agree.\n\nDo you?');
    expect(fetch).not.toHaveBeenCalled();
    await engine.transcribe('two', audio(), 'en', DEFAULT_SPEECH_OPTIONS); expect(mocks.load).toHaveBeenCalledTimes(1);
    await engine.remove(); expect((await engine.status()).state).toBe('missing'); expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
  it('does not accept incomplete downloads as installed', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('x'));
    const engine = new LocalSpeech(); await engine.startDownload();
    await vi.waitFor(async () => expect((await engine.status()).state).toBe('error'));
    expect((await engine.status()).downloadBytes).toBeGreaterThan(0); expect(mocks.load).not.toHaveBeenCalled();
  });
  it('supports cancellation by session and rejects overlapping work without losing the owner', async () => {
    const engine = await installed(); let finish!: () => void;
    mocks.infer.mockImplementation(async (_audio, options) => { await new Promise<void>((resolve) => { finish = resolve; }); options.stopping_criteria[0]._call([[1]]); return { text: 'Finished.' }; });
    const run = engine.transcribe('owner', audio(), 'en', DEFAULT_SPEECH_OPTIONS); const rejected = expect(run).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(finish).toBeDefined());
    await expect(engine.transcribe('second', audio(), 'en', DEFAULT_SPEECH_OPTIONS)).rejects.toThrow('Finish');
    await expect(engine.remove()).rejects.toThrow('Finish');
    engine.cancel('wrong'); expect((await engine.status()).jobId).toBe('owner'); engine.cancel('owner'); finish(); await rejected;
    expect((await engine.status()).state).toBe('ready');
  });
  it('never runs the model on silent audio', async () => {
    const engine = await installed();
    await expect(engine.transcribe('silent', encodeSpeech(new Float32Array(8000)), 'en', DEFAULT_SPEECH_OPTIONS)).rejects.toThrow('audible');
    expect(mocks.infer).not.toHaveBeenCalled();
  });
});
