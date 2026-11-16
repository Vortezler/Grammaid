import { describe, expect, it } from 'vitest';
import { applyEdits, automaticEdits, fieldSelection, inverseEdits, mapCaret } from '../../src/content/auto-correct';
import { normalizeSettings } from '../../src/shared/settings';
import type { Issue } from '../../src/shared/types';

const issue = (start: number, end: number, suggestions: string[], kind: Issue['kind'] = 'grammar', rule = 'Grammar'): Issue => ({ start, end, suggestions, kind, rule, message: '' });
describe('automatic corrections', () => {
  it('waits for finished words, skips ambiguous fixes and advice-only style rules', () => {
    expect(automaticEdits('teh', [issue(0, 3, ['the'])], true, null)).toEqual([]);
    expect(automaticEdits('teh ', [issue(0, 3, ['the'])], true, null)).toHaveLength(1);
    expect(automaticEdits('teh ', [issue(0, 3, ['the', 'ten'])], true, null)).toEqual([]);
    expect(automaticEdits('very good ', [issue(0, 9, ['good'], 'style', 'Weak intensifier')], true, null)).toEqual([]);
    expect(automaticEdits('end result ', [issue(0, 10, ['result'], 'style', 'Redundant pair')], true, null)).toHaveLength(1);
    expect(automaticEdits('end result ', [issue(0, 10, ['result'], 'style', 'Redundant pair')], false, null)).toEqual([]);
  });
  it('protects selected text and rejects overlapping or invalid ranges', () => {
    expect(automaticEdits('teh cat ', [issue(0, 3, ['the'])], true, { start: 0, end: 3, backward: false })).toEqual([]);
    expect(automaticEdits('teh cat ', [issue(0, 3, ['the']), issue(1, 4, ['x']), issue(-1, 4, ['x'])], true, null)).toHaveLength(1);
  });
  it('applies a batch without moving the caret and can undo it without replacing surrounding text', () => {
    const field = document.createElement('textarea'); document.body.append(field);
    field.value = 'I in order to go. '; field.focus(); field.setSelectionRange(field.value.length, field.value.length);
    const selection = fieldSelection(field);
    const edits = automaticEdits(field.value, [issue(2, 13, ['to'], 'style', 'Wordy phrase')], true, selection);
    const applied = applyEdits(field, edits, selection);
    expect(field.value).toBe('I to go. ');
    expect(field.selectionStart).toBe(field.value.length);
    applyEdits(field, inverseEdits(applied), fieldSelection(field));
    expect(field.value).toBe('I in order to go. '); field.remove();
  });
  it('maps caret boundaries through longer replacements and preserves backwards selections', () => {
    const edit = { start: 2, end: 5, before: 'abc', after: 'longer' };
    expect(mapCaret(5, [edit])).toBe(8);
    expect(mapCaret(1, [edit])).toBe(1);
    const field = document.createElement('textarea'); document.body.append(field);
    field.value = 'x abc tail'; field.focus(); field.setSelectionRange(6, 10, 'backward');
    applyEdits(field, [edit], fieldSelection(field));
    expect(field.selectionDirection).toBe('backward'); expect(field.selectionStart).toBe(9); field.remove();
  });
  it('migrates existing settings without enabling automatic changes', () => {
    expect(normalizeSettings({}).autoCorrect).toBe(false);
    expect(normalizeSettings({ autoCorrect: true, autoCorrectStyle: false }).autoCorrectStyle).toBe(false);
  });
});
