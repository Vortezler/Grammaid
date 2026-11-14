import { describe, expect, it } from 'vitest';
import { MAX_TRANSLATION_CHARS, TRANSLATION_LANGUAGES, translationPlan, translationUrl } from '../../src/shared/translation';

describe('translation website handoff', () => {
  it('covers all 22 scheduled Indian languages and the requested world languages without duplicate codes', () => {
    expect(TRANSLATION_LANGUAGES.filter((l) => l.group === 'India').map((l) => l.name)).toEqual([
      'Assamese', 'Bengali', 'Bodo', 'Dogri', 'Gujarati', 'Hindi', 'Kannada', 'Kashmiri', 'Konkani', 'Maithili', 'Malayalam',
      'Manipuri (Meitei)', 'Marathi', 'Nepali', 'Odia', 'Punjabi', 'Sanskrit', 'Santali (Ol Chiki)', 'Sindhi', 'Tamil', 'Telugu', 'Urdu',
    ]);
    expect(new Set(TRANSLATION_LANGUAGES.map((l) => l.code)).size).toBe(TRANSLATION_LANGUAGES.length);
  });

  it('preserves multilingual text, punctuation, newlines, and URL-like input as data', () => {
    const text = 'Hello & नमस्ते + 你好\n#tl=ru ?text=日本語 https://example.com';
    const url = new URL(translationUrl(text, 'auto', 'hi'));
    expect(url.origin).toBe('https://translate.google.com');
    expect(url.searchParams.get('text')).toBe(text);
    expect(url.searchParams.get('sl')).toBe('auto');
    expect(url.searchParams.get('tl')).toBe('hi');
  });

  it('uses Bing and its actual language codes for Bodo and Kashmiri', () => {
    const bodo = new URL(translationUrl('Hello', 'en', 'bodo'));
    expect(bodo.origin).toBe('https://www.bing.com');
    expect(bodo.searchParams.get('to')).toBe('brx');
    const konkani = new URL(translationUrl('Text', 'ks', 'gom'));
    expect(konkani.searchParams.get('from')).toBe('ks');
    expect(konkani.searchParams.get('to')).toBe('kok');
    expect(new URL(translationUrl('Text', 'auto', 'ks')).searchParams.get('from')).toBe('auto-detect');
  });

  it('offers a valid direct route or two supported English steps for every language pair', () => {
    let bridgeCount = 0;
    for (const source of TRANSLATION_LANGUAGES) for (const target of TRANSLATION_LANGUAGES) {
      const plan = translationPlan(source.code, target.code);
      if (plan.bridge) {
        bridgeCount++;
        expect(() => translationUrl('text', source.code, target.code)).toThrow('two steps');
        expect(() => translationUrl('text', source.code, 'en')).not.toThrow();
        expect(() => translationUrl('text', 'en', target.code)).not.toThrow();
      } else {
        expect(() => translationUrl('text', source.code, target.code)).not.toThrow();
      }
    }
    expect(bridgeCount).toBe(8);
  });

  it('rejects empty, oversized, malformed, and unsupported input before opening a website', () => {
    expect(() => translationUrl('  ', 'en', 'hi')).toThrow('Enter some text');
    expect(() => translationUrl('x'.repeat(MAX_TRANSLATION_CHARS + 1), 'en', 'hi')).toThrow('5,000');
    expect(() => translationUrl('x'.repeat(MAX_TRANSLATION_CHARS), 'en', 'hi')).not.toThrow();
    // Runtime messages can be malformed despite the TypeScript contract.
    expect(() => translationUrl(null as never, 'en', 'hi')).toThrow('Enter some text');
    expect(() => translationUrl('text', 'zz' as never, 'hi')).toThrow('source language');
    expect(() => translationUrl('text', 'en', 'auto' as never)).toThrow('target language');
  });
});
