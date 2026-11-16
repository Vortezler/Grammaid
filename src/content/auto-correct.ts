import type { Issue } from '../shared/types';
import { applyReplacement } from './apply';
import { isTextControl, offsetFromPosition, rangeFromOffsets, readField, type Editable } from './textmap';

export interface Edit { start: number; end: number; before: string; after: string }
export interface SelectionOffsets { start: number; end: number; backward: boolean }
export function fieldSelection(el: Editable): SelectionOffsets | null {
  if (isTextControl(el)) return el.selectionStart === null || el.selectionEnd === null ? null : { start: el.selectionStart, end: el.selectionEnd, backward: el.selectionDirection === 'backward' };
  const selection = el.ownerDocument.getSelection();
  const map = readField(el).map;
  if (!selection?.anchorNode || !selection.focusNode || !map || !el.contains(selection.anchorNode) || !el.contains(selection.focusNode)) return null;
  const anchor = offsetFromPosition(map, selection.anchorNode, selection.anchorOffset);
  const focus = offsetFromPosition(map, selection.focusNode, selection.focusOffset);
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), backward: anchor > focus };
}
export function restoreFieldSelection(el: Editable, selection: SelectionOffsets | null) {
  if (!selection) return;
  if (isTextControl(el)) { el.setSelectionRange(selection.start, selection.end, selection.backward ? 'backward' : 'forward'); return; }
  const map = readField(el).map;
  if (!map) return;
  const range = rangeFromOffsets(map, selection.start, selection.end);
  const selected = el.ownerDocument.getSelection();
  if (!range || !selected) return;
  selected.removeAllRanges(); selected.addRange(range);
  if (selection.backward) selected.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
}
export function mapCaret(position: number, edits: Edit[]): number {
  let delta = 0;
  for (const edit of edits) {
    if (position < edit.start) break;
    if (position < edit.end) return edit.start + delta + Math.min(position - edit.start, edit.after.length);
    delta += edit.after.length - (edit.end - edit.start);
  }
  return position + delta;
}
/** Grammar/spelling must have a single concrete fix. Only known wording rules are automatic. */
export function automaticEdits(text: string, issues: Issue[], style: boolean, selection: SelectionOffsets | null): Edit[] {
  const edits: Edit[] = [];
  for (const issue of [...issues].sort((a, b) => a.start - b.start)) {
    const wording = style && issue.kind === 'style' && ['Wordy phrase', 'Redundant pair'].includes(issue.rule);
    if (!wording && (issue.kind === 'style' || issue.suggestions.length !== 1)) continue;
    const after = issue.suggestions[0];
    if (after === undefined || issue.start < 0 || issue.end > text.length || issue.end <= issue.start) continue;
    if (edits.length && issue.start < edits.at(-1)!.end) continue;
    // A word still being typed is incomplete; wait for a space or punctuation.
    if (issue.end === text.length && /[\p{L}\p{N}]$/u.test(text.slice(issue.start, issue.end))) continue;
    // Preserve selected text the user may be about to replace.
    if (selection && selection.start !== selection.end && issue.start < selection.end && issue.end > selection.start) continue;
    const before = text.slice(issue.start, issue.end);
    if (before === after) continue;
    edits.push({ start: issue.start, end: issue.end, before, after });
    if (edits.length >= 20) break;
  }
  return edits;
}
export function applyEdits(el: Editable, edits: Edit[], selection: SelectionOffsets | null): Edit[] {
  const scroll = { top: el.scrollTop, left: el.scrollLeft };
  const applied: Edit[] = [];
  try {
    for (const edit of [...edits].reverse()) {
      if (readField(el).text.slice(edit.start, edit.end) !== edit.before) break;
      if (!applyReplacement(el, edit.start, edit.end, edit.after)) break;
      applied.unshift(edit);
    }
  } finally {
    restoreFieldSelection(el, selection && { ...selection, start: mapCaret(selection.start, applied), end: mapCaret(selection.end, applied) });
    el.scrollTop = scroll.top; el.scrollLeft = scroll.left;
  }
  return applied;
}
export function inverseEdits(edits: Edit[]): Edit[] {
  let delta = 0;
  return edits.map((edit) => {
    const start = edit.start + delta;
    delta += edit.after.length - (edit.end - edit.start);
    return { start, end: start + edit.after.length, before: edit.after, after: edit.before };
  });
}
