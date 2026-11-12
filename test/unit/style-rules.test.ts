import { describe, expect, it } from 'vitest';
import { activeVoiceHint, passiveSpans, runStyleRules, tighten } from '../../src/background/style-rules';
import { filterIssues, LintPipeline, resolveOverlaps } from '../../src/background/lint';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { Issue } from '../../src/shared/types';

const rules = (text: string, rule: string) => runStyleRules(text).filter((i) => i.rule === rule);
const apply = (text: string, issue: Issue, n = 0) => text.slice(0, issue.start) + issue.suggestions[n] + text.slice(issue.end);

describe('wordy phrases', () => {
  it('flags and fixes a wordy phrase', () => {
    const text = 'We left early in order to catch the train.';
    const [issue] = rules(text, 'Wordy phrase');
    expect(text.slice(issue.start, issue.end)).toBe('in order to');
    expect(apply(text, issue)).toBe('We left early to catch the train.');
  });

  it('keeps the capital letter at the start of a sentence', () => {
    const text = 'Due to the fact that it rained, we stayed in.';
    expect(apply(text, rules(text, 'Wordy phrase')[0])).toBe('Because it rained, we stayed in.');
  });

  it('removes filler phrases and re-capitalizes the next word', () => {
    const text = 'It is important to note that the results vary.';
    expect(apply(text, rules(text, 'Wordy phrase')[0])).toBe('The results vary.');
  });

  it('matches curly apostrophes and extra spaces, but not inside other words', () => {
    expect(rules('In today’s  world we rush.', 'Wordy phrase')).toHaveLength(1);
    expect(rules('The reutilized part worked.', 'Wordy phrase')).toHaveLength(0);
    expect(rules('A short, plain sentence.', 'Wordy phrase')).toHaveLength(0);
  });
});

describe('redundant pairs', () => {
  it('suggests the single word', () => {
    const text = 'The end result was a free gift.';
    const found = rules(text, 'Redundant pair');
    expect(found.map((i) => i.suggestions[0])).toEqual(['result', 'gift']);
  });

  it('ignores ordinary text', () => {
    expect(rules('The result was a gift.', 'Redundant pair')).toHaveLength(0);
  });
});

describe('weak intensifiers', () => {
  it('offers the sentence without the intensifier', () => {
    const text = 'That was a very good idea.';
    const [issue] = rules(text, 'Weak intensifier');
    expect(apply(text, issue)).toBe('That was a good idea.');
  });

  it('does not flag an intensifier with nothing after it', () => {
    expect(rules('Not really.', 'Weak intensifier')).toHaveLength(0);
    expect(rules('The delivery arrived.', 'Weak intensifier')).toHaveLength(0);
  });
});

describe('hedging', () => {
  it('flags hedges without offering a replacement', () => {
    const found = rules('I think that this is kind of a problem.', 'Hedging');
    expect(found).toHaveLength(2);
    expect(found[0].suggestions).toEqual([]);
  });

  it('leaves direct statements alone', () => {
    expect(rules('This is a problem.', 'Hedging')).toHaveLength(0);
  });
});

describe('passive voice', () => {
  it('finds passive verb phrases', () => {
    const text = 'The ball was thrown by John.';
    const [issue] = rules(text, 'Passive voice');
    expect(text.slice(issue.start, issue.end)).toBe('was thrown');
  });

  it('does not flag active or merely descriptive sentences', () => {
    expect(passiveSpans('John threw the ball.')).toEqual([]);
    expect(passiveSpans('She is running quickly.')).toEqual([]);
    expect(passiveSpans('I was tired.')).toEqual([]);
  });

  it('gives an active-voice hint only when there is passive voice', () => {
    expect(activeVoiceHint('Mistakes were made.')).toContain('were made');
    expect(activeVoiceHint('We made mistakes.')).toBeNull();
  });
});

describe('repeated words', () => {
  it('flags the same word within three tokens', () => {
    const text = 'The project needs a project plan.';
    const [issue] = rules(text, 'Repeated word');
    expect(text.slice(issue.start, issue.end)).toBe('project');
    expect(issue.start).toBe(text.lastIndexOf('project'));
  });

  it('ignores "that", "had", short function words and distant repeats', () => {
    expect(rules('He said that that was fine.', 'Repeated word')).toHaveLength(0);
    expect(rules('She had had enough.', 'Repeated word')).toHaveLength(0);
    expect(rules('We went to the shop to buy milk.', 'Repeated word')).toHaveLength(0);
    expect(rules('The project started well, and months later another project began.', 'Repeated word')).toHaveLength(0);
  });
});

describe('long sentences', () => {
  it('flags sentences over 35 words only', () => {
    const long = Array.from({ length: 36 }, (_, i) => `word${i}`).join(' ') + '.';
    const short = Array.from({ length: 35 }, (_, i) => `Word${i}`).join(' ') + '.';
    expect(rules(long, 'Long sentence')).toHaveLength(1);
    expect(rules(short, 'Long sentence')).toHaveLength(0);
    expect(rules(`${short} ${short}`, 'Long sentence')).toHaveLength(0);
  });
});

describe('tighten', () => {
  it('applies every wordy and redundant fix', () => {
    expect(tighten('In order to win, we must plan ahead at this point in time.')).toBe('To win, we must plan now.');
  });

  it('returns unchanged text when there is nothing to fix', () => {
    expect(tighten('We must plan now.')).toBe('We must plan now.');
  });
});

describe('lint pipeline', () => {
  const issue = (start: number, end: number, kind: Issue['kind']): Issue => ({ start, end, kind, message: '', suggestions: [], rule: kind });

  it('prefers spelling over grammar over style when issues overlap', () => {
    const out = resolveOverlaps([issue(0, 10, 'style'), issue(2, 5, 'grammar'), issue(3, 4, 'spelling'), issue(20, 25, 'style')]);
    expect(out.map((i) => i.kind)).toEqual(['spelling', 'style']);
  });

  it('sorts by position and drops empty ranges', () => {
    const out = resolveOverlaps([issue(9, 12, 'style'), issue(5, 5, 'grammar'), issue(0, 3, 'grammar')]);
    expect(out.map((i) => i.start)).toEqual([0, 9]);
  });

  it('filters by category and by the user dictionary', () => {
    const text = 'Grammaid rocks';
    const list = [issue(0, 8, 'spelling'), issue(9, 14, 'style')];
    expect(filterIssues(list, text, { ...DEFAULT_SETTINGS, userDictionary: ['grammaid'] }).map((i) => i.kind)).toEqual(['style']);
    expect(
      filterIssues(list, text, { ...DEFAULT_SETTINGS, categories: { spelling: true, grammar: true, style: false } }).map((i) => i.kind),
    ).toEqual(['spelling']);
  });

  it('merges engine and style issues, caches by text, and caps the cache', async () => {
    let calls = 0;
    const pipeline = new LintPipeline(
      async () => {
        calls++;
        return [issue(0, 4, 'spelling')];
      },
      async () => DEFAULT_SETTINGS,
    );
    const first = await pipeline.lint('Thsi is very good.');
    expect(first.map((i) => i.kind)).toEqual(['spelling', 'style']);
    await pipeline.lint('Thsi is very good.');
    expect(calls).toBe(1);
    for (let i = 0; i < 25; i++) await pipeline.lint(`Text number ${i}.`);
    await pipeline.lint('Thsi is very good.');
    expect(calls).toBe(27);
    expect(await pipeline.lint('   ')).toEqual([]);
  });
});
