import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TYPING_OPTIONS, TypingCadence, typingGraphemes, validateTyping } from '../../src/shared/typing';
import { FieldTyper } from '../../src/content/typing';
import { isTypingField } from '../../src/content/typing-state';
import { readField } from '../../src/content/textmap';

describe('typing pacing and Unicode', () => {
  it('samples fresh bounded timings instead of replaying a fixed sequence', () => {
    const cadence = new TypingCadence(DEFAULT_TYPING_OPTIONS);
    const delays = Array.from({ length: 100 }, () => cadence.delay('a', 'b'));
    expect(new Set(delays).size).toBeGreaterThan(20);
    expect(delays.every((delay) => delay >= 20 && delay <= 10000)).toBe(true);
  });
  it('sometimes pauses after a sentence and supports turning those pauses off', () => {
    const cadence = new TypingCadence(DEFAULT_TYPING_OPTIONS, () => .5);
    const ordinary = cadence.delay('a', ' ');
    expect(cadence.delay('.', ' ')).toBe(ordinary + 4500);
    expect(new TypingCadence({ ...DEFAULT_TYPING_OPTIONS, sentencePauses: false }, () => .5).delay('.', ' ')).toBe(ordinary);
    expect(new TypingCadence(DEFAULT_TYPING_OPTIONS, () => .9).delay('.', ' ')).toBeLessThan(2000);
  });
  it('preserves graphemes and normalizes multiline text', () => {
    const text = 'नमस्ते 中文 👩🏽‍💻 🇮🇳 e\u0301\r\n안녕';
    const characters = typingGraphemes(text);
    expect(characters.join('')).toBe(text.replace('\r\n', '\n'));
    expect(characters).toContain('👩🏽‍💻'); expect(characters).toContain('🇮🇳'); expect(characters).toContain('e\u0301');
  });
  it('has an older-browser Unicode fallback', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
    try { expect(typingGraphemes('e\u0301👩🏽‍💻🇮🇳')).toEqual(['e\u0301', '👩🏽‍💻', '🇮🇳']); }
    finally { Object.defineProperty(Intl, 'Segmenter', descriptor); }
  });
  it('rejects empty text, excessive text, and invalid pacing', () => {
    expect(() => validateTyping(' ', DEFAULT_TYPING_OPTIONS)).toThrow();
    expect(() => validateTyping('a'.repeat(20001), DEFAULT_TYPING_OPTIONS)).toThrow();
    expect(() => validateTyping('Hi', { ...DEFAULT_TYPING_OPTIONS, wordsPerMinute: 0 })).toThrow();
  });
});

let typer: FieldTyper;
let field: HTMLTextAreaElement;
const options = { ...DEFAULT_TYPING_OPTIONS, wordsPerMinute: 150, sentencePauses: false };
function visible<T extends HTMLElement>(element: T): T { element.getClientRects = () => [{ width: 200, height: 100 }] as unknown as DOMRectList; return element; }
function begin(text: string, append = false) {
  const target = typer.fieldsOnPage().find((f) => f.label === 'target')!;
  return typer.start('job', target.fieldId, text, { ...options, position: append ? 'append' : 'caret' });
}
beforeEach(() => {
  vi.useFakeTimers(); document.body.replaceChildren();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  field = visible(document.createElement('textarea')) as HTMLTextAreaElement;
  field.id = 'target'; document.body.append(field); field.focus();
  typer = new FieldTyper(vi.fn());
});
afterEach(() => { typer.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('targeted field typing', () => {
  it('inserts exact multilingual text only in the chosen field and releases its autocorrect guard', async () => {
    const other = visible(document.createElement('textarea')); document.body.append(other);
    const input = vi.fn(); field.addEventListener('input', input);
    const text = 'Hello. नमस्ते 中文 👩🏽‍💻\n안녕';
    begin(text); expect(isTypingField(field)).toBe(true);
    await vi.runAllTimersAsync();
    expect(field.value).toBe(text); expect(other.value).toBe('');
    expect(input).toHaveBeenCalledTimes(typingGraphemes(text).length);
    expect(typer.statusFor('job')?.state).toBe('done'); expect(isTypingField(field)).toBe(false);
  });
  it('replaces selection once and can append to existing text', async () => {
    field.value = 'one two'; field.setSelectionRange(4, 7);
    begin('three'); await vi.runAllTimersAsync(); expect(field.value).toBe('one three');
    field.setSelectionRange(0, 0); begin('!', true); await vi.runAllTimersAsync(); expect(field.value).toBe('one three!');
  });
  it('pauses and resumes without writing while paused, then stops immediately', async () => {
    begin('abcdefghijklmnopqrstuvwxyz'); await vi.advanceTimersByTimeAsync(800);
    typer.control('job', 'pause'); const partial = field.value;
    await vi.advanceTimersByTimeAsync(30000); expect(field.value).toBe(partial);
    typer.control('job', 'resume'); await vi.advanceTimersByTimeAsync(200); expect(field.value.length).toBeGreaterThan(partial.length);
    typer.control('job', 'stop'); const stopped = field.value;
    await vi.runAllTimersAsync(); expect(field.value).toBe(stopped); expect(typer.statusFor('job')?.state).toBe('stopped');
  });
  it('does not overwrite intervening edits', async () => {
    begin('abcdef'); field.value = 'My edit'; await vi.runAllTimersAsync();
    expect(field.value).toBe('My edit'); expect(typer.statusFor('job')?.state).toBe('error');
  });
  it('pauses when the caret moves and Escape stops even while paused', async () => {
    field.value = 'Existing'; field.setSelectionRange(8, 8); begin(' text'); field.setSelectionRange(0, 0);
    await vi.runAllTimersAsync(); expect(typer.statusFor('job')?.state).toBe('paused'); expect(field.value).toBe('Existing');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(typer.statusFor('job')?.state).toBe('stopped');
  });
  it('pauses when focus moves or the tab is hidden', async () => {
    begin('abcdef'); const other = document.createElement('input'); document.body.append(other); other.focus();
    expect(typer.statusFor('job')?.state).toBe('paused');
    typer.control('job', 'resume');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange')); await vi.runAllTimersAsync();
    expect(field.value).toBe(''); expect(typer.statusFor('job')?.state).toBe('paused');
  });
  it('stops if the field disappears or becomes read-only', async () => {
    begin('abc'); field.readOnly = true; await vi.runAllTimersAsync(); expect(field.value).toBe('');
    expect(typer.statusFor('job')?.state).toBe('error'); field.readOnly = false;
    begin('abc'); field.remove(); await vi.runAllTimersAsync(); expect(typer.statusFor('job')?.state).toBe('error');
  });
  it('excludes password/disabled fields and checks maxlength and line breaks', () => {
    const password = visible(document.createElement('input')); password.type = 'password'; document.body.append(password);
    const disabled = visible(document.createElement('textarea')); disabled.disabled = true; document.body.append(disabled);
    expect(typer.fieldsOnPage()).toHaveLength(1);
    field.maxLength = 2; expect(() => begin('long')).toThrow('character limit');
    const input = visible(document.createElement('input')); input.id = 'line'; input.setAttribute('aria-label', 'Message'); document.body.append(input);
    const target = typer.fieldsOnPage().find((f) => f.label === 'Message')!;
    expect(() => typer.start('line', target.fieldId, 'a\nb', options)).toThrow('multiline');
  });
  it('supports a rich editor without flattening existing markup', async () => {
    field.remove(); const editor = visible(document.createElement('div')); editor.setAttribute('contenteditable', 'true'); editor.id = 'target';
    editor.innerHTML = '<b>Hello</b>'; document.body.append(editor); editor.focus();
    begin(' world', true); await vi.runAllTimersAsync();
    expect(readField(editor).text).toBe('Hello world'); expect(editor.querySelector('b')?.textContent?.startsWith('Hello')).toBe(true);
    expect(typer.statusFor('job')?.state).toBe('done');
  });
  it('can type into an empty rich editor', async () => {
    field.remove(); const editor = visible(document.createElement('div')); editor.setAttribute('contenteditable', 'true'); editor.id = 'target';
    document.body.append(editor); editor.focus(); begin('Hello', true); await vi.runAllTimersAsync();
    expect(readField(editor).text).toBe('Hello'); expect(typer.statusFor('job')?.state).toBe('done');
  });
  it('accepts the browser’s trailing-space conversion but refuses other editor rewrites', async () => {
    field.remove(); const editor = visible(document.createElement('div')); editor.setAttribute('contenteditable', 'true'); editor.id = 'target';
    editor.textContent = 'Hi'; document.body.append(editor); editor.focus();
    const oldExec = document.execCommand;
    document.execCommand = (_command, _ui, text) => {
      const range = document.getSelection()!.getRangeAt(0); range.deleteContents();
      const node = document.createTextNode(text === ' ' ? '\u00a0' : text ?? ''); range.insertNode(node);
      const caret = document.createRange(); caret.setStartAfter(node); caret.collapse(true); document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(caret);
      return true;
    };
    try {
      begin(' there', true); await vi.runAllTimersAsync(); expect(readField(editor).text.replace(/\u00a0/g, ' ')).toBe('Hi there'); expect(typer.statusFor('job')?.state).toBe('done');
      editor.addEventListener('input', () => { editor.textContent += '!'; });
      document.execCommand = () => false;
      begin('x', true); await vi.runAllTimersAsync(); expect(typer.statusFor('job')?.state).toBe('error');
    } finally { document.execCommand = oldExec; }
  });
});
