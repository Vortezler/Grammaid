import { describe, expect, it } from 'vitest';
import { burstiness, detect, mattr, openerScores, pplScore, smooth } from '../../src/background/detector';
import { DETECTOR } from '../../src/background/detector-config';
import { meanLogProbFromLogits, type LanguageModel } from '../../src/background/model';
import { countWords, splitSentences } from '../../src/shared/sentences';

/** A fake model whose perplexity for each sentence is decided by the test. */
function fakeModel(perplexity: (sentence: string, index: number) => number): LanguageModel {
  return {
    async scoreSentences(sentences) {
      return sentences.map((s, i) => {
        const ppl = perplexity(s, i);
        return { perplexity: ppl, meanLogProb: -Math.log(ppl), tokens: Number.isNaN(ppl) ? 2 : 12 };
      });
    },
    async rephrase() {
      return [];
    },
    status: () => ({ gpt2: 'ready', t5: 'ready' }),
  };
}

// Twelve plain sentences of equal length: no stock phrases, no repeated openers.
const SUBJECTS = ['Maria', 'Kenji', 'Our', 'Several', 'Nobody', 'Last', 'Under', 'Before', 'Tomorrow', 'Because', 'Quietly', 'Two'];
const TEXT = SUBJECTS.map((s) => `${s} neighbors carried nine heavy boxes across that muddy yard.`).join(' ');

describe('pplScore', () => {
  it('is monotonic: lower perplexity gives a higher score', () => {
    const values = [5, 20, 45, 85, 150, 400, 2000].map((p) => pplScore(p));
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]);
  });

  it('is 0.5 at the configured midpoint and bounded', () => {
    expect(pplScore(DETECTOR.pplMidpoint)).toBeCloseTo(0.5, 10);
    expect(pplScore(1)).toBeLessThanOrEqual(1);
    expect(pplScore(1e9)).toBeGreaterThanOrEqual(0);
  });
});

describe('detect', () => {
  it('refuses text under the minimum word count', async () => {
    const r = await detect('Far too short to judge.', fakeModel(() => 10), 100);
    expect(r).toEqual({ tooShort: true, words: 5, minWords: 100 });
  });

  it('flags everything when every sentence is highly predictable', async () => {
    const r = await detect(TEXT, fakeModel(() => 8), 50);
    if (r.tooShort) throw new Error('unexpected');
    expect(r.percent).toBe(100);
    expect(r.label).toBe('Likely AI');
    expect(r.sentences.every((s) => s.band === 'flagged')).toBe(true);
  });

  it('flags nothing when every sentence is surprising', async () => {
    const r = await detect(TEXT, fakeModel(() => 900), 50);
    if (r.tooShort) throw new Error('unexpected');
    expect(r.percent).toBe(0);
    expect(r.label).toBe('Likely human');
  });

  it('headline percent equals flagged words over all words', async () => {
    // First half predictable, second half surprising.
    const r = await detect(TEXT, fakeModel((_, i) => (i < 6 ? 6 : 1500)), 50);
    if (r.tooShort) throw new Error('unexpected');
    const flagged = r.sentences.filter((s) => s.band === 'flagged').reduce((a, s) => a + s.words, 0);
    expect(flagged).toBeGreaterThan(0);
    expect(flagged).toBeLessThan(r.words);
    expect(r.percent).toBe(Math.round((flagged / countWords(TEXT)) * 100));
    expect(r.label).toBe('Mixed');
  });

  it('a lower-perplexity text never scores below a higher-perplexity one', async () => {
    let last = 101;
    for (const ppl of [5, 30, 60, 85, 120, 300]) {
      const r = await detect(TEXT, fakeModel(() => ppl), 50);
      if (r.tooShort) throw new Error('unexpected');
      expect(r.percent).toBeLessThanOrEqual(last);
      last = r.percent;
    }
  });

  it('skips sentences too short to score', async () => {
    const text = `${TEXT} Yes.`;
    const r = await detect(text, fakeModel((s) => (s === 'Yes.' ? NaN : 8)), 50);
    if (r.tooShort) throw new Error('unexpected');
    const last = r.sentences[r.sentences.length - 1];
    expect(last.band).toBe('skipped');
    expect(r.percent).toBe(Math.round(((r.words - 1) / r.words) * 100));
  });

  it('stock phrases and repeated openers raise a borderline sentence', async () => {
    const plain = SUBJECTS.map((s) => `${s} neighbors carried nine heavy boxes across that muddy yard.`).join(' ');
    const stocky = SUBJECTS.map(() => 'Moreover, it is important to note that this plays a crucial role in the tapestry.').join(' ');
    const borderline = DETECTOR.pplMidpoint * 0.75;
    const a = await detect(plain, fakeModel(() => borderline), 50);
    const b = await detect(stocky, fakeModel(() => borderline), 50);
    if (a.tooShort || b.tooShort) throw new Error('unexpected');
    expect(b.sentences[3].score).toBeGreaterThan(a.sentences[3].score);
    expect(b.signals.find((s) => s.name === 'Stock phrases')?.direction).toBe('up');
    expect(b.signals.find((s) => s.name === 'Repeated openers')?.direction).toBe('up');
  });

  it('reports sentence offsets that match the input', async () => {
    const r = await detect(TEXT, fakeModel(() => 50), 50);
    if (r.tooShort) throw new Error('unexpected');
    expect(r.sentences).toHaveLength(splitSentences(TEXT).length);
    for (const s of r.sentences) expect(TEXT.slice(s.start, s.end)).toBe(s.text);
  });
});

describe('supporting metrics', () => {
  it('mattr is 1 for all-distinct words and low for repetition', () => {
    expect(mattr('one two three four five')).toBe(1);
    expect(mattr(Array(200).fill('same').join(' '))).toBeCloseTo(1 / 50, 5);
    expect(mattr('')).toBe(0);
  });

  it('openerScores measures repeated first words in the window', () => {
    expect(openerScores(['The a.', 'The b.', 'The c.'])).toEqual([1, 1, 1]);
    expect(openerScores(['One a.', 'Two b.', 'Three c.'])).toEqual([0, 0, 0]);
    expect(openerScores(['Solo.'])).toEqual([0]);
  });

  it('burstiness is 0 for uniform text and grows with variation', () => {
    expect(burstiness([3, 3, 3, 3], [10, 10, 10, 10])).toBe(0);
    const varied = burstiness([2, 5, 3, 6], [3, 30, 8, 22]);
    expect(varied).toBeGreaterThan(0.5);
    expect(varied).toBeLessThanOrEqual(1);
  });

  it('smooth averages neighbours and leaves gaps alone', () => {
    expect(smooth([1, 1, 1])).toEqual([1, 1, 1]);
    const out = smooth([0, 1, 0]);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[0]).toBeCloseTo(1 / 3);
    expect(smooth([1, null, 0])).toEqual([1, null, 0]);
  });
});

describe('meanLogProbFromLogits', () => {
  it('computes the mean log-probability of the actual next tokens', () => {
    // vocab of 2; two prediction steps for ids [0, 1, 0]
    const logits = new Float32Array([0, 0, /* step 0: uniform */ Math.log(3), 0 /* step 1: p(0) = 0.75 */]);
    const expected = (Math.log(0.5) + Math.log(0.75)) / 2;
    expect(meanLogProbFromLogits(logits, 2, [0, 1, 0])).toBeCloseTo(expected, 5);
  });
});
