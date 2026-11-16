// Checks text fields: lints each one after typing pauses, keeps underlines glued to the text
// while typing, and opens the suggestion card when an underline is clicked.
import { send, type Issue } from '../shared/types';
import { DEFAULT_SETTINGS, LINT_DEBOUNCE_MS, MAX_LINT_CHARS, type Settings } from '../shared/settings';
import { applyEdits, automaticEdits, fieldSelection, inverseEdits, restoreFieldSelection, type Edit, type SelectionOffsets } from './auto-correct';
import { h } from './ui';
import { isTypingField } from './typing-state';
import { isFreeText } from './field-policy';
import { applyReplacement } from './apply';
import { buildCard } from './card';
import type { Overlay } from './overlay';
import { editingHost, isTextControl, readField, type Editable, type TextMap } from './textmap';

const BLUR_GRACE_MS = 250;
/** Most fields checked in one frame; pages with more (huge forms, grids) get the first ones. */
export const MAX_FIELDS = 40;
/** Gap between the first lints of newly found fields, so a big form does not stall the page. */
const STAGGER_MS = 40;
const SCAN_DEBOUNCE_MS = 500;

/**
 * Moves issues along with an edit: issues before the change stay, issues after it shift by the
 * length difference, and issues the change touched are dropped until the next lint.
 */
export function shiftIssues(issues: Issue[], oldText: string, newText: string): Issue[] {
  if (oldText === newText) return issues;
  const max = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < max && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }
  const oldEnd = oldText.length - suffix;
  const delta = newText.length - oldText.length;
  const wordChar = /[A-Za-z0-9'’-]/;
  // An edit that butts up against a word changes that word, so its issue no longer holds.
  const joined = (start: number, end: number) =>
    (start > 0 && wordChar.test(newText[start - 1]) && wordChar.test(newText[start])) ||
    (end < newText.length && wordChar.test(newText[end - 1]) && wordChar.test(newText[end]));
  const out: Issue[] = [];
  for (const issue of issues) {
    if (issue.end < prefix || (issue.end === prefix && !joined(issue.start, issue.end))) {
      out.push(issue);
    } else if (issue.start >= oldEnd && issue.start >= prefix) {
      const moved = { ...issue, start: issue.start + delta, end: issue.end + delta };
      if (issue.start > oldEnd || !joined(moved.start, moved.end)) out.push(moved);
    }
  }
  return out;
}

export function findEditable(target: EventTarget | null): Editable | null {
  if (!(target instanceof Element)) return null;
  if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && !isFreeText(target)) return null;
  const candidate = isTextControl(target) ? target : editingHost(target);
  if (!candidate || !isFreeText(candidate)) return null;
  if (isTextControl(target)) {
    if (target.disabled || target.readOnly) return null;
    if (target.spellcheck === false || target.getAttribute('spellcheck') === 'false') return null;
    return target;
  }
  const host = editingHost(target);
  if (!host) return null;
  if (host.getAttribute('spellcheck') === 'false' || host.getAttribute('aria-readonly') === 'true') return null;
  return host;
}

const ignoreKey = (text: string, issue: Issue) => `${issue.rule}\u0000${text.slice(issue.start, issue.end).toLowerCase()}`;

const CANDIDATES = 'textarea, input, [contenteditable]';

/** Every checkable field under `root` that is actually laid out (visible), in document order. */
export function findFields(root: ParentNode, limit: number = MAX_FIELDS): Editable[] {
  const out: Editable[] = [];
  const seen = new Set<Editable>();
  for (const el of Array.from(root.querySelectorAll(CANDIDATES))) {
    const field = findEditable(el);
    if (!field || seen.has(field)) continue;
    seen.add(field);
    if (field.getClientRects().length === 0) continue; // display:none, detached, collapsed
    out.push(field);
    if (out.length >= limit) break;
  }
  return out;
}

interface FieldState {
  el: Editable;
  text: string;
  map: TextMap | null;
  issues: Issue[];
  timer: number;
  seq: number;
  listeners: [string, EventListener, AddEventListenerOptions?][];
  composing: boolean;
  dirty: boolean;
}

/**
 * While running, checks EVERY text field in the page, not just the focused one: the fields
 * present at start, and any that appear later (watched with a MutationObserver).
 */
export class FieldWatcher {
  private fields = new Map<Editable, FieldState>();
  private focused: Editable | null = null;
  private lastField: Editable | null = null;
  private blurTimer = 0;
  private scanTimer = 0;
  private observer: MutationObserver | null = null;
  private ignored = new Set<string>();
  private active = false;
  private card: HTMLElement | null = null;
  private settings: Settings = DEFAULT_SETTINGS;
  private popupTimer = 0;
  private hoveredIssue: Issue | null = null;
  private applying = false;
  private undo: { state: FieldState; after: string; edits: Edit[]; selection: SelectionOffsets | null } | null = null;
  private notice: HTMLElement | null = null;

  constructor(private overlay: Overlay) {}

  get running(): boolean {
    return this.active;
  }

  /** Number of fields currently being checked. */
  get fieldCount(): number {
    return this.fields.size;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.loadPreferences();
    document.addEventListener('focusin', this.onFocusIn, true);
    document.addEventListener('focusout', this.onFocusOut, true);
    document.addEventListener('mousedown', this.onDocMouseDown, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => this.queueScan(SCAN_DEBOUNCE_MS));
      this.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'autocomplete', 'inputmode', 'pattern', 'name', 'id', 'aria-label', 'aria-labelledby', 'aria-readonly', 'aria-disabled', 'readonly', 'disabled', 'inert', 'form', 'action', 'contenteditable', 'spellcheck', 'data-purpose'] });
    }
    this.scan();
    const current = findEditable(document.activeElement);
    if (current) this.focus(current);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('focusin', this.onFocusIn, true);
    document.removeEventListener('focusout', this.onFocusOut, true);
    document.removeEventListener('mousedown', this.onDocMouseDown, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.observer?.disconnect();
    this.observer = null;
    window.clearTimeout(this.scanTimer);
    window.clearTimeout(this.blurTimer);
    for (const state of [...this.fields.values()]) this.unregister(state);
    this.focused = null;
    window.clearTimeout(this.popupTimer);
    this.notice?.remove(); this.notice = null; this.undo = null;
    this.closeCard();
    this.overlay.clearFields();
  }

  /** Settings changed (categories, dictionary, dialect): check everything again. */
  recheck() {
    if (!this.active) return;
    this.loadPreferences();
    let i = 0;
    for (const state of this.fields.values()) this.requestLint(state, i++ * STAGGER_MS);
  }

  private loadPreferences() {
    void send({ type: 'get-settings' }).then((res) => {
      if (res.ok) this.settings = res.data;
    });
  }

  /** The focused field, or the last one that was (for "Use text from page field"). */
  get currentField(): Editable | null {
    const f = this.focused ?? this.lastField;
    return f && f.isConnected ? f : null;
  }

  private guard<A extends unknown[]>(fn: (...args: A) => void) {
    return (...args: A) => {
      try {
        fn(...args);
      } catch (e) {
        console.warn('Grammaid: handler failed', e);
      }
    };
  }

  // ---- discovering fields ---------------------------------------------------------------------

  private queueScan(delay: number) {
    window.clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(this.guard(() => this.scan()), delay);
  }

  /** Registers fields that appeared and forgets fields that left the page. */
  private scan() {
    if (!this.active) return;
    for (const state of [...this.fields.values()]) {
      if (!state.el.isConnected || !isFreeText(state.el)) this.unregister(state);
    }
    let fresh = 0;
    for (const el of findFields(document, MAX_FIELDS)) {
      if (this.fields.has(el)) continue;
      if (this.fields.size >= MAX_FIELDS) break;
      this.register(el, fresh++ * STAGGER_MS);
    }
  }

  private register(el: Editable, delay: number): FieldState {
    const existing = this.fields.get(el);
    if (existing) return existing;
    const read = readField(el);
    const state: FieldState = { el, text: read.text, map: read.map, issues: [], timer: 0, seq: 0, listeners: [], composing: false, dirty: false };
    const on = (type: string, fn: EventListener, options?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, options);
      state.listeners.push([type, fn, options]);
    };
    on('input', this.guard((e: Event) => this.onInput(state, e as InputEvent)));
    on('compositionstart', this.guard(() => { state.composing = true; state.seq++; window.clearTimeout(state.timer); this.closeCard(); }));
    on('compositionend', this.guard(() => { state.composing = false; this.onInput(state); }));
    on('mousemove', this.guard((e: Event) => {
      const m = e as MouseEvent;
      const issue = this.overlay.hitTest(el, m.clientX, m.clientY);
      this.overlay.setHover(issue);
      if (issue === this.hoveredIssue) return;
      this.hoveredIssue = issue;
      window.clearTimeout(this.popupTimer);
      if (issue && this.settings.suggestionPopups) this.queuePopup(state, issue, 300);
    }));
    on('mouseleave', this.guard(() => { this.overlay.setHover(null); this.hoveredIssue = null; window.clearTimeout(this.popupTimer); }));
    on('click', this.guard((e: Event) => {
      const m = e as MouseEvent;
      const issue = this.overlay.hitTest(el, m.clientX, m.clientY);
      if (issue) this.openCard(state, issue);
    }));
    on('scroll', this.overlay.schedule, { passive: true });
    this.fields.set(el, state);
    this.requestLint(state, delay);
    return state;
  }

  private unregister(state: FieldState) {
    window.clearTimeout(state.timer);
    state.seq++;
    for (const [type, fn, options] of state.listeners) state.el.removeEventListener(type, fn, options);
    state.listeners = [];
    this.fields.delete(state.el);
    this.overlay.removeField(state.el);
    if (this.focused === state.el) this.focused = null;
  }

  // ---- focus: only decides where the pill sits ------------------------------------------------

  private focus(el: Editable) {
    // A field can gain focus before the next scan has seen it (just created, or was hidden).
    const state = this.fields.get(el) ?? (this.fields.size < MAX_FIELDS ? this.register(el, 60) : null);
    if (!state) return;
    this.focused = el;
    this.lastField = el;
    this.overlay.setPill(el, state.issues.length, this.openSidebar);
  }

  private onFocusIn = this.guard((e: FocusEvent) => {
    if (this.overlay.owns(e.target)) return;
    window.clearTimeout(this.blurTimer);
    const el = findEditable(e.target);
    if (el === this.focused) return;
    if (el) this.focus(el);
    else this.blur();
  });

  private onFocusOut = this.guard((_e: FocusEvent) => {
    window.clearTimeout(this.blurTimer);
    this.blurTimer = window.setTimeout(
      this.guard(() => {
        const active = document.activeElement;
        if (this.overlay.owns(active)) return; // focus moved into our card
        if (this.focused && (active === this.focused || this.focused.contains(active))) return;
        this.blur();
      }),
      BLUR_GRACE_MS,
    );
  });

  /** Underlines stay when a field loses focus; only the pill and the card go. */
  private blur() {
    this.focused = null;
    this.closeCard();
    this.overlay.setPill(null);
  }

  private onDocMouseDown = this.guard((e: MouseEvent) => {
    // Events from inside our shadow root are retargeted to the host.
    if (!this.overlay.owns(e.target)) this.overlay.closeSurface();
  });

  /** Closes the suggestion card, leaving any other popover (synonyms, rephrase) alone. */
  private closeCard() {
    window.clearTimeout(this.popupTimer);
    if (this.card && this.overlay.surfaceEl === this.card) this.overlay.closeSurface();
    this.card = null;
  }

  // ---- linting --------------------------------------------------------------------------------

  private show(state: FieldState) {
    this.overlay.setFieldIssues(state.el, state.issues, state.map);
    if (this.focused === state.el) this.overlay.setPill(state.el, state.issues.length, this.openSidebar);
  }

  private onInput(state: FieldState, event?: InputEvent) {
    if (this.applying) return;
    if (!isFreeText(state.el)) { this.unregister(state); return; }
    state.dirty = !isTypingField(state.el) && event?.inputType !== 'historyUndo' && event?.inputType !== 'historyRedo';
    if (this.undo?.state === state) { this.undo = null; this.notice?.remove(); this.notice = null; }
    const read = readField(state.el);
    // Keep existing underlines attached to their words until the fresh lint arrives.
    state.issues = shiftIssues(state.issues, state.text, read.text);
    state.text = read.text;
    state.map = read.map;
    this.closeCard();
    this.show(state);
    if (!state.composing) this.requestLint(state, LINT_DEBOUNCE_MS);
  }

  private requestLint(state: FieldState, delay: number) {
    window.clearTimeout(state.timer);
    const seq = ++state.seq; // anything still in flight for this field is now stale
    state.timer = window.setTimeout(() => void this.lint(state, seq), delay);
  }

  private async lint(state: FieldState, seq: number) {
    if (!isFreeText(state.el)) { this.unregister(state); return; }
    if (!this.active || !state.el.isConnected || state.composing) return;
    const read = readField(state.el);
    state.text = read.text;
    state.map = read.map;
    if (!read.text.trim()) {
      state.issues = [];
      this.show(state);
      return;
    }
    const res = await send({ type: 'lint', text: read.text.slice(0, MAX_LINT_CHARS) });
    if (!this.active || seq !== state.seq || !this.fields.has(state.el) || !isFreeText(state.el)) return; // typed on, gone, or now sensitive
    if (!res.ok) return; // keep whatever is shown; the next edit retries
    if (state.dirty && this.focused === state.el) {
      const preferences = await send({ type: 'get-settings' });
      if (!this.active || seq !== state.seq || state.composing || !this.fields.has(state.el)) return;
      if (!preferences.ok) return;
      this.settings = preferences.data;
    }
    if (readField(state.el).text !== read.text) {
      // Changed without an input event (a script set the value): check the new text instead.
      this.requestLint(state, LINT_DEBOUNCE_MS);
      return;
    }
    state.issues = res.data.filter((issue) => !this.ignored.has(ignoreKey(read.text, issue)));
    if (this.settings.autoCorrect && state.dirty && this.focused === state.el && !state.composing && !isTypingField(state.el)) {
      const selection = fieldSelection(state.el);
      const edits = automaticEdits(read.text, state.issues, this.settings.autoCorrectStyle, selection);
      state.dirty = false;
      if (edits.length) {
        this.applying = true;
        let applied: Edit[];
        try { applied = applyEdits(state.el, edits, selection); }
        finally { this.applying = false; }
        if (applied.length) {
          const fresh = readField(state.el);
          this.undo = { state, after: fresh.text, edits: applied, selection };
          state.issues = shiftIssues(state.issues, state.text, fresh.text);
          state.text = fresh.text; state.map = fresh.map;
          this.show(state); this.showUndo(applied.length);
          this.requestLint(state, 100);
          return;
        }
      }
    }
    this.show(state);
    if (state.dirty && this.focused === state.el && this.settings.suggestionPopups && !this.overlay.surfaceEl) {
      const caret = fieldSelection(state.el)?.end;
      const issue = caret === undefined ? undefined : [...state.issues].reverse().find((i) => i.end <= caret && caret - i.end < 60);
      if (issue) this.queuePopup(state, issue, 220);
    }
  }

  private queuePopup(state: FieldState, issue: Issue, delay: number) {
    window.clearTimeout(this.popupTimer);
    this.popupTimer = window.setTimeout(() => {
      if (!this.active || state.composing || isTypingField(state.el) || !state.issues.includes(issue) || readField(state.el).text !== state.text) return;
      if (this.overlay.surfaceEl && this.overlay.surfaceEl !== this.card) return;
      this.openCard(state, issue, false);
    }, delay);
  }
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.closeCard();
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'z' && this.undo) {
      event.preventDefault(); event.stopPropagation(); this.undoLatest();
    }
  };
  private showUndo(count: number) {
    this.notice?.remove();
    this.notice = h('div', { class: 'auto-notice', role: 'status' },
      h('span', {}, `${count} ${count === 1 ? 'correction' : 'corrections'} applied`),
      h('button', { type: 'button', onClick: () => this.undoLatest() }, 'Undo'),
      h('button', { type: 'button', 'aria-label': 'Dismiss correction notice', onClick: () => { this.notice?.remove(); this.notice = null; } }, '×'));
    this.notice.addEventListener('mousedown', (event) => event.preventDefault());
    this.overlay.addFloating(this.notice);
  }
  private undoLatest() {
    const undo = this.undo;
    if (!undo) return;
    if (!undo.state.el.isConnected || readField(undo.state.el).text !== undo.after) {
      this.overlay.toast('The text changed. Use your editor’s undo instead.'); return;
    }
    this.applying = true;
    try { applyEdits(undo.state.el, inverseEdits(undo.edits), fieldSelection(undo.state.el)); restoreFieldSelection(undo.state.el, undo.selection); }
    finally { this.applying = false; }
    this.undo = null; this.notice?.remove(); this.notice = null;
    const fresh = readField(undo.state.el);
    undo.state.text = fresh.text; undo.state.map = fresh.map; undo.state.dirty = false;
    this.requestLint(undo.state, 80);
  }

  private openSidebar = () => {
    void send({ type: 'open-sidebar' }).then((res) => {
      if (!res.ok || !res.data.opened) this.overlay.toast('Press Alt+Shift+G to open the Grammaid sidebar');
    });
  };

  // ---- suggestion card ------------------------------------------------------------------------

  private openCard(state: FieldState, issue: Issue, takeFocus = true) {
    const el = state.el;
    const anchor = this.overlay.anchorOf(issue, el);
    if (!anchor) return;
    const problem = state.text.slice(issue.start, issue.end);
    const close = () => {
      this.overlay.closeSurface();
      el.focus({ preventScroll: true });
    };
    const card = buildCard(issue, problem, {
      close,
      apply: (replacement) => {
        this.overlay.closeSurface();
        const ok = applyReplacement(el, issue.start, issue.end, replacement);
        if (!ok) {
          this.overlay.toast('Grammaid could not change this field. Try editing it by hand.');
          return;
        }
        // Count the fix only once the text really changed.
        if (issue.kind === 'spelling' && replacement) {
          void send({ type: 'spelling-accepted', typo: problem, correction: replacement });
        }
        // Editors that swallow input events still get a fresh check.
        if (this.fields.has(el)) this.onInput(state);
        this.requestLint(state, 80);
      },
      addToDictionary: () => {
        close();
        // The settings change that follows rechecks every field.
        void send({ type: 'add-word', word: problem });
      },
      ignore: () => {
        const key = ignoreKey(state.text, issue);
        this.ignored.add(key);
        // The same word under the same rule is ignored in every field for this session.
        for (const s of this.fields.values()) {
          s.issues = s.issues.filter((i) => ignoreKey(s.text, i) !== key);
          this.show(s);
        }
        close();
      },
    });
    this.overlay.setHover(null);
    this.card = card;
    this.overlay.openSurface(card, anchor);
    if (takeFocus) card.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }
}
