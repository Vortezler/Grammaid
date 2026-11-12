// Applies a replacement to a field in a way the page can see and undo: execCommand('insertText')
// first (native undo stack, framework listeners fire), with manual fallbacks if that is refused.
import { isTextControl, readField, rangeFromOffsets, type Editable, type TextControl } from './textmap';

function nativeValueSetter(el: TextControl): ((v: string) => void) | null {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  return setter ? (v: string) => setter.call(el, v) : null;
}

function fireInput(el: Element, data: string) {
  let event: Event;
  try {
    event = new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertReplacementText', data });
  } catch {
    event = new Event('input', { bubbles: true });
  }
  el.dispatchEvent(event);
}

function exec(doc: Document, replacement: string): boolean {
  try {
    return replacement === '' ? doc.execCommand('delete', false) : doc.execCommand('insertText', false, replacement);
  } catch {
    return false;
  }
}

function applyToControl(el: TextControl, start: number, end: number, replacement: string): boolean {
  const before = el.value;
  const expected = before.slice(0, start) + replacement + before.slice(end);
  el.focus();
  try {
    el.setSelectionRange(start, end);
  } catch {
    // email inputs do not support selection ranges in some browsers; fall through to the setter
  }
  const selected = el.selectionStart === start && el.selectionEnd === end;
  if (selected && exec(el.ownerDocument, replacement) && el.value === expected) return true;

  // Fallback: set the value through the prototype setter (so React's value tracker notices)
  // and announce it with a bubbling input event.
  const set = nativeValueSetter(el);
  if (set) set(expected);
  else el.value = expected;
  fireInput(el, replacement);
  try {
    const caret = start + replacement.length;
    el.setSelectionRange(caret, caret);
  } catch {
    // caret placement is cosmetic
  }
  return el.value === expected;
}

function applyToEditable(root: HTMLElement, start: number, end: number, replacement: string): boolean {
  const { text: before, map } = readField(root);
  if (!map) return false;
  const expected = before.slice(0, start) + replacement + before.slice(end);
  const range = rangeFromOffsets(map, start, end);
  if (!range) return false;
  const doc = root.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return false;
  root.focus();
  selection.removeAllRanges();
  selection.addRange(range);
  if (exec(doc, replacement) && readField(root).text === expected) return true;

  // Fallback: edit the DOM directly, then tell the page.
  const fresh = readField(root);
  if (fresh.text !== before || !fresh.map) return fresh.text === expected;
  const r = rangeFromOffsets(fresh.map, start, end);
  if (!r) return false;
  r.deleteContents();
  if (replacement) {
    const node = doc.createTextNode(replacement);
    r.insertNode(node);
    selection.removeAllRanges();
    const caret = doc.createRange();
    caret.setStartAfter(node);
    caret.collapse(true);
    selection.addRange(caret);
  }
  fireInput(root, replacement);
  return readField(root).text === expected;
}

/** Replaces text offsets [start, end) of the field with `replacement`. Returns true on success. */
export function applyReplacement(el: Editable, start: number, end: number, replacement: string): boolean {
  try {
    return isTextControl(el) ? applyToControl(el, start, end, replacement) : applyToEditable(el, start, end, replacement);
  } catch (e) {
    console.warn('Grammaid: could not apply the change', e);
    return false;
  }
}
