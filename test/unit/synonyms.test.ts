import { describe, expect, it } from 'vitest';
import { analyzeWord, articleFor, findSynonyms, generateCandidates, inflect, substitute, type Lexicon } from '../../src/background/synonyms';
import { deterministicOptions, filterCandidates, hasRepeatedNgram, rephraseText } from '../../src/background/rephrase';
import { codePointMapper } from '../../src/background/harper';
import type { LanguageModel } from '../../src/background/model';

const LEXICON: Lexicon = {
  run: { v: [{ synonyms: ['sprint', 'jog', 'dash'], gloss: 'move fast on foot' }, { synonyms: ['operate'], gloss: 'direct or control' }] },
  important: { a: [{ synonyms: ['significant', 'crucial', 'big'], gloss: 'of great significance' }] },
  big: { a: [{ synonyms: ['large', 'enormous'], gloss: 'above average in size' }] },
  dog: { n: [{ synonyms: ['hound', 'canine'], gloss: 'a domesticated animal' }] },
  idea: { n: [{ synonyms: ['thought', 'opinion', 'notion'], gloss: 'the content of cognition' }] },
  quickly: { r: [{ synonyms: ['rapidly', 'speedily'], gloss: 'with speed' }] },
  car: { n: [{ synonyms: ['auto', 'motor vehicle', 'automobile'], gloss: 'a motor vehicle' }] },
};

/** Fake model: a sentence scores higher the more of the `liked` words it contains. */
function fakeModel(liked: Record<string, number>, base = -4): LanguageModel {
  return {
    async scoreSentences(sentences) {
      return sentences.map((s) => {
        let score = base;
        for (const [word, bonus] of Object.entries(liked)) if (s.includes(word)) score += bonus;
        return { meanLogProb: score, perplexity: Math.exp(-score), tokens: 10 };
      });
    },
    async rephrase() {
      return [];
    },
    status: () => ({ gpt2: 'ready', t5: 'ready' }),
  };
}

const at = (sentence: string, word: string) => [sentence, word, sentence.indexOf(word)] as const;

describe('analyzeWord', () => {
  it('finds the lemma and form of verbs', () => {
    expect(analyzeWord(...at('She was running to the store.', 'running'))).toEqual({ pos: 'v', lemma: 'run', form: 'Gerund' });
    expect(analyzeWord(...at('They walked home.', 'walked'))).toMatchObject({ pos: 'v', lemma: 'walk', form: 'PastTense' });
    expect(analyzeWord(...at('He runs every day.', 'runs'))).toMatchObject({ pos: 'v', lemma: 'run', form: 'PresentTense' });
  });

  it('recognizes plural nouns, adjectives and adverbs', () => {
    expect(analyzeWord(...at('The dogs barked.', 'dogs'))).toEqual({ pos: 'n', lemma: 'dog', plural: true });
    expect(analyzeWord(...at('It was an important day.', 'important'))).toEqual({ pos: 'a', lemma: 'important', degree: 'base' });
    expect(analyzeWord(...at('They quickly walked home.', 'quickly'))).toEqual({ pos: 'r', lemma: 'quickly' });
    expect(analyzeWord(...at('This one is bigger.', 'bigger'))).toMatchObject({ pos: 'a', lemma: 'big', degree: 'Comparative' });
  });
});

describe('inflect', () => {
  it('matches verb tense', () => {
    expect(inflect('sprint', { pos: 'v', lemma: 'run', form: 'Gerund' })).toBe('sprinting');
    expect(inflect('jog', { pos: 'v', lemma: 'run', form: 'Gerund' })).toBe('jogging');
    expect(inflect('sprint', { pos: 'v', lemma: 'run', form: 'PastTense' })).toBe('sprinted');
    expect(inflect('carry', { pos: 'v', lemma: 'run', form: 'PresentTense' })).toBe('carries');
    expect(inflect('sprint', { pos: 'v', lemma: 'run', form: 'Infinitive' })).toBe('sprint');
  });

  it('matches noun number', () => {
    expect(inflect('hound', { pos: 'n', lemma: 'dog', plural: true })).toBe('hounds');
    expect(inflect('city', { pos: 'n', lemma: 'town', plural: true })).toBe('cities');
    expect(inflect('hound', { pos: 'n', lemma: 'dog', plural: false })).toBe('hound');
  });

  it('matches adjective degree, using "more" for long adjectives', () => {
    expect(inflect('large', { pos: 'a', lemma: 'big', degree: 'Comparative' })).toBe('larger');
    expect(inflect('enormous', { pos: 'a', lemma: 'big', degree: 'Comparative' })).toBe('more enormous');
    expect(inflect('enormous', { pos: 'a', lemma: 'big', degree: 'Superlative' })).toBe('most enormous');
  });
});

describe('a/an handling', () => {
  it('chooses the article by sound', () => {
    expect(articleFor('apple')).toBe('an');
    expect(articleFor('banana')).toBe('a');
    expect(articleFor('hour')).toBe('an');
    expect(articleFor('honest')).toBe('an');
    expect(articleFor('university')).toBe('a');
    expect(articleFor('one-off')).toBe('a');
    expect(articleFor('umbrella')).toBe('an');
  });

  it('fixes the article before a substituted word and reports the extra range', () => {
    const s = 'It was an important day.';
    const out = substitute(s, s.indexOf('important'), 9, 'crucial');
    expect(out.sentence).toBe('It was a crucial day.');
    expect(out.before).toEqual({ length: 3, text: 'a ' });
    const back = substitute('She had a big idea.', 10, 3, 'enormous');
    expect(back.sentence).toBe('She had an enormous idea.');
    expect(back.before).toEqual({ length: 2, text: 'an ' });
  });

  it('keeps capitalization of the article and leaves correct articles alone', () => {
    expect(substitute('An important day.', 3, 9, 'big').sentence).toBe('A big day.');
    expect(substitute('It was an important day.', 10, 9, 'essential')).toEqual({ sentence: 'It was an essential day.' });
    expect(substitute('The banana fell.', 4, 6, 'apple').sentence).toBe('The apple fell.');
  });
});

describe('generateCandidates', () => {
  it('inflects candidates to the form of the original ("running" -> "sprinting")', () => {
    const words = generateCandidates(LEXICON, ...at('She was running to the store.', 'running')).map((c) => c.word);
    expect(words).toContain('sprinting');
    expect(words).toContain('jogging');
    expect(words).not.toContain('sprint');
  });

  it('builds full substituted sentences with article fixes', () => {
    const c = generateCandidates(LEXICON, ...at('It was an important day.', 'important'));
    expect(c.find((x) => x.word === 'crucial')?.sentence).toBe('It was a crucial day.');
    expect(c.find((x) => x.word === 'significant')?.before).toEqual({ length: 3, text: 'a ' });
  });

  it('pluralizes nouns, keeps capitalization, and drops multi-word synonyms', () => {
    expect(generateCandidates(LEXICON, ...at('The dogs barked.', 'dogs')).map((c) => c.word)).toEqual(['hounds', 'canines']);
    expect(generateCandidates(LEXICON, ...at('Dogs bark.', 'Dogs')).map((c) => c.word)).toContain('Hounds');
    expect(generateCandidates(LEXICON, ...at('My car broke down.', 'car')).map((c) => c.word)).toEqual(['auto', 'automobile']);
  });

  it('returns nothing for unknown words', () => {
    expect(generateCandidates(LEXICON, ...at('The zxqv fell.', 'zxqv'))).toEqual([]);
  });
});

describe('findSynonyms', () => {
  const sentence = 'She had a good idea.';

  it('ranks by sentence score and drops candidates far below the original', async () => {
    const model = fakeModel({ notion: 1, thought: 0.5, opinion: -2 });
    const r = await findSynonyms(LEXICON, model, ...at(sentence, 'idea'));
    expect(r.ranked).toBe(true);
    expect(r.results.map((x) => x.word)).toEqual(['notion', 'thought']);
    expect(r.results[0].gloss).toBe('the content of cognition');
  });

  it('falls back to dictionary order when the model fails or is absent', async () => {
    const broken: LanguageModel = { ...fakeModel({}), scoreSentences: async () => Promise.reject(new Error('offline')) };
    const r = await findSynonyms(LEXICON, broken, ...at(sentence, 'idea'));
    expect(r.ranked).toBe(false);
    expect(r.modelError).toBe('offline');
    expect(r.results.map((x) => x.word)).toEqual(['thought', 'opinion', 'notion']);
    expect((await findSynonyms(LEXICON, null, ...at(sentence, 'idea'))).ranked).toBe(false);
  });

  it('returns an empty list for words with no synonyms', async () => {
    expect((await findSynonyms(LEXICON, fakeModel({}), ...at('The zxqv fell.', 'zxqv'))).results).toEqual([]);
  });
});

describe('rephrase', () => {
  it('detects repeated n-grams', () => {
    expect(hasRepeatedNgram('the cat sat on the mat and the cat sat down')).toBe(true);
    expect(hasRepeatedNgram('the cat sat on the mat')).toBe(false);
  });

  it('filters identical, duplicate, looping and badly sized candidates', () => {
    const original = 'We made the decision to stay at home today.';
    const kept = filterCandidates(original, [
      'We made the decision to stay at home today!',
      'We decided to stay at home today.',
      'we decided to stay at home today',
      'Stay.',
      'We decided to stay home and we decided to stay home and that was that for us all.',
      'We decided that we would stay at home today.',
    ]);
    expect(kept).toEqual(['We decided to stay at home today.', 'We decided that we would stay at home today.']);
  });

  it('always offers deterministic options, even with no model', async () => {
    const text = 'In order to win, the plan was approved by the board.';
    const r = await rephraseText(null, text);
    expect(r.options.map((o) => o.source)).toEqual(['tighten', 'active-hint']);
    expect(r.options[0].text).toBe('To win, the plan was approved by the board.');
    expect(deterministicOptions('We won.')).toEqual([]);
  });

  it('ranks model rewrites by fluency, caps them at three, and reports model errors', async () => {
    const model: LanguageModel = {
      ...fakeModel({ best: 2, good: 1 }),
      rephrase: async () => ['An okay rewrite of the thing.', 'The best rewrite of the thing.', 'A good rewrite of the thing.', 'One more rewrite of the thing.'],
    };
    const r = await rephraseText(model, 'Some original sentence about the thing.');
    expect(r.options.filter((o) => o.source === 'model').map((o) => o.text)).toEqual([
      'The best rewrite of the thing.',
      'A good rewrite of the thing.',
      'An okay rewrite of the thing.',
    ]);
    const failing: LanguageModel = { ...fakeModel({}), rephrase: async () => Promise.reject(new Error('no network')) };
    const f = await rephraseText(failing, 'In order to win we must try harder.');
    expect(f.modelError).toBe('no network');
    expect(f.options.map((o) => o.source)).toEqual(['tighten']);
  });
});

describe('codePointMapper', () => {
  it('converts code-point offsets to UTF-16 offsets', () => {
    const text = 'ok 😀 teh';
    const map = codePointMapper(text);
    expect(text.slice(map(5), map(8))).toBe('teh');
    expect(codePointMapper('plain')(3)).toBe(3);
  });
});
