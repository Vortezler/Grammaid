// AI-likelihood estimate from local signals only. Approximate by design: it cannot reproduce
// Turnitin and can misjudge formal or non-native writing. The UI says so wherever it shows a result.
import type { DetectResult, SentenceBand, SentenceScore, SignalNote } from '../shared/types';
import { splitSentences, countWords, tokenizeWords } from '../shared/sentences';
import type { LanguageModel } from './model';
import { DETECTOR, type DetectorConfig } from './detector-config';
import stock from '../data/stock-ai-phrases.json';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const listRegex = (items: string[]) =>
  new RegExp(
    `(?<![A-Za-z0-9-])(?:${[...items]
      .sort((a, b) => b.length - a.length)
      .map((p) => escapeRe(p).replace(/'/g, "['’]").replace(/ /g, '\\s+'))
      .join('|')})(?![A-Za-z0-9-])`,
    'gi',
  );
const phraseRe = listRegex(stock.phrases);
const transitionRe = listRegex(stock.transitions);

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const countMatches = (re: RegExp, text: string) => (text.match(re) ?? []).length;

/** Low perplexity (predictable text) maps towards 1, high perplexity towards 0. */
export function pplScore(perplexity: number, cfg: DetectorConfig = DETECTOR): number {
  return sigmoid(cfg.pplSlope * (Math.log(cfg.pplMidpoint) - Math.log(perplexity)));
}

/** Moving-average type-token ratio: lexical diversity that does not depend on text length. */
export function mattr(text: string, window: number = DETECTOR.mattrWindow): number {
  const words = tokenizeWords(text).map((w) => w.text.toLowerCase());
  if (words.length === 0) return 0;
  if (words.length <= window) return new Set(words).size / words.length;
  const counts = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < words.length; i++) {
    counts.set(words[i], (counts.get(words[i]) ?? 0) + 1);
    if (i >= window) {
      const old = words[i - window];
      const c = (counts.get(old) ?? 1) - 1;
      if (c <= 0) counts.delete(old);
      else counts.set(old, c);
    }
    if (i >= window - 1) total += counts.size / window;
  }
  return total / (words.length - window + 1);
}

const firstWord = (sentence: string) => tokenizeWords(sentence)[0]?.text.toLowerCase() ?? '';

/** How often each sentence's first word repeats among its neighbours (0 to 1). */
export function openerScores(sentences: string[], radius: number = DETECTOR.openerRadius): number[] {
  const openers = sentences.map(firstWord);
  return openers.map((word, i) => {
    if (!word) return 0;
    let same = 0;
    let others = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(openers.length - 1, i + radius); j++) {
      if (j === i) continue;
      others++;
      if (openers[j] === word) same++;
    }
    return others ? same / others : 0;
  });
}

export function burstiness(logPerplexities: number[], sentenceLengths: number[], cfg: DetectorConfig = DETECTOR): number {
  const pplPart = Math.min(1, std(logPerplexities) / cfg.burstStdRef);
  const m = mean(sentenceLengths);
  const lenPart = m > 0 ? Math.min(1, std(sentenceLengths) / m / cfg.burstCvRef) : 0;
  return (pplPart + lenPart) / 2;
}

export function smooth(scores: (number | null)[], weights: readonly [number, number, number] = DETECTOR.smooth): (number | null)[] {
  return scores.map((cur, i) => {
    if (cur === null) return null;
    let total = cur * weights[1];
    let weight = weights[1];
    const prev = scores[i - 1];
    const next = scores[i + 1];
    if (prev !== null && prev !== undefined) {
      total += prev * weights[0];
      weight += weights[0];
    }
    if (next !== null && next !== undefined) {
      total += next * weights[2];
      weight += weights[2];
    }
    return total / weight;
  });
}

export async function detect(
  text: string,
  model: LanguageModel,
  minWords: number,
  cfg: DetectorConfig = DETECTOR,
): Promise<DetectResult> {
  const words = countWords(text);
  if (words < minWords) return { tooShort: true, words, minWords };

  const sentences = splitSentences(text);
  const scored = await model.scoreSentences(sentences.map((s) => s.text));
  const openers = openerScores(sentences.map((s) => s.text), cfg.openerRadius);

  const raw: (number | null)[] = sentences.map((s, i) => {
    const ppl = scored[i].perplexity;
    if (!Number.isFinite(ppl)) return null; // too short to score: left out of every aggregate
    const phrase = Math.min(1, countMatches(phraseRe, s.text) * cfg.phraseStep);
    return cfg.wPpl * pplScore(ppl, cfg) + cfg.wPhrase * phrase + cfg.wOpener * openers[i];
  });
  const smoothed = smooth(raw, cfg.smooth);

  const valid = sentences.map((_, i) => i).filter((i) => smoothed[i] !== null);
  const logPpl = valid.map((i) => Math.log(scored[i].perplexity));
  const lengths = valid.map((i) => countWords(sentences[i].text));
  const burst = burstiness(logPpl, lengths, cfg);
  const threshold =
    cfg.threshold + (burst < cfg.burstinessLow ? -cfg.thresholdShift : burst > cfg.burstinessHigh ? cfg.thresholdShift : 0);

  let flaggedWords = 0;
  const out: SentenceScore[] = sentences.map((s, i) => {
    const score = smoothed[i];
    const w = countWords(s.text);
    let band: SentenceBand = 'skipped';
    if (score !== null) {
      band = score >= threshold ? 'flagged' : score >= threshold - cfg.uncertainBand ? 'uncertain' : 'ok';
      if (band === 'flagged') flaggedWords += w;
    }
    return { text: s.text, start: s.start, end: s.end, words: w, perplexity: scored[i].perplexity, score: score ?? 0, band };
  });

  const percent = words > 0 ? Math.round((flaggedWords / words) * 100) : 0;
  const label = percent < cfg.labelHuman ? 'Likely human' : percent > cfg.labelAi ? 'Likely AI' : 'Mixed';

  // Supporting metrics, each with a plain-language note about which way it pushed.
  const meanPpl = logPpl.length ? Math.exp(mean(logPpl)) : NaN;
  const diversity = mattr(text, cfg.mattrWindow);
  const phrasePer100 = (countMatches(phraseRe, text) / words) * 100;
  const transitionPer100 = (countMatches(transitionRe, text) / words) * 100;
  const openerMean = mean(valid.map((i) => openers[i]));
  const dir = (up: boolean, down: boolean): SignalNote['direction'] => (up ? 'up' : down ? 'down' : 'neutral');

  const signals: SignalNote[] = [
    {
      name: 'Predictability',
      value: Number.isFinite(meanPpl) ? `perplexity ${meanPpl.toFixed(0)}` : 'n/a',
      direction: dir(meanPpl < cfg.pplMidpoint * 0.85, meanPpl > cfg.pplMidpoint * 1.25),
      detail:
        meanPpl < cfg.pplMidpoint * 0.85
          ? 'The wording is very predictable to a language model, which is typical of AI text.'
          : meanPpl > cfg.pplMidpoint * 1.25
            ? 'The wording is hard for a language model to predict, which is typical of human writing.'
            : 'Word choice is neither unusually predictable nor unusually surprising.',
    },
    {
      name: 'Burstiness',
      value: burst.toFixed(2),
      direction: dir(burst < cfg.burstinessLow, burst > cfg.burstinessHigh),
      detail:
        burst < cfg.burstinessLow
          ? 'Sentences are uniform in length and rhythm. AI text tends to be this even.'
          : burst > cfg.burstinessHigh
            ? 'Sentence length and rhythm vary a lot, as human writing usually does.'
            : 'Sentence rhythm varies a moderate amount.',
    },
    {
      name: 'Stock phrases',
      value: `${phrasePer100.toFixed(1)} per 100 words`,
      direction: dir(phrasePer100 >= 1.5, phrasePer100 < 0.4),
      detail:
        phrasePer100 >= 1.5
          ? 'Uses many phrases that AI models overuse ("delve", "plays a crucial role", "a testament to").'
          : 'Few or none of the phrases that AI models overuse.',
    },
    {
      name: 'Transition words',
      value: `${transitionPer100.toFixed(1)} per 100 words`,
      direction: dir(transitionPer100 >= 2.5, transitionPer100 < 0.8),
      detail:
        transitionPer100 >= 2.5
          ? 'Leans heavily on connectors like "moreover" and "furthermore".'
          : 'Connectors like "moreover" and "however" are used sparingly.',
    },
    {
      name: 'Vocabulary variety',
      value: `MATTR ${diversity.toFixed(2)}`,
      direction: dir(diversity < 0.68, diversity > 0.8),
      detail:
        diversity < 0.68
          ? 'The same words recur often within short stretches.'
          : diversity > 0.8
            ? 'Vocabulary is varied from one stretch to the next.'
            : 'Vocabulary variety is in the normal range.',
    },
    {
      name: 'Repeated openers',
      value: `${Math.round(openerMean * 100)}%`,
      direction: dir(openerMean >= 0.25, openerMean < 0.08),
      detail:
        openerMean >= 0.25
          ? 'Neighbouring sentences often start with the same word.'
          : 'Sentences start in different ways.',
    },
  ];

  return { tooShort: false, percent, label, threshold, sentences: out, signals, words };
}
