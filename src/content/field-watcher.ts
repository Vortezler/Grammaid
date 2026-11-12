// Checks text fields: lints each one after typing pauses, keeps underlines glued to the text
// while typing, and opens the suggestion card when an underline is clicked.
import { send, type Issue } from '../shared/types';
import { LINT_DEBOUNCE_MS, MAX_LINT_CHARS } from '../shared/settings';
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
    document.addEventListener('focusin', this.onFocusIn, true);
    document.addEventListener('focusout', this.onFocusOut, true);
    document.addEventListener('mousedown', this.onDocMouseDown, true);
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => this.queueScan(SCAN_DEBOUNCE_MS));
      this.observer.observe(document.documentElement, { childList: true, subtree: true });
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
    this.observer?.disconnect();
    this.observer = null;
    window.clearTimeout(this.scanTimer);
    window.clearTimeout(this.blurTimer);
    for (const state of [...this.fields.values()]) this.unregister(state);
    this.focused = null;
    this.closeCard();
    this.overlay.clearFields();
  }

  /** Settings changed (categories, dictionary, dialect): check everything again. */
  recheck() {
    if (!this.active) return;
    let i = 0;
    for (const state of this.fields.values()) this.requestLint(state, i++ * STAGGER_MS);
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
      if (!state.el.isConnected) this.unregister(state);
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
    const state: FieldState = { el, text: read.text, map: read.map, issues: [], timer: 0, seq: 0, listeners: [] };
    const on = (type: string, fn: EventListener, options?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, options);
      state.listeners.push([type, fn, options]);
    };
    on('input', this.guard(() => this.onInput(state)));
    on('mousemove', this.guard((e: Event) => {
      const m = e as MouseEvent;
      this.overlay.setHover(this.overlay.hitTest(el, m.clientX, m.clientY));
    }));
    on('mouseleave', this.guard(() => this.overlay.setHover(null)));
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
    if (this.card && this.overlay.surfaceEl === this.card) this.overlay.closeSurface();
    this.card = null;
  }

  // ---- linting --------------------------------------------------------------------------------

  private show(state: FieldState) {
    this.overlay.setFieldIssues(state.el, state.issues, state.map);
    if (this.focused === state.el) this.overlay.setPill(state.el, state.issues.length, this.openSidebar);
  }

  private onInput(state: FieldState) {
    const read = readField(state.el);
    // Keep existing underlines attached to their words until the fresh lint arrives.
    state.issues = shiftIssues(state.issues, state.text, read.text);
    state.text = read.text;
    state.map = read.map;
    this.closeCard();
    this.show(state);
    this.requestLint(state, LINT_DEBOUNCE_MS);
  }

  private requestLint(state: FieldState, delay: number) {
    window.clearTimeout(state.timer);
    const seq = ++state.seq; // anything still in flight for this field is now stale
    state.timer = window.setTimeout(() => void this.lint(state, seq), delay);
  }

  private async lint(state: FieldState, seq: number) {
    if (!this.active || !state.el.isConnected) return;
    const read = readField(state.el);
    state.text = read.text;
    state.map = read.map;
    if (!read.text.trim()) {
      state.issues = [];
      this.show(state);
      return;
    }
    const res = await send({ type: 'lint', text: read.text.slice(0, MAX_LINT_CHARS) });
    if (!this.active || seq !== state.seq || !this.fields.has(state.el)) return; // typed on, or gone
    if (!res.ok) return; // keep whatever is shown; the next edit retries
    if (readField(state.el).text !== read.text) {
      // Changed without an input event (a script set the value): check the new text instead.
      this.requestLint(state, LINT_DEBOUNCE_MS);
      return;
    }
    state.issues = res.data.filter((issue) => !this.ignored.has(ignoreKey(read.text, issue)));
    this.show(state);
  }

  private openSidebar = () => {
    void send({ type: 'open-sidebar' }).then((res) => {
      if (!res.ok || !res.data.opened) this.overlay.toast('Press Alt+Shift+G to open the Grammaid sidebar');
    });
  };

  // ---- suggestion card ------------------------------------------------------------------------

  private openCard(state: FieldState, issue: Issue) {
    const el = state.el;
    const anchor = this.overlay.anchorOf(issue);
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
    card.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }
}
