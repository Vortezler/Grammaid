// Context-aware synonyms: WordNet candidates, inflected to match the original word, then ranked
// by how natural the whole sentence reads with each substitution (scored by the language model).
import nlp from 'compromise';
import type { SynonymResponse, SynonymResult } from '../shared/types';
import type { LanguageModel } from './model';

export type Pos = 'n' | 'v' | 'a' | 'r';
export interface Sense {
  synonyms: string[];
  gloss: string;
}
export type Lexicon = Record<string, Partial<Record<Pos, Sense[]>>>;

export type Form =
  | { pos: 'v'; lemma: string; form: 'Infinitive' | 'PastTense' | 'PresentTense' | 'Gerund' | 'Participle' }
  | { pos: 'n'; lemma: string; plural: boolean }
  | { pos: 'a'; lemma: string; degree: 'base' | 'Comparative' | 'Superlative' }
  | { pos: 'r'; lemma: string };

export interface Candidate {
  word: string;
  gloss: string;
  sentence: string;
  /** Characters before the word that must also be replaced (an "a"/"an" fix), if any. */
  before?: { length: number; text: string };
}

const MAX_CANDIDATES = 30;
const MAX_RESULTS = 8;
/** Candidates scoring more than this many nats per token below the original are dropped. */
const MAX_DROP = 1.5;

interface Term {
  text: string;
  tags: string[];
  offset: { start: number; length: number };
}

type VerbTable = Partial<Record<'Infinitive' | 'PastTense' | 'PresentTense' | 'Gerund' | 'Participle', string>>;
type AdjTable = Partial<Record<'Adjective' | 'Comparative' | 'Superlative', string>>;

const lower = (s: string) => s.toLowerCase();

type Doc = ReturnType<typeof nlp>;
/** compromise's tag() is typed as returning the base View; it is still the full document. */
const tagged = (text: string, tag: string) => nlp(text).tag(tag) as Doc;

function conjugate(infinitive: string): VerbTable {
  try {
    return (tagged(infinitive, 'Verb').verbs().conjugate()[0] as VerbTable | undefined) ?? {};
  } catch {
    return {};
  }
}

function adjectiveTable(word: string): AdjTable {
  try {
    return (tagged(word, 'Adjective').adjectives().conjugate()[0] as AdjTable | undefined) ?? {};
  } catch {
    return {};
  }
}

/** Works out the part of speech, lemma and inflection of `word` as used at `wordStart` in `sentence`. */
export function analyzeWord(sentence: string, word: string, wordStart: number): Form {
  const w = lower(word);
  let tags: string[] = [];
  try {
    const json = nlp(sentence).json({ offset: true }) as { terms: Term[] }[];
    const terms = json.flatMap((s) => s.terms);
    const term =
      terms.find((t) => t.offset.start <= wordStart && wordStart < t.offset.start + Math.max(1, t.offset.length)) ??
      terms.find((t) => lower(t.text) === w);
    tags = term?.tags ?? [];
  } catch {
    tags = [];
  }
  const has = (t: string) => tags.includes(t);

  if (has('Verb') && !has('Copula') && !has('Auxiliary') && !has('Modal')) {
    const table = (tagged(w, 'Verb').verbs().conjugate()[0] as VerbTable | undefined) ?? {};
    const lemma = lower(table.Infinitive ?? w);
    const form = has('Gerund')
      ? 'Gerund'
      : has('Participle')
        ? 'Participle'
        : has('PastTense')
          ? 'PastTense'
          : has('Infinitive')
            ? 'Infinitive'
            : lower(table.PresentTense ?? '') === w && lemma !== w
              ? 'PresentTense'
              : lower(table.Gerund ?? '') === w
                ? 'Gerund'
                : lower(table.PastTense ?? '') === w
                  ? 'PastTense'
                  : 'Infinitive';
    return { pos: 'v', lemma, form };
  }
  if (has('Adjective')) {
    const table = adjectiveTable(w);
    const degree = has('Comparative') ? 'Comparative' : has('Superlative') ? 'Superlative' : 'base';
    return { pos: 'a', lemma: degree === 'base' ? w : lower(table.Adjective ?? w), degree };
  }
  if (has('Adverb')) return { pos: 'r', lemma: w };
  if (has('Noun') || tags.length === 0) {
    const plural = has('Plural');
    let lemma = w;
    if (plural) {
      try {
        lemma = lower(tagged(w, 'Plural').nouns().toSingular().text()) || w;
      } catch {
        lemma = w;
      }
    }
    return { pos: 'n', lemma, plural };
  }
  return { pos: 'n', lemma: w, plural: false };
}

/** Puts a base-form synonym into the same inflection as the original word. */
export function inflect(candidate: string, form: Form): string {
  switch (form.pos) {
    case 'v': {
      if (form.form === 'Infinitive') return candidate;
      const table = conjugate(candidate);
      if (form.form === 'Participle') return table.Participle ?? table.PastTense ?? candidate;
      return table[form.form] ?? candidate;
    }
    case 'n': {
      if (!form.plural) return candidate;
      try {
        return tagged(candidate, 'Noun').nouns().toPlural().text() || candidate;
      } catch {
        return candidate;
      }
    }
    case 'a': {
      if (form.degree === 'base') return candidate;
      // Long adjectives take "more"/"most" rather than -er/-est.
      const syllables = (candidate.match(/[aeiouy]+/g) ?? []).length;
      if (syllables >= 3 || candidate.includes('-') || /(?:ful|less|ous|ive|ing|ed|ant|ent|al|ic)$/.test(candidate)) {
        return `${form.degree === 'Comparative' ? 'more' : 'most'} ${candidate}`;
      }
      return adjectiveTable(candidate)[form.degree] ?? candidate;
    }
    default:
      return candidate;
  }
}

const AN_EXCEPTIONS = /^(?:hour|honest|honor|honour|heir|herb)/i;
const A_EXCEPTIONS = /^(?:uni(?!n|m)|use|usu|uti|euro|eu|one\b|once|ubiq|u[bcfklrst][aeiou])/i;

export function articleFor(word: string): 'a' | 'an' {
  if (AN_EXCEPTIONS.test(word)) return 'an';
  if (A_EXCEPTIONS.test(word)) return 'a';
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

const matchCase = (original: string, replacement: string) =>
  original.length > 1 && original === original.toUpperCase()
    ? replacement.toUpperCase()
    : /^[A-Z]/.test(original)
      ? replacement[0].toUpperCase() + replacement.slice(1)
      : replacement;

/** Substitutes `replacement` for the word and corrects a preceding "a"/"an" if needed. */
export function substitute(
  sentence: string,
  wordStart: number,
  wordLength: number,
  replacement: string,
): { sentence: string; before?: { length: number; text: string } } {
  const head = sentence.slice(0, wordStart);
  const tail = sentence.slice(wordStart + wordLength);
  const m = /(^|[^A-Za-z])(an?)(\s+)$/i.exec(head);
  if (m) {
    const article = m[2];
    const wanted = articleFor(replacement);
    if (article.toLowerCase() !== wanted) {
      const fixed = matchCase(article, wanted);
      const oldChunk = article + m[3];
      const newChunk = fixed + m[3];
      return {
        sentence: head.slice(0, head.length - oldChunk.length) + newChunk + replacement + tail,
        before: { length: oldChunk.length, text: newChunk },
      };
    }
  }
  return { sentence: head + replacement + tail };
}

function sensesFor(lexicon: Lexicon, form: Form, word: string): Sense[] {
  const tries: [string, Pos][] = [
    [form.lemma, form.pos],
    [lower(word), form.pos],
  ];
  // The tagger can be wrong; fall back to any part of speech WordNet knows for this word.
  for (const pos of ['a', 'v', 'n', 'r'] as Pos[]) {
    tries.push([form.lemma, pos], [lower(word), pos]);
  }
  for (const [lemma, pos] of tries) {
    const senses = lexicon[lemma]?.[pos];
    if (senses?.length) return senses;
  }
  return [];
}

/** Candidate substitutions in WordNet order (most common sense first), before any ranking. */
export function generateCandidates(lexicon: Lexicon, sentence: string, word: string, wordStart: number): Candidate[] {
  const form = analyzeWord(sentence, word, wordStart);
  const senses = sensesFor(lexicon, form, word);
  const multiword = /\s/.test(word.trim());
  const seen = new Set<string>([lower(word)]);
  const out: Candidate[] = [];
  // Round-robin across senses so every meaning gets a chance within the candidate limit.
  const depth = Math.max(0, ...senses.map((s) => s.synonyms.length));
  for (let i = 0; i < depth && out.length < MAX_CANDIDATES; i++) {
    for (const sense of senses) {
      const base = sense.synonyms[i];
      if (!base || out.length >= MAX_CANDIDATES) continue;
      if (!multiword && /\s/.test(base)) continue;
      // Hyphenated compounds ("life-and-death") score deceptively well with the model and rarely fit.
      if (base.includes('-') && !word.includes('-')) continue;
      const inflected = matchCase(word, inflect(base, form));
      if (seen.has(lower(inflected))) continue;
      seen.add(lower(inflected));
      const sub = substitute(sentence, wordStart, word.length, inflected);
      out.push({ word: inflected, gloss: sense.gloss, sentence: sub.sentence, before: sub.before });
    }
  }
  return out;
}

export async function findSynonyms(
  lexicon: Lexicon,
  model: LanguageModel | null,
  sentence: string,
  word: string,
  wordStart: number,
): Promise<SynonymResponse> {
  const candidates = generateCandidates(lexicon, sentence, word, wordStart);
  const plain = (c: Candidate, score: number): SynonymResult => ({ word: c.word, gloss: c.gloss, score, before: c.before });
  if (candidates.length === 0) return { original: word, results: [], ranked: true };
  if (!model) return { original: word, results: candidates.slice(0, MAX_RESULTS).map((c) => plain(c, 0)), ranked: false };

  let scores;
  try {
    scores = await model.scoreSentences([sentence, ...candidates.map((c) => c.sentence)]);
  } catch (e) {
    return {
      original: word,
      results: candidates.slice(0, MAX_RESULTS).map((c) => plain(c, 0)),
      ranked: false,
      modelError: e instanceof Error ? e.message : String(e),
    };
  }
  const base = scores[0].meanLogProb;
  const ranked = candidates
    .map((c, i) => ({ c, score: scores[i + 1].meanLogProb }))
    // A sentence too short to score (NaN) cannot be ranked; keep those in WordNet order at the end.
    .filter((x) => Number.isNaN(x.score) || Number.isNaN(base) || x.score >= base - MAX_DROP)
    .sort((a, b) => (Number.isNaN(b.score) ? -Infinity : b.score) - (Number.isNaN(a.score) ? -Infinity : a.score));
  return {
    original: word,
    results: ranked.slice(0, MAX_RESULTS).map((x) => plain(x.c, Number.isNaN(x.score) ? 0 : x.score)),
    ranked: !Number.isNaN(base),
  };
}
