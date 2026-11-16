export const MAX_TYPING_CHARS = 20000;
export interface TypingOptions { wordsPerMinute: number; sentencePauses: boolean; position: 'caret' | 'append' }
export const DEFAULT_TYPING_OPTIONS: TypingOptions = { wordsPerMinute: 45, sentencePauses: true, position: 'caret' };
export interface TypingField { fieldId: string; label: string; kind: 'input' | 'textarea' | 'editor' }
export interface TypingTarget extends TypingField { tabId: number; frameId: number; frame: string }
export interface TypingTab { tabId: number; title: string; host: string; active: boolean }
export interface TypingStatus {
  jobId: string; state: 'idle' | 'starting' | 'typing' | 'paused' | 'done' | 'stopped' | 'error';
  written: number; total: number; sequence: number; message: string; target?: TypingTarget;
}
export type TypingControl = 'pause' | 'resume' | 'stop';
export const IDLE_TYPING: TypingStatus = { jobId: '', state: 'idle', written: 0, total: 0, sequence: 0, message: '' };
export const typingActive = (status: TypingStatus) => ['starting', 'typing', 'paused'].includes(status.state);
export function validateTyping(text: unknown, options: TypingOptions): asserts text is string {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Paste the text you want to type.');
  if (text.length > MAX_TYPING_CHARS) throw new Error(`Use at most ${MAX_TYPING_CHARS.toLocaleString('en-US')} characters.`);
  if (!options || !Number.isFinite(options.wordsPerMinute) || options.wordsPerMinute < 15 || options.wordsPerMinute > 150
    || typeof options.sentencePauses !== 'boolean' || !['caret', 'append'].includes(options.position)) throw new Error('Choose valid typing settings.');
}
export function typingGraphemes(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(normalized)].map((part) => part.segment);
  // Firefox versions before Intl.Segmenter: keep combining marks, emoji modifiers, ZWJ
  // sequences and regional-indicator pairs together rather than exposing broken characters.
  const result: string[] = [];
  let regional = 0;
  for (const point of Array.from(normalized)) {
    const flag = /\p{Regional_Indicator}/u.test(point);
    const joins = result.length && (/^[\p{M}\p{Emoji_Modifier}\uFE0F\u200D]$/u.test(point) || result.at(-1)!.endsWith('\u200D') || flag && regional % 2 === 1);
    if (joins) result[result.length - 1] += point; else result.push(point);
    regional = flag ? regional + 1 : 0;
  }
  return result;
}
export function freshRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}
/** Each interval is newly sampled. Bounds keep the controls responsive and speed usable. */
export class TypingCadence {
  private tempo = 1;
  constructor(private options: TypingOptions, private random: () => number = freshRandom) {}
  delay(character: string, next: string): number {
    const u = Math.max(Number.EPSILON, this.random());
    const gaussian = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.random());
    if (/\s/u.test(character)) this.tempo = .7 * this.tempo + .3 * (.65 + this.random() * .8);
    let delay = 60000 / (this.options.wordsPerMinute * 5) * this.tempo * Math.exp(.55 * gaussian - .15125);
    if (/[,:;—]/u.test(character)) delay += 100 + this.random() * 500;
    if (this.random() < .025) delay += 200 + this.random() ** 2 * 1200;
    const sentenceEnd = /[.!?।。！？]/u.test(character) && (!next || /[\s”"'’]/u.test(next));
    if (this.options.sentencePauses && sentenceEnd && this.random() < .55) delay += 2000 + this.random() * 5000;
    if (this.options.sentencePauses && character === '\n' && this.random() < .65) delay += 2500 + this.random() * 5500;
    return Math.round(Math.max(20, Math.min(10000, delay)));
  }
}
