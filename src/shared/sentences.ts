// Regex-free sentence splitter with offsets. Written by hand rather than using Intl.Segmenter,
// which older Waterfox builds may not ship.

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'inc', 'ltd', 'co', 'corp',
  'gen', 'col', 'lt', 'sgt', 'capt', 'rev', 'hon', 'gov', 'sen', 'rep', 'fig', 'no', 'vol',
  'approx', 'dept', 'est', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept',
  'oct', 'nov', 'dec', 'mt', 'ft', 'al', 'cf', 'ed', 'eds', 'pp', 'p',
]);
// Abbreviations that contain internal periods; matched against the token ending at the period.
const DOTTED = new Set(['e.g', 'i.e', 'u.s', 'u.k', 'a.m', 'p.m', 'ph.d', 'u.s.a', 'u.n', 'd.c']);
// Dotted abbreviations that commonly end a sentence, so a following capital does start a new one.
const DOTTED_CAN_END = new Set(['u.s', 'u.k', 'a.m', 'p.m', 'u.s.a', 'u.n', 'd.c', 'ph.d']);

const CLOSERS = '"\'”’)]}»';
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ';
const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();
const isDigit = (c: string) => c >= '0' && c <= '9';
const isLetter = (c: string) => c.toLowerCase() !== c.toUpperCase();

/** Token (run of non-space chars) ending just before index `i`, lowercased, leading punctuation stripped. */
function tokenBefore(text: string, i: number): string {
  let s = i;
  while (s > 0 && !isSpace(text[s - 1])) s--;
  return text
    .slice(s, i)
    .toLowerCase()
    .replace(/^[("'“‘[]+/, '');
}

function isBoundary(text: string, i: number): { end: number } | null {
  const c = text[i];
  if (c !== '.' && c !== '!' && c !== '?' && c !== '…') return null;

  // Swallow runs of terminators ("?!", "...") and closing quotes/brackets.
  let end = i + 1;
  while (end < text.length && '.!?…'.includes(text[end])) end++;
  const multi = end - i > 1;
  while (end < text.length && CLOSERS.includes(text[end])) end++;

  if (end >= text.length) return { end };
  if (!isSpace(text[end])) return null; // "3.14", "example.com", "e.g."

  let next = end;
  while (next < text.length && isSpace(text[next])) next++;
  if (next >= text.length) return { end };
  // Skip opening quotes/brackets to find the first real character of the next sentence.
  let first = next;
  while (first < text.length && '"\'“‘([{«'.includes(text[first])) first++;
  const nextChar = text[first] ?? '';

  if (c === '.' && !multi) {
    const token = tokenBefore(text, i);
    if (ABBREVIATIONS.has(token)) return null;
    if (DOTTED.has(token)) {
      if (!(DOTTED_CAN_END.has(token) && isUpper(nextChar))) return null;
      return { end };
    }
    // Single-letter initials: "J. K. Rowling".
    if (token.length === 1 && isLetter(token) && isUpper(text[i - 1])) return null;
  }
  // An ellipsis followed by a lowercase word continues the sentence.
  if (multi && (c === '.' || c === '…') && nextChar && isLetter(nextChar) && !isUpper(nextChar)) return null;
  if (c === '.' && !multi && nextChar && isLetter(nextChar) && !isUpper(nextChar)) return null;
  if (!nextChar) return { end };
  return isUpper(nextChar) || isDigit(nextChar) || !isLetter(nextChar) ? { end } : null;
}

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;

  const push = (from: number, to: number) => {
    let s = from;
    let e = to;
    while (s < e && isSpace(text[s])) s++;
    while (e > s && isSpace(text[e - 1])) e--;
    if (e > s) out.push({ text: text.slice(s, e), start: s, end: e });
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') {
      // A blank line, or a newline after a line with no terminator (heading, list item), ends a sentence.
      let j = i;
      let newlines = 0;
      while (j < text.length && isSpace(text[j])) {
        if (text[j] === '\n') newlines++;
        j++;
      }
      if (newlines >= 2 || newlines === 1) {
        push(start, i);
        start = j;
        i = j;
        continue;
      }
    }
    const b = isBoundary(text, i);
    if (b) {
      push(start, b.end);
      start = b.end;
      i = b.end;
      continue;
    }
    i++;
  }
  push(start, text.length);
  return out;
}

/** Sentence containing the given offset (or the nearest one). */
export function sentenceAt(text: string, offset: number): Sentence | null {
  const all = splitSentences(text);
  if (all.length === 0) return null;
  for (const s of all) if (offset >= s.start && offset <= s.end) return s;
  let best = all[0];
  for (const s of all) if (Math.abs(s.start - offset) < Math.abs(best.start - offset)) best = s;
  return best;
}

export function countWords(text: string): number {
  const m = text.match(/[A-Za-z0-9À-ɏ]+(?:['’-][A-Za-z0-9À-ɏ]+)*/g);
  return m ? m.length : 0;
}

export interface WordToken {
  text: string;
  start: number;
  end: number;
}

export function tokenizeWords(text: string): WordToken[] {
  const out: WordToken[] = [];
  const re = /[A-Za-z0-9À-ɏ]+(?:['’-][A-Za-z0-9À-ɏ]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}
