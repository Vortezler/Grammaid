import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATION_LANGUAGES, TRANSLATION_MODELS, MAX_TRANSLATION_CHARS, modelUrl, packModels, translationPlan, validateTranslation } from '../../src/shared/translation';
import { LocalTranslator, marianIds, translationChunks } from '../../src/background/translation';
import { Blob as NodeBlob } from 'node:buffer';

const cache = vi.hoisted(() => new Map<string, string>());
vi.mock('../../src/background/model-cache', () => ({
  cachedFileSizes: async () => Object.fromEntries([...cache].map(([url, text]) => [url, text.length])),
  modelCache: {
    match: async (url: string) => cache.has(url) ? new Response(cache.get(url), { headers: { 'content-length': String(cache.get(url)!.length) } }) : undefined,
    put: async (url: string, response: Response) => { cache.set(url, await response.text()); },
    delete: async (url: string) => cache.delete(url),
  },
}));
vi.mock('../../src/data/translation-models.json', async (original) => {
  const data = await original<{ default: Record<string, { revision: string; files: { name: string; bytes: number }[] }> }>();
  return { default: Object.fromEntries(Object.entries(data.default).map(([id, model]) => [id, { ...model, files: model.files.map((file) => ({ ...file, bytes: 2 })) }])) };
});

beforeEach(() => {
  cache.clear();
  vi.stubGlobal('Blob', NodeBlob);
  const storage: Record<string, unknown> = {};
  vi.stubGlobal('browser', { storage: { local: { get: async (key: string) => ({ [key]: storage[key] }), set: async (values: Record<string, unknown>) => { Object.assign(storage, values); } } } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
});
afterEach(() => vi.unstubAllGlobals());

describe('local translation routes', () => {
  it('inserts the actual multilingual language ID instead of encoding the visible tag as text', () => {
    const encode = vi.fn(() => [7, 8, 0]);
    const tokenizer = { encode, get_vocab: () => new Map([['>>tam<<', 42]]) };
    expect(marianIds('Hello', '>>tam<< ', tokenizer)).toEqual([42, 7, 8, 0]);
    expect(encode).toHaveBeenCalledWith('Hello');
    expect(() => marianIds('Hello', '>>unknown<< ', tokenizer)).toThrow('target-language token');
  });
  it('covers all 22 Indian languages and every language pair with pinned model files', () => {
    expect(TRANSLATION_LANGUAGES.filter((l) => l.group === 'India')).toHaveLength(22);
    for (const source of TRANSLATION_LANGUAGES) for (const target of TRANSLATION_LANGUAGES) {
      const plan = translationPlan(source.code, target.code);
      expect(plan.length).toBeLessThanOrEqual(2);
      for (const step of plan) {
        expect(TRANSLATION_MODELS[step.model].files.length).toBeGreaterThan(0);
        expect(modelUrl(step.model, 'config.json')).toMatch(/^https:\/\/huggingface.co\/.+\/resolve\/[0-9a-f]{40}\/config.json$/);
      }
    }
  });
  it('routes missing OPUS tokens through native-script IndicTrans instead of inventing language tags', () => {
    for (const code of ['bodo', 'doi', 'ks', 'gom', 'mni-Mtei', 'ne', 'sat'] as const) {
      expect(translationPlan('en', code)[0].indic).toBeDefined();
      expect(translationPlan(code, 'en')[0].indic).toBeDefined();
    }
    expect(translationPlan('en', 'zh-TW')[0].prefix).toBe('>>cmn_Hant<< ');
    expect(translationPlan('en', 'ko')[0].nllb?.target).toBe('kor_Hang');
    expect(translationPlan('es', 'hi').map((s) => [s.source, s.target])).toEqual([['es', 'en'], ['en', 'hi']]);
  });
  it('rejects invalid input and splits long text without dropping Unicode or newlines', () => {
    expect(() => validateTranslation('', 'en', 'hi')).toThrow();
    expect(() => validateTranslation('x'.repeat(MAX_TRANSLATION_CHARS + 1), 'en', 'hi')).toThrow();
    expect(() => validateTranslation('hello', 'auto', 'hi')).toThrow();
    const text = 'Hello नमस्ते 你好 👩🏽‍💻.\n'.repeat(20);
    const chunks = translationChunks(text, (s) => Array.from(s).length, 25);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every((s) => Array.from(s).length <= 25)).toBe(true);
  });
});

describe('language pack lifecycle', () => {
  it('starts with no downloads and refuses translation until packs are installed', async () => {
    const engine = new LocalTranslator();
    expect((await engine.status()).filter((p) => p.state === 'ready').map((p) => p.language)).toEqual(['en']);
    await expect(engine.translate('Private words', 'en', 'es')).rejects.toThrow('Download the Spanish pack');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('downloads only a selected pack and preserves shared files until the last pack is removed', async () => {
    const engine = new LocalTranslator();
    await engine.startDownload('gu');
    await vi.waitFor(async () => expect((await engine.status()).find((p) => p.language === 'gu')?.state).toBe('ready'));
    const downloaded = vi.mocked(fetch).mock.calls.length;
    expect(downloaded).toBe(packModels('gu').flatMap((id) => TRANSLATION_MODELS[id].files).length);
    await engine.startDownload('ta');
    await vi.waitFor(async () => expect((await engine.status()).find((p) => p.language === 'ta')?.state).toBe('ready'));
    expect(vi.mocked(fetch).mock.calls).toHaveLength(downloaded);
    await engine.remove('gu');
    expect((await engine.status()).find((p) => p.language === 'ta')?.state).toBe('ready');
    await engine.remove('ta'); expect(cache.size).toBe(0);
    for (const call of vi.mocked(fetch).mock.calls) expect(String(call[0])).not.toContain('Private words');
  });
  it('handles download errors without marking a partial pack ready, then retries', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const engine = new LocalTranslator();
    await engine.startDownload('es');
    await vi.waitFor(async () => expect((await engine.status()).find((p) => p.language === 'es')?.state).toBe('error'));
    await engine.startDownload('es');
    await vi.waitFor(async () => expect((await engine.status()).find((p) => p.language === 'es')?.state).toBe('ready'));
    const restarted = new LocalTranslator();
    expect((await restarted.status()).find((p) => p.language === 'es')?.state).toBe('ready');
    cache.clear();
    expect((await restarted.status()).find((p) => p.language === 'es')?.state).toBe('missing');
  });
});
