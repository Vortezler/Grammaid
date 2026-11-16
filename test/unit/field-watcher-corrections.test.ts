import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldWatcher } from '../../src/content/field-watcher';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { Overlay } from '../../src/content/overlay';
import { markTypingField } from '../../src/content/typing-state';

let watcher: FieldWatcher;
let field: HTMLTextAreaElement;
let surface: HTMLElement | null;
let auto = true;
const message = vi.fn(async (request: { type: string }) => request.type === 'get-settings'
  ? { ok: true, data: { ...DEFAULT_SETTINGS, autoCorrect: auto } }
  : { ok: true, data: [{ start: 0, end: 3, suggestions: ['the'], kind: 'spelling', rule: 'Spelling', message: 'Typo' }] });

beforeEach(() => {
  vi.useFakeTimers(); auto = true; surface = null; message.mockClear();
  document.body.replaceChildren();
  field = document.createElement('textarea'); document.body.append(field);
  field.getClientRects = () => [{ width: 200, height: 100 }] as unknown as DOMRectList;
  vi.stubGlobal('browser', { runtime: { sendMessage: message } });
  const overlay = {
    setFieldIssues: vi.fn(), setPill: vi.fn(), removeField: vi.fn(), clearFields: vi.fn(), setHover: vi.fn(), schedule: vi.fn(), toast: vi.fn(), hitTest: () => null,
    owns: (target: Node) => surface?.contains(target) ?? false,
    get surfaceEl() { return surface; },
    closeSurface() { surface?.remove(); surface = null; },
    openSurface(el: HTMLElement) { surface = el; document.body.append(el); },
    addFloating(el: HTMLElement) { document.body.append(el); },
    anchorOf: () => ({ left: 10, top: 10, right: 100, bottom: 40 }),
  };
  watcher = new FieldWatcher(overlay as unknown as Overlay); watcher.start(); field.focus();
});
afterEach(() => { watcher.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function input(text: string, type = 'insertText') {
  field.value = text; field.setSelectionRange(text.length, text.length);
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type }));
}
describe('field watcher correction behavior', () => {
  it('preserves exact text during a typing session and after completion', async () => {
    markTypingField(field, true); input('teh cat ');
    await vi.advanceTimersByTimeAsync(1100); expect(field.value).toBe('teh cat '); expect(surface).toBeNull();
    markTypingField(field, false); await vi.advanceTimersByTimeAsync(1100); expect(field.value).toBe('teh cat ');
  });
  it('corrects a completed word without confirmation, then undo restores it without recorrecting', async () => {
    input('teh cat '); await vi.advanceTimersByTimeAsync(850);
    expect(field.value).toBe('the cat '); expect(field.selectionStart).toBe(8);
    const undo = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Undo')!;
    expect(undo).toBeDefined(); undo.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(field.value).toBe('teh cat ');
  });
  it('leaves unfinished words, unfocused text and native undo alone', async () => {
    input('teh'); await vi.advanceTimersByTimeAsync(850); expect(field.value).toBe('teh');
    input('teh cat '); field.blur(); await vi.advanceTimersByTimeAsync(850); expect(field.value).toBe('teh cat ');
    field.focus(); input('teh cat ', 'historyUndo'); await vi.advanceTimersByTimeAsync(850); expect(field.value).toBe('teh cat ');
  });
  it('does not correct during IME composition and resumes after composition ends', async () => {
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input('teh cat '); await vi.advanceTimersByTimeAsync(1000); expect(field.value).toBe('teh cat ');
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(850); expect(field.value).toBe('the cat ');
  });
  it('opens a suggestion automatically while keeping keyboard focus in the editor', async () => {
    auto = false;
    input('teh cat '); await vi.advanceTimersByTimeAsync(1100);
    expect(surface?.getAttribute('aria-label')).toBe('Spelling suggestion');
    expect(document.activeElement).toBe(field); expect(field.value).toBe('teh cat ');
  });
});
