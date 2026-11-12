// Actions on the current selection: Synonyms (one word) and Rephrase (four or more words),
// shown in a popover anchored to the selection. Works in editable fields (replace in place)
// and in ordinary page text (copy to clipboard).
import { send, type PageText, type RephraseOption, type SynonymResult } from '../shared/types';
import { sentenceAt, countWords } from '../shared/sentences';
import { diffWords } from '../shared/diff';
import { applyReplacement } from './apply';
import { trapKeys } from './card';
import type { Box, Overlay } from './overlay';
import { buildTextMap, editingHost, isTextControl, offsetFromPosition, type Editable } from './textmap';
import { h } from './ui';

export interface SelectionContext {
  /** The selected text, trimmed of surrounding spaces and punctuation. */
  selected: string;
  /** Offsets of `selected` in `text`. */
  start: number;
  end: number;
  /** Full text of the field or of the block the selection sits in. */
  text: string;
  /** Sentence containing the selection, and where the selection starts inside it. */
  sentence: string;
  startInSentence: number;
  editable: Editable | null;
  anchor: Box;
}

const WORD_RE = /^[A-Za-z][A-Za-z'’-]*$/;
const BLOCKS = new Set(['P', 'DIV', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'ARTICLE', 'SECTION', 'DD', 'DT', 'PRE', 'BODY']);

/** Shrinks [start, end) so it does not begin or end with whitespace or punctuation. */
export function trimRange(text: string, start: number, end: number): { start: number; end: number } {
  const junk = /[\s.,;:!?"“”‘’'()[\]{}…—–-]/;
  let s = start;
  let e = end;
  while (s < e && junk.test(text[s])) s++;
  while (e > s && junk.test(text[e - 1])) e--;
  return { start: s, end: e };
}

function finish(
  text: string,
  rawStart: number,
  rawEnd: number,
  editable: Editable | null,
  anchor: Box,
): SelectionContext | null {
  const { start, end } = trimRange(text, rawStart, rawEnd);
  if (end <= start) return null;
  const s = sentenceAt(text, start);
  const sentence = s && end <= s.end ? s : { text: text.slice(start, end), start, end };
  return {
    selected: text.slice(start, end),
    start,
    end,
    text,
    sentence: sentence.text,
    startInSentence: start - sentence.start,
    editable,
    anchor,
  };
}

export function getSelectionContext(overlay: Overlay): SelectionContext | null {
  const active = document.activeElement;
  if (isTextControl(active)) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (end <= start) return null;
    const anchor = overlay.measureControl(active, start, end);
    if (!anchor) return null;
    const editable = active.disabled || active.readOnly ? null : active;
    return finish(active.value, start, end, editable, anchor);
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const container =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (!container) return null;
  const host = editingHost(container);
  let root: HTMLElement | null = host;
  if (!root) {
    let el: Element | null = container;
    while (el && !BLOCKS.has(el.tagName)) el = el.parentElement;
    root = (el as HTMLElement | null) ?? document.body;
  }
  const map = buildTextMap(root);
  const start = offsetFromPosition(map, range.startContainer, range.startOffset);
  const end = offsetFromPosition(map, range.endContainer, range.endOffset);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return finish(map.text, start, end, host, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export class SelectionActions {
  private synButton: HTMLButtonElement | null = null;
  private checkTimer = 0;
  private poll = 0;
  private token = 0;
  private active = false;

  constructor(
    private overlay: Overlay,
    private isEnabled: () => boolean,
  ) {}

  start() {
    if (this.active) return;
    this.active = true;
    document.addEventListener('selectionchange', this.queueCheck);
    document.addEventListener('mouseup', this.queueCheck, true);
    document.addEventListener('keyup', this.queueCheck, true);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('selectionchange', this.queueCheck);
    document.removeEventListener('mouseup', this.queueCheck, true);
    document.removeEventListener('keyup', this.queueCheck, true);
    window.clearTimeout(this.checkTimer);
    window.clearInterval(this.poll);
    this.hideSynButton();
  }

  /** Text for the sidebar's "Use text from page field" / "Use selection" buttons. */
  pageText(source: 'field' | 'selection', field: Editable | null): PageText | undefined {
    if (source === 'selection') {
      const active = document.activeElement;
      const text = isTextControl(active)
        ? active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0)
        : (window.getSelection()?.toString() ?? '');
      return text.trim() ? { text, source } : undefined;
    }
    if (!field) return undefined;
    const text = isTextControl(field) ? field.value : buildTextMap(field).text;
    return text.trim() ? { text, source } : undefined;
  }

  // ---- floating "Syn" button ------------------------------------------------------------------

  private queueCheck = () => {
    window.clearTimeout(this.checkTimer);
    this.checkTimer = window.setTimeout(() => {
      try {
        this.checkSelection();
      } catch (e) {
        console.warn('Grammaid: selection check failed', e);
      }
    }, 160);
  };

  private checkSelection() {
    if (!this.isEnabled() || this.overlay.owns(document.activeElement) || this.overlay.surfaceEl) {
      this.hideSynButton();
      return;
    }
    const ctx = getSelectionContext(this.overlay);
    if (!ctx || !ctx.editable || !WORD_RE.test(ctx.selected)) {
      this.hideSynButton();
      return;
    }
    if (!this.synButton) {
      this.synButton = h('button', { class: 'syn', type: 'button', 'aria-label': 'Grammaid: synonyms for the selected word', onClick: () => this.run('synonyms') }, 'Syn');
      // Pressing the button must not clear the selection it acts on.
      this.synButton.addEventListener('mousedown', (e) => e.preventDefault());
      this.overlay.addFloating(this.synButton);
    }
    const b = this.synButton;
    b.style.display = '';
    b.style.left = `${Math.min(window.innerWidth - 52, ctx.anchor.right + 6)}px`;
    b.style.top = `${Math.max(4, ctx.anchor.top - 28)}px`;
  }

  private hideSynButton() {
    if (this.synButton) this.synButton.style.display = 'none';
  }

  // ---- actions --------------------------------------------------------------------------------

  /** Returns true when this frame had a selection to act on. */
  run(action: 'synonyms' | 'rephrase'): boolean {
    try {
      const ctx = getSelectionContext(this.overlay);
      if (!ctx) {
        // In a multi-frame page only the frame with the selection should speak up.
        if (window === window.top) this.overlay.toast(action === 'synonyms' ? 'Select a word first.' : 'Select a sentence first.');
        return false;
      }
      this.hideSynButton();
      if (action === 'synonyms') void this.synonyms(ctx);
      else void this.rephrase(ctx);
      return true;
    } catch (e) {
      console.warn('Grammaid: action failed', e);
      return false;
    }
  }

  private openPopover(ctx: SelectionContext, title: string, subtitle: string) {
    const body = h('div', { class: 'col' });
    const note = h('p', { class: 'note' }, 'Working…');
    const bar = h('i');
    const progress = h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Model download' }, bar);
    progress.style.display = 'none';
    const pop = h('div', { class: 'pop', role: 'dialog', 'aria-label': title }, h('p', { class: 'title' }, title), h('p', { class: 'sub' }, subtitle), body, note, progress);
    const token = ++this.token;
    const close = () => {
      this.overlay.closeSurface();
      (ctx.editable ?? (document.activeElement as HTMLElement | null))?.focus?.({ preventScroll: true });
    };
    trapKeys(pop, close);
    pop.addEventListener('mousedown', (e) => {
      if (!(e.target instanceof HTMLButtonElement)) e.preventDefault();
    });
    this.overlay.openSurface(pop, ctx.anchor, () => {
      if (this.token === token) this.token++;
      window.clearInterval(this.poll);
    });
    // While the request runs, show model download progress if that is what we are waiting for.
    window.clearInterval(this.poll);
    this.poll = window.setInterval(async () => {
      const res = await send({ type: 'model-status' });
      if (this.token !== token || !res.ok) return;
      const loading = res.data.gpt2 === 'loading' || res.data.t5 === 'loading';
      if (!loading) return;
      const pct = res.data.progress === undefined ? null : Math.round(res.data.progress * 100);
      note.textContent = pct === null ? 'Loading the language model…' : `Downloading the language model (one time)… ${pct}%`;
      progress.style.display = '';
      bar.style.width = `${pct ?? 0}%`;
    }, 700);
    const done = (message: string | null) => {
      window.clearInterval(this.poll);
      progress.style.display = 'none';
      note.textContent = message ?? '';
      note.style.display = message ? '' : 'none';
      pop.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    };
    return { body, done, close, alive: () => this.token === token };
  }

  private async deliver(ctx: SelectionContext, start: number, end: number, replacement: string, close: () => void) {
    if (ctx.editable) {
      this.overlay.closeSurface();
      if (!applyReplacement(ctx.editable, start, end, replacement)) {
        this.overlay.toast('Grammaid could not change this field. Try editing it by hand.');
      }
      return;
    }
    close();
    this.overlay.toast((await copyText(replacement)) ? 'Copied to clipboard' : 'Could not copy. Select the text and copy it by hand.');
  }

  private async synonyms(ctx: SelectionContext) {
    if (!WORD_RE.test(ctx.selected)) {
      this.overlay.toast('Select a single word to see synonyms.');
      return;
    }
    const pop = this.openPopover(ctx, `Synonyms for “${ctx.selected}”`, ctx.editable ? 'Ranked by how well they fit this sentence. Click to replace.' : 'Ranked by how well they fit this sentence. Click to copy.');
    const res = await send({ type: 'synonyms', sentence: ctx.sentence, word: ctx.selected, wordStart: ctx.startInSentence });
    if (!pop.alive()) return;
    if (!res.ok) return pop.done(res.error);
    if (res.data.results.length === 0) return pop.done('No synonyms found for this word.');
    const item = (r: SynonymResult) =>
      h(
        'button',
        {
          class: 'item',
          type: 'button',
          onClick: () => {
            const before = r.before;
            const start = before ? ctx.start - before.length : ctx.start;
            void this.deliver(ctx, start, ctx.end, (before?.text ?? '') + r.word, pop.close);
          },
        },
        h('span', { class: 'w' }, r.before ? `${r.before.text}${r.word}` : r.word),
        r.gloss && h('span', { class: 'g' }, r.gloss),
      );
    pop.body.replaceChildren(...res.data.results.map(item));
    pop.done(res.data.ranked ? null : (res.data.modelError ?? 'Shown in dictionary order: the language model is not available.'));
  }

  private async rephrase(ctx: SelectionContext) {
    if (countWords(ctx.selected) < 4) {
      this.overlay.toast('Select at least four words to rephrase.');
      return;
    }
    const pop = this.openPopover(ctx, 'Rephrase', ctx.editable ? 'Click a version to use it.' : 'Click a version to copy it.');
    const res = await send({ type: 'rephrase', text: ctx.selected });
    if (!pop.alive()) return;
    if (!res.ok) return pop.done(res.error);
    const labels: Record<RephraseOption['source'], string> = { model: 'Rewrite', tighten: 'Tighten', 'active-hint': 'Active voice hint' };
    const items = res.data.options.map((o) => {
      if (o.source === 'active-hint') {
        return h('div', { class: 'col' }, h('span', { class: 'tag' }, labels[o.source]), h('p', { class: 'note' }, o.note ?? ''));
      }
      const diff = h('span', { class: 't' });
      for (const part of diffWords(ctx.selected, o.text)) {
        diff.appendChild(part.type === 'same' ? document.createTextNode(part.text) : h(part.type === 'add' ? 'ins' : 'del', {}, part.text));
      }
      return h(
        'button',
        { class: 'item', type: 'button', 'aria-label': `${labels[o.source]}: ${o.text}`, onClick: () => void this.deliver(ctx, ctx.start, ctx.end, o.text, pop.close) },
        h('span', { class: 'tag' }, labels[o.source]),
        diff,
      );
    });
    pop.body.replaceChildren(...items);
    pop.done(
      res.data.modelError ??
        (items.length === 0 ? 'No better phrasing found. The small local model gives modest rewrites.' : null),
    );
  }
}
