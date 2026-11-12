// Watches the focused editable field: lints it after typing pauses, keeps underlines glued to
// the text while typing, and opens the suggestion card when an underline is clicked.
import { send, type Issue } from '../shared/types';
import { LINT_DEBOUNCE_MS, MAX_LINT_CHARS, isSiteDisabled, type Settings } from '../shared/settings';
import { applyReplacement } from './apply';
import { buildCard } from './card';
import type { Overlay } from './overlay';
import { editingHost, isTextControl, readField, type Editable, type TextMap } from './textmap';

const BLUR_GRACE_MS = 250;

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

export class FieldWatcher {
  private field: Editable | null = null;
  private lastField: Editable | null = null;
  private text = '';
  private map: TextMap | null = null;
  private issues: Issue[] = [];
  private timer = 0;
  private blurTimer = 0;
  private seq = 0;
  private ignored = new Set<string>();
  private settings: Settings;
  private active = false;
  private card: HTMLElement | null = null;

  constructor(
    private overlay: Overlay,
    settings: Settings,
  ) {
    this.settings = settings;
  }

  start() {
    if (this.active) return;
    this.active = true;
    document.addEventListener('focusin', this.onFocusIn, true);
    document.addEventListener('focusout', this.onFocusOut, true);
    document.addEventListener('mousedown', this.onDocMouseDown, true);
    // A field may already have focus when the script loads.
    const current = findEditable(document.activeElement);
    if (current) this.attach(current);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('focusin', this.onFocusIn, true);
    document.removeEventListener('focusout', this.onFocusOut, true);
    document.removeEventListener('mousedown', this.onDocMouseDown, true);
    this.detach();
  }

  updateSettings(settings: Settings) {
    this.settings = settings;
    if (this.field) this.requestLint(0);
  }

  get enabledHere(): boolean {
    return this.settings.enabled && !isSiteDisabled(this.settings, location.hostname);
  }

  /** The field being checked, or the last one that was (for "Use text from page field"). */
  get currentField(): Editable | null {
    const f = this.field ?? this.lastField;
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

  private onFocusIn = this.guard((e: FocusEvent) => {
    if (this.overlay.owns(e.target)) return;
    window.clearTimeout(this.blurTimer);
    const el = this.enabledHere ? findEditable(e.target) : null;
    if (el === this.field) return;
    if (el) this.attach(el);
    else this.detach();
  });

  private onFocusOut = this.guard((_e: FocusEvent) => {
    window.clearTimeout(this.blurTimer);
    this.blurTimer = window.setTimeout(
      this.guard(() => {
        const active = document.activeElement;
        if (this.overlay.owns(active)) return; // focus moved into our card
        if (this.field && (active === this.field || this.field.contains(active))) return;
        this.detach();
      }),
      BLUR_GRACE_MS,
    );
  });

  private onDocMouseDown = this.guard((e: MouseEvent) => {
    // Composed path: events from inside our shadow root are retargeted to the host.
    if (!this.overlay.owns(e.target)) this.overlay.closeSurface();
  });

  private attach(el: Editable) {
    this.detach();
    this.field = el;
    this.lastField = el;
    this.overlay.setField(el);
    el.addEventListener('input', this.onInput);
    el.addEventListener('mousemove', this.onMouseMove as EventListener);
    el.addEventListener('mouseleave', this.onMouseLeave);
    el.addEventListener('click', this.onClick as EventListener);
    el.addEventListener('scroll', this.overlay.schedule, { passive: true });
    const read = readField(el);
    this.text = read.text;
    this.map = read.map;
    this.requestLint(60);
  }

  private detach() {
    const el = this.field;
    window.clearTimeout(this.timer);
    this.seq++;
    if (el) {
      el.removeEventListener('input', this.onInput);
      el.removeEventListener('mousemove', this.onMouseMove as EventListener);
      el.removeEventListener('mouseleave', this.onMouseLeave);
      el.removeEventListener('click', this.onClick as EventListener);
      el.removeEventListener('scroll', this.overlay.schedule);
    }
    this.field = null;
    this.issues = [];
    this.closeCard();
    this.overlay.setField(null);
  }

  /** Closes the suggestion card, leaving any other popover (synonyms, rephrase) alone. */
  private closeCard() {
    if (this.card && this.overlay.surfaceEl === this.card) this.overlay.closeSurface();
    this.card = null;
  }

  private onInput = this.guard(() => {
    const el = this.field;
    if (!el) return;
    const read = readField(el);
    // Keep existing underlines attached to their words until the fresh lint arrives.
    this.issues = shiftIssues(this.issues, this.text, read.text);
    this.text = read.text;
    this.map = read.map;
    this.closeCard();
    this.overlay.setIssues(this.issues, this.map);
    this.overlay.setPill(this.issues.length, this.openSidebar);
    this.requestLint(LINT_DEBOUNCE_MS);
  });

  private onMouseMove = this.guard((e: MouseEvent) => {
    this.overlay.setHover(this.overlay.hitTest(e.clientX, e.clientY));
  });

  private onMouseLeave = this.guard(() => this.overlay.setHover(-1));

  private onClick = this.guard((e: MouseEvent) => {
    const index = this.overlay.hitTest(e.clientX, e.clientY);
    const issue = this.overlay.issueAt(index);
    if (issue) this.openCard(issue);
  });

  private requestLint(delay: number) {
    window.clearTimeout(this.timer);
    const seq = ++this.seq; // anything still in flight is now stale
    this.timer = window.setTimeout(() => void this.lint(seq), delay);
  }

  private async lint(seq: number) {
    const el = this.field;
    if (!el || !this.enabledHere) {
      if (el) this.overlay.setIssues([], null);
      return;
    }
    const read = readField(el);
    this.text = read.text;
    this.map = read.map;
    const res = await send({ type: 'lint', text: read.text.slice(0, MAX_LINT_CHARS) });
    if (seq !== this.seq || el !== this.field) return; // the user kept typing or moved on
    if (!res.ok) return; // keep whatever is shown; the next edit retries
    if (readField(el).text !== read.text) return; // changed without an input event; next lint catches up
    this.issues = res.data.filter((issue) => !this.ignored.has(ignoreKey(read.text, issue)));
    this.overlay.setIssues(this.issues, this.map);
    this.overlay.setPill(this.issues.length, this.openSidebar);
  }

  private openSidebar = () => {
    void send({ type: 'open-sidebar' }).then((res) => {
      if (!res.ok || !res.data.opened) this.overlay.toast('Press Alt+Shift+G to open the Grammaid sidebar');
    });
  };

  private openCard(issue: Issue) {
    const el = this.field;
    const anchor = this.overlay.anchorOf(issue);
    if (!el || !anchor) return;
    const problem = this.text.slice(issue.start, issue.end);
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
        if (this.field === el) this.onInput();
        this.requestLint(80);
      },
      addToDictionary: () => {
        close();
        void send({ type: 'add-word', word: problem }).then(() => this.requestLint(0));
      },
      ignore: () => {
        this.ignored.add(ignoreKey(this.text, issue));
        this.issues = this.issues.filter((i) => ignoreKey(this.text, i) !== ignoreKey(this.text, issue));
        this.overlay.setIssues(this.issues, this.map);
        this.overlay.setPill(this.issues.length, this.openSidebar);
        close();
      },
    });
    this.overlay.setHover(-1);
    this.card = card;
    this.overlay.openSurface(card, anchor);
    card.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }
}
