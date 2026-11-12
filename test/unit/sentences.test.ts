import { describe, expect, it } from 'vitest';
import { countWords, sentenceAt, splitSentences, tokenizeWords } from '../../src/shared/sentences';
import { diffWords } from '../../src/shared/diff';

const texts = (s: string) => splitSentences(s).map((x) => x.text);

describe('splitSentences', () => {
  it('splits on terminators followed by a capital', () => {
    expect(texts('Hello there. How are you? Fine!')).toEqual(['Hello there.', 'How are you?', 'Fine!']);
  });

  it('returns offsets that slice back to the sentence', () => {
    const text = '  First one.   Second one here.\nThird.';
    for (const s of splitSentences(text)) expect(text.slice(s.start, s.end)).toBe(s.text);
  });

  it('does not split after titles and common abbreviations', () => {
    expect(texts('Dr. Smith met Mr. Jones at St. Mary. They talked.')).toEqual(['Dr. Smith met Mr. Jones at St. Mary.', 'They talked.']);
    expect(texts('We need fruit, e.g. apples, i.e. the red ones. Buy some.')).toHaveLength(2);
    expect(texts('Bring pens, paper, etc. for the class.')).toHaveLength(1);
  });

  it('splits after U.S. only when a new sentence clearly starts', () => {
    expect(texts('He moved to the U.S. in 2010 and stayed.')).toHaveLength(1);
    expect(texts('He moved to the U.S. Then he moved back.')).toHaveLength(2);
  });

  it('keeps decimals, versions and domains together', () => {
    expect(texts('Pi is about 3.14 and e is 2.71. Both are irrational.')).toHaveLength(2);
    expect(texts('Visit example.com for v2.0 details.')).toHaveLength(1);
  });

  it('handles ellipses', () => {
    expect(texts('I waited... and then it happened. Done.')).toEqual(['I waited... and then it happened.', 'Done.']);
    expect(texts('I waited... Nothing came.')).toHaveLength(2);
  });

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(texts('She said, "Stop." Then she left.')).toEqual(['She said, "Stop."', 'Then she left.']);
    expect(texts('It worked (finally!) Then we left.')[0]).toBe('It worked (finally!)');
  });

  it('treats newlines as boundaries and handles initials', () => {
    expect(texts('A heading\nBody text here.\n\nNext paragraph.')).toEqual(['A heading', 'Body text here.', 'Next paragraph.']);
    expect(texts('J. K. Rowling wrote it. I read it.')).toHaveLength(2);
  });

  it('handles empty and terminator-free input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n ')).toEqual([]);
    expect(texts('no punctuation at all')).toEqual(['no punctuation at all']);
    expect(texts('Really?! Yes.')).toEqual(['Really?!', 'Yes.']);
  });
});

describe('helpers', () => {
  it('finds the sentence at an offset', () => {
    const text = 'One here. Two there. Three.';
    expect(sentenceAt(text, 12)?.text).toBe('Two there.');
    expect(sentenceAt('', 0)).toBeNull();
  });

  it('counts and tokenizes words', () => {
    expect(countWords("Don't over-think it, okay?")).toBe(4);
    expect(countWords('')).toBe(0);
    expect(tokenizeWords('Hi, you!').map((t) => [t.text, t.start, t.end])).toEqual([['Hi', 0, 2], ['you', 4, 7]]);
  });
});

describe('diffWords', () => {
  it('marks added and removed words', () => {
    const parts = diffWords('due to the fact that it rained', 'because it rained');
    expect(parts.filter((p) => p.type === 'add').map((p) => p.text.trim())).toEqual(['because']);
    expect(parts.filter((p) => p.type === 'del').map((p) => p.text).join('')).toContain('due');
    expect(parts.filter((p) => p.type !== 'del').map((p) => p.text).join('')).toBe('because it rained');
    expect(parts.filter((p) => p.type !== 'add').map((p) => p.text).join('')).toBe('due to the fact that it rained');
  });

  it('returns one unchanged part for identical text', () => {
    expect(diffWords('same text', 'same text')).toEqual([{ type: 'same', text: 'same text' }]);
  });
});
