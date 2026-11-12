// Style checks Harper does not cover. Tables live in src/data so they can grow without code changes.
import nlp from 'compromise';
import type { Issue } from '../shared/types';
import { splitSentences, tokenizeWords, countWords, type Sentence } from '../shared/sentences';
import wordyRaw from '../data/wordy-phrases.json';
import intensifiersRaw from '../data/intensifiers.json';
import hedgesRaw from '../data/hedges.json';
import redundantRaw from '../data/redundant-pairs.json';

const wordy = wordyRaw as Record<string, string[]>;
const redundant = redundantRaw as Record<string, string>;
const intensifiers = intensifiersRaw as string[];
const hedges = hedgesRaw as string[];

export const LONG_SENTENCE_WORDS = 35;
const REPEAT_WINDOW = 3;
const REPEAT_IGNORE = new Set(['that', 'had']);
// Short function words repeat naturally ("to go to", "of the ... of"), so they are not flagged.
const REPEAT_COMMON = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'and', 'or', 'is', 'it', 'on', 'for', 'as', 'at', 'by', 'be',
  'i', 'we', 'he', 'she', 'you', 'they', 'my', 'me', 'so', 'if', 'no', 'not', 'was', 'are', 'with',
  'but', 'his', 'her', 'its', 'our', 'this', 'from', 'were', 'has', 'have', 'do', 'did', 'will',
  'more', 'than', 'who', 'what', 'when', 'up', 'out', 'all', 'one', 'their', 'your', 'can', 'am',
]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const apostrophes = (s: string) => escapeRe(s).replace(/'/g, "['’]");

function phraseRegex(phrases: string[]): RegExp {
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  const body = sorted.map((p) => apostrophes(p).replace(/ /g, '\\s+')).join('|');
  return new RegExp(`(?<![A-Za-z0-9'’-])(?:${body})(?![A-Za-z0-9'’-])`, 'gi');
}

const wordyRe = phraseRegex(Object.keys(wordy));
const redundantRe = phraseRegex(Object.keys(redundant));
const hedgeRe = phraseRegex(hedges);
const intensifierRe = phraseRegex(intensifiers);

const normKey = (s: string) => s.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ');
const isCapitalized = (s: string) => /^[A-Z]/.test(s);
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const matchCase = (original: string, replacement: string) =>
  isCapitalized(original) && original !== original.toUpperCase() ? capitalize(replacement) : replacement;

interface PhraseHit {
  start: number;
  end: number;
  suggestions: string[];
  matched: string;
  removal: boolean;
}

/**
 * Finds a phrase and works out its replacements. When the fix is to delete the phrase, the hit
 * grows to cover the next word so the replacement can carry the sentence's capital letter.
 */
function phraseHits(text: string, re: RegExp, lookup: (key: string) => string[] | undefined): PhraseHit[] {
  const hits: PhraseHit[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const matched = m[0];
    const options = lookup(normKey(matched));
    if (!options) continue;
    const start = m.index;
    let end = start + matched.length;
    const suggestions: string[] = [];
    let removal = false;
    for (const opt of options) {
      if (opt !== '') {
        suggestions.push(matchCase(matched, opt));
        continue;
      }
      const rest = /^[,]?\s+([A-Za-z][A-Za-z'’-]*)/.exec(text.slice(end));
      if (!rest) continue;
      const nextWord = rest[1];
      end += rest[0].length;
      suggestions.push(isCapitalized(matched) && nextWord !== 'I' ? capitalize(nextWord) : nextWord);
      removal = true;
      break; // a deletion changes the range, so it is the only suggestion offered
    }
    if (suggestions.length === 0) continue;
    hits.push({ start, end, suggestions, matched: text.slice(start, end), removal });
  }
  return hits;
}

function wordyIssues(text: string): Issue[] {
  return phraseHits(text, wordyRe, (k) => wordy[k]).map((h) => ({
    start: h.start,
    end: h.end,
    kind: 'style' as const,
    message: h.removal
      ? 'This phrase adds words without adding meaning. Consider removing it.'
      : 'This phrase is wordy. A shorter one says the same thing.',
    suggestions: h.suggestions,
    rule: 'Wordy phrase',
  }));
}

function redundantIssues(text: string): Issue[] {
  return phraseHits(text, redundantRe, (k) => (redundant[k] ? [redundant[k]] : undefined)).map((h) => ({
    start: h.start,
    end: h.end,
    kind: 'style' as const,
    message: 'These words repeat the same idea. One of them is enough.',
    suggestions: h.suggestions,
    rule: 'Redundant pair',
  }));
}

function intensifierIssues(text: string): Issue[] {
  const out: Issue[] = [];
  intensifierRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = intensifierRe.exec(text))) {
    const start = m.index;
    const after = /^\s+([A-Za-z][A-Za-z'’-]*)/.exec(text.slice(start + m[0].length));
    if (!after) continue; // "not really." has nothing to intensify
    const end = start + m[0].length + after[0].length;
    const next = after[1];
    out.push({
      start,
      end,
      kind: 'style',
      message: `"${m[0]}" weakens the word it modifies. Drop it, or pick a stronger word.`,
      suggestions: [isCapitalized(m[0]) && next !== 'I' ? capitalize(next) : next],
      rule: 'Weak intensifier',
    });
  }
  return out;
}

function hedgeIssues(text: string): Issue[] {
  const out: Issue[] = [];
  hedgeRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = hedgeRe.exec(text))) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'style',
      message: 'Hedging makes a claim sound unsure. State it directly if you can stand behind it.',
      suggestions: [],
      rule: 'Hedging',
    });
  }
  return out;
}

const BE_VERB = /\b(?:am|is|are|was|were|be|been|being|get|gets|got|gotten)\b/i;
const passiveCache = new Map<string, { start: number; end: number }[]>();
const PASSIVE_CACHE_MAX = 600;

/** Passive verb phrases in one sentence (offsets relative to the sentence). Cached per sentence. */
export function passiveSpans(sentence: string): { start: number; end: number }[] {
  if (!BE_VERB.test(sentence)) return [];
  const cached = passiveCache.get(sentence);
  if (cached) return cached;
  const spans: { start: number; end: number }[] = [];
  try {
    const verbs = nlp(sentence).verbs().json({ offset: true }) as {
      text: string;
      offset?: { start: number; length: number };
      verb?: { grammar?: { passive?: boolean } };
    }[];
    for (const v of verbs) {
      if (!v.verb?.grammar?.passive || !v.offset) continue;
      const raw = sentence.slice(v.offset.start, v.offset.start + v.offset.length);
      const trimmed = raw.replace(/[\s.,;:!?"'”’)\]]+$/, '');
      if (trimmed) spans.push({ start: v.offset.start, end: v.offset.start + trimmed.length });
    }
  } catch {
    // compromise failing on odd input must never break linting
  }
  if (passiveCache.size >= PASSIVE_CACHE_MAX) {
    const first = passiveCache.keys().next().value;
    if (first !== undefined) passiveCache.delete(first);
  }
  passiveCache.set(sentence, spans);
  return spans;
}

function passiveIssues(sentences: Sentence[]): Issue[] {
  const out: Issue[] = [];
  for (const s of sentences) {
    for (const span of passiveSpans(s.text)) {
      out.push({
        start: s.start + span.start,
        end: s.start + span.end,
        kind: 'style',
        message: 'Passive voice. If it matters who did this, make them the subject of the sentence.',
        suggestions: [],
        rule: 'Passive voice',
      });
    }
  }
  return out;
}

function longSentenceIssues(sentences: Sentence[]): Issue[] {
  const out: Issue[] = [];
  for (const s of sentences) {
    const words = countWords(s.text);
    if (words <= LONG_SENTENCE_WORDS) continue;
    out.push({
      start: s.start,
      end: s.end,
      kind: 'style',
      message: `This sentence has ${words} words. Splitting it in two would make it easier to follow.`,
      suggestions: [],
      rule: 'Long sentence',
    });
  }
  return out;
}

function repeatedWordIssues(sentences: Sentence[]): Issue[] {
  const out: Issue[] = [];
  for (const s of sentences) {
    const tokens = tokenizeWords(s.text);
    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i].text.toLowerCase();
      if (word.length < 4 || REPEAT_IGNORE.has(word) || REPEAT_COMMON.has(word) || /^\d+$/.test(word)) continue;
      for (let j = Math.max(0, i - REPEAT_WINDOW); j < i; j++) {
        if (tokens[j].text.toLowerCase() !== word) continue;
        out.push({
          start: s.start + tokens[i].start,
          end: s.start + tokens[i].end,
          kind: 'style',
          message: `"${tokens[i].text}" appears twice close together. Try a different word or restructure.`,
          suggestions: [],
          rule: 'Repeated word',
        });
        break;
      }
    }
  }
  return out;
}

/** All style issues for a text. Offsets are into `text`. */
export function runStyleRules(text: string): Issue[] {
  const sentences = splitSentences(text);
  return [
    ...wordyIssues(text),
    ...redundantIssues(text),
    ...intensifierIssues(text),
    ...hedgeIssues(text),
    ...passiveIssues(sentences),
    ...repeatedWordIssues(sentences),
    ...longSentenceIssues(sentences),
  ];
}

/** Deterministic rewrite: applies every wordy-phrase and redundant-pair fix. Needs no model. */
export function tighten(text: string): string {
  const hits = [
    ...phraseHits(text, wordyRe, (k) => wordy[k]),
    ...phraseHits(text, redundantRe, (k) => (redundant[k] ? [redundant[k]] : undefined)),
  ].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const h of hits) {
    if (h.start < pos) continue;
    out += text.slice(pos, h.start) + h.suggestions[0];
    pos = h.end;
  }
  return out + text.slice(pos);
}

/** A plain-language nudge for sentences that contain passive verbs; null when there are none. */
export function activeVoiceHint(text: string): string | null {
  const found: string[] = [];
  for (const s of splitSentences(text)) {
    for (const span of passiveSpans(s.text)) found.push(s.text.slice(span.start, span.end));
  }
  if (found.length === 0) return null;
  const list = found.slice(0, 3).map((f) => `"${f}"`).join(', ');
  return `Passive: ${list}. Name who does the action and put them first, e.g. "The committee approved the plan" instead of "The plan was approved".`;
}
