import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFreeText } from '../../src/content/field-policy';
import { readField } from '../../src/content/textmap';
import { applyReplacement } from '../../src/content/apply';
import { FieldTyper } from '../../src/content/typing';
import { DEFAULT_TYPING_OPTIONS } from '../../src/shared/typing';
import { getSelectionContext, SelectionActions } from '../../src/content/selection-actions';
import type { Overlay } from '../../src/content/overlay';
function field(html: string): HTMLElement { document.body.innerHTML = html; return document.body.querySelector('textarea,input,[contenteditable]') as HTMLElement; }
beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('structural free-text policy', () => {
  it.each([
    '<input type="password" aria-label="Message">', '<input type="email">', '<input type="tel">', '<input type="number">',
    '<input type="text" autocomplete="username">', '<input type="text" autocomplete="current-password">', '<input type="text" autocomplete="one-time-code">',
    '<textarea autocomplete="street-address"></textarea>', '<input type="text" autocomplete="section-checkout shipping cc-number">',
    '<input type="text" name="cardNumber">', '<input type="text" name="billing_address">', '<input type="text" name="given-name">',
    '<input type="text" name="accountId">', '<input type="text" aria-label="Message" inputmode="numeric">',
    '<input type="text" aria-label="Message" pattern="[0-9]+">', '<input type="text">',
    '<label>Full name<input type="text" aria-label="Message"></label>', '<span id="lab">Street address</span><textarea aria-labelledby="lab"></textarea>',
    '<form id="checkout"><textarea aria-label="Message"></textarea></form>', '<form action="/account/login"><textarea></textarea></form>',
    '<fieldset><legend>Payment information</legend><textarea></textarea></fieldset>', '<div id="billing-details"><div contenteditable="true"></div></div>',
    '<div contenteditable="true" aria-label="To"></div>', '<div contenteditable="true" aria-label="Email address"></div>',
    '<form id="login"></form><textarea form="login"></textarea>', '<form><textarea></textarea><input type="password"></form>',
  ])('excludes structured/sensitive HTML: %s', (html) => { expect(isFreeText(field(html))).toBe(false); });
  it.each([
    '<textarea></textarea>', '<input type="text" name="postTitle">', '<input type="search">', '<input type="text" aria-label="Message">',
    '<div contenteditable="true" aria-label="Write a reply"></div>', '<label>Message<textarea>password is just prose here</textarea></label>',
  ])('allows a free-text editor without inspecting its content: %s', (html) => { expect(isFreeText(field(html))).toBe(true); });
  it('never reads a blocked value, including extraction, selection, replacement and target discovery', () => {
    const input = field('<input type="text" name="cardNumber" value="sensitive">') as HTMLInputElement;
    const getter = vi.spyOn(input, 'value', 'get').mockImplementation(() => { throw new Error('Sensitive value read'); });
    expect(isFreeText(input)).toBe(false); expect(readField(input)).toEqual({ text: '', map: null });
    expect(applyReplacement(input, 0, 1, 'x')).toBe(false); input.focus();
    const overlay = { measureControl: vi.fn() } as unknown as Overlay;
    expect(getSelectionContext(overlay)).toBeNull();
    expect(new SelectionActions(overlay, () => false).pageText('field', input)).toBeUndefined();
    expect(new SelectionActions(overlay, () => false).pageText('selection', input)).toBeUndefined();
    const typer = new FieldTyper(vi.fn()); expect(typer.fieldsOnPage()).toEqual([]); typer.destroy(); expect(getter).not.toHaveBeenCalled();
  });
  it('does not read surrounding page text to classify a field', () => {
    const textarea = field('<p>Private surrounding text</p><textarea aria-label="Message"></textarea>');
    const getter = vi.spyOn(document.body, 'textContent', 'get').mockImplementation(() => { throw new Error('Page text read'); });
    expect(isFreeText(textarea)).toBe(true); expect(getter).not.toHaveBeenCalled();
  });
  it('stops a typing job when an editor becomes sensitive before insertion', async () => {
    vi.useFakeTimers(); Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    const textarea = field('<textarea aria-label="Message"></textarea>') as HTMLTextAreaElement;
    textarea.getClientRects = () => [{ width: 100, height: 100 }] as unknown as DOMRectList; textarea.focus();
    const typer = new FieldTyper(vi.fn()); const target = typer.fieldsOnPage()[0]; typer.start('job', target.fieldId, 'Hello', DEFAULT_TYPING_OPTIONS);
    textarea.autocomplete = 'street-address';
    const getter = vi.spyOn(textarea, 'value', 'get').mockImplementation(() => { throw new Error('Sensitive value read'); });
    await vi.runAllTimersAsync(); expect(typer.statusFor('job')?.state).toBe('error'); expect(getter).not.toHaveBeenCalled(); typer.destroy();
  });
});
