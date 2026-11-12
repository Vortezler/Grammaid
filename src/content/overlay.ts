// One fixed, click-through layer over the page (shadow DOM) holding underlines, the issue pill,
// cards/popovers and toasts. The page's own DOM and text are never modified.
import type { Issue } from '../shared/types';
import { Mirror, type LocalRect } from './mirror';
import { isTextControl, rangeFromOffsets, type Editable, type TextMap } from './textmap';
import { OVERLAY_CSS, h } from './ui';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Painted {
  issue: Issue;
  boxes: Box[];
}

const boxOf = (r: { left: number; top: number; right: number; bottom: number }): Box => ({
  left: r.left,
  top: r.top,
  right: r.right,
  bottom: r.bottom,
});

export class Overlay {
  readonly host: HTMLElement;
  readonly shadow: ShadowRoot;
  private root: HTMLDivElement;
  private lines: HTMLDivElement;
  private highlight: HTMLDivElement;
  private ui: HTMLDivElement;
  private pill: HTMLButtonElement | null = null;
  private toastEl: HTMLDivElement | null = null;
  private toastTimer = 0;
  private mirror: Mirror;
  private pool: HTMLDivElement[] = [];

  private field: Editable | null = null;
  private map: TextMap | null = null;
  private issues: Issue[] = [];
  private local: LocalRect[][] | null = null; // cached geometry for text controls
  private painted: Painted[] = [];
  private hovered = -1;
  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private surface: { el: HTMLElement; onClose?: () => void } | null = null;
  private pillCount: number | null = null;
  private onPill: (() => void) | null = null;

  constructor() {
    this.host = document.createElement('grammaid-overlay');
    // Set through the CSSOM so a strict page CSP (no inline styles) cannot block it.
    const hs = this.host.style;
    hs.setProperty('all', 'initial', 'important');
    hs.setProperty('position', 'fixed', 'important');
    hs.setProperty('inset', '0', 'important');
    hs.setProperty('pointer-events', 'none', 'important');
    hs.setProperty('z-index', '2147483647', 'important');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.installStyles();
    this.lines = h('div', { 'aria-hidden': 'true' });
    this.highlight = h('div', { class: 'hl', 'aria-hidden': 'true' });
    this.ui = h('div');
    this.root = h('div', { class: 'root' }, this.highlight, this.lines, this.ui);
    this.shadow.appendChild(this.root);
    this.mirror = new Mirror(this.shadow);

    window.addEventListener('scroll', this.schedule, { capture: true, passive: true });
    window.addEventListener('resize', this.invalidate, { passive: true });
  }

  private installStyles() {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(OVERLAY_CSS);
      this.shadow.adoptedStyleSheets = [sheet];
      if (this.shadow.adoptedStyleSheets.length === 1) return;
    } catch {
      // older engines, or constructable sheets unavailable to content scripts
    }
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    this.shadow.appendChild(style);
  }

  mount() {
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
  }

  destroy() {
    window.removeEventListener('scroll', this.schedule, { capture: true });
    window.removeEventListener('resize', this.invalidate);
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.toastTimer);
    this.host.remove();
  }

  /** True when focus or an event target is inside Grammaid's own UI. */
  owns(target: EventTarget | null): boolean {
    return target === this.host || (target instanceof Node && this.shadow.contains(target));
  }

  // ---- underlines ---------------------------------------------------------------------------

  setField(field: Editable | null) {
    if (field === this.field) return;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.field = field;
    this.issues = [];
    this.local = null;
    this.map = null;
    this.hovered = -1;
    if (field) {
      this.mount();
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(this.invalidate);
        this.resizeObserver.observe(field);
      }
    } else {
      this.setPill(null);
    }
    this.schedule();
  }

  setIssues(issues: Issue[], map: TextMap | null) {
    this.issues = issues;
    this.map = map;
    this.local = null;
    this.schedule();
  }

  /** Geometry changed (resize, font load): re-measure on the next frame. */
  invalidate = () => {
    this.local = null;
    this.schedule();
  };

  schedule = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      try {
        this.paint();
      } catch (e) {
        console.warn('Grammaid: paint failed', e);
      }
    });
  };

  private clipRect(el: Editable): Box {
    const r = el.getBoundingClientRect();
    const left = r.left + el.clientLeft;
    const top = r.top + el.clientTop;
    return {
      left: Math.max(0, left),
      top: Math.max(0, top),
      right: Math.min(window.innerWidth, left + el.clientWidth),
      bottom: Math.min(window.innerHeight, top + el.clientHeight),
    };
  }

  private measure(): Painted[] {
    const el = this.field;
    if (!el || !el.isConnected || this.issues.length === 0) return [];
    const clip = this.clipRect(el);
    if (clip.right <= clip.left || clip.bottom <= clip.top) return [];
    const visible = (b: Box) => b.right > clip.left && b.left < clip.right && b.bottom > clip.top + 2 && b.bottom <= clip.bottom + 3;
    const trim = (b: Box): Box => ({ ...b, left: Math.max(b.left, clip.left), right: Math.min(b.right, clip.right) });

    if (isTextControl(el)) {
      this.local ??= this.mirror.measure(el, this.issues);
      const origin = el.getBoundingClientRect();
      const ox = origin.left - el.scrollLeft;
      const oy = origin.top - el.scrollTop;
      return this.issues.map((issue, i) => ({
        issue,
        boxes: (this.local?.[i] ?? [])
          .map((r) => ({ left: ox + r.x, top: oy + r.y, right: ox + r.x + r.width, bottom: oy + r.y + r.height }))
          .filter(visible)
          .map(trim),
      }));
    }
    const map = this.map;
    if (!map) return [];
    return this.issues.map((issue) => {
      const range = rangeFromOffsets(map, issue.start, issue.end);
      const boxes = range
        ? Array.from(range.getClientRects())
            .filter((r) => r.width > 0 && r.height > 0)
            .map(boxOf)
            .filter(visible)
            .map(trim)
        : [];
      return { issue, boxes };
    });
  }

  private paint() {
    this.painted = this.measure();
    let used = 0;
    for (const p of this.painted) {
      for (const b of p.boxes) {
        let line = this.pool[used];
        if (!line) {
          line = document.createElement('div');
          this.pool.push(line);
          this.lines.appendChild(line);
        }
        used++;
        line.className = `u ${p.issue.kind}`;
        line.style.display = '';
        line.style.left = `${b.left}px`;
        line.style.top = `${b.bottom - 2}px`;
        line.style.width = `${Math.max(4, b.right - b.left)}px`;
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].style.display = 'none';
    this.paintHover();
    this.paintPill();
  }

  /** Index into the current issues of the underline at this viewport point, or -1. */
  hitTest(x: number, y: number): number {
    for (let i = 0; i < this.painted.length; i++) {
      for (const b of this.painted[i].boxes) {
        if (x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 5) return i;
      }
    }
    return -1;
  }

  issueAt(index: number): Issue | null {
    return this.painted[index]?.issue ?? null;
  }

  /** The on-screen box of an issue (its first line), used to anchor the card. */
  anchorOf(issue: Issue): Box | null {
    return this.painted.find((p) => p.issue === issue)?.boxes[0] ?? null;
  }

  setHover(index: number) {
    if (index === this.hovered) return;
    this.hovered = index;
    this.paintHover();
  }

  private paintHover() {
    const p = this.painted[this.hovered];
    const b = p?.boxes[0];
    if (!p || !b) {
      this.highlight.className = 'hl';
      return;
    }
    const s = this.highlight.style;
    s.left = `${b.left - 1}px`;
    s.top = `${b.top}px`;
    s.width = `${b.right - b.left + 2}px`;
    s.height = `${b.bottom - b.top + 2}px`;
    this.highlight.className = `hl on ${p.issue.kind}`;
  }

  /** Viewport box of a [start, end) range inside a textarea/input (first line), or null. */
  measureControl(el: HTMLTextAreaElement | HTMLInputElement, start: number, end: number): Box | null {
    this.mount();
    const r = this.mirror.measure(el, [{ start, end }])[0]?.[0];
    if (!r) return null;
    const origin = el.getBoundingClientRect();
    const left = origin.left - el.scrollLeft + r.x;
    const top = origin.top - el.scrollTop + r.y;
    return { left, top, right: left + r.width, bottom: top + r.height };
  }

  // ---- pill ---------------------------------------------------------------------------------

  setPill(count: number | null, onClick?: () => void) {
    this.pillCount = count;
    this.onPill = onClick ?? null;
    this.schedule();
  }

  private paintPill() {
    const el = this.field;
    const count = this.pillCount;
    const small = el && isTextControl(el) && el.tagName === 'INPUT';
    if (!el || count === null || !el.isConnected || (small && count === 0)) {
      this.pill?.remove();
      this.pill = null;
      return;
    }
    if (!this.pill) {
      this.pill = h('button', { class: 'pill', type: 'button', onClick: () => this.onPill?.() });
      // Keep focus (and the caret) in the field when the pill is pressed.
      this.pill.addEventListener('mousedown', (e) => e.preventDefault());
      this.ui.appendChild(this.pill);
    }
    const label = count === 0 ? 'No issues found' : `${count} ${count === 1 ? 'issue' : 'issues'} found`;
    this.pill.replaceChildren(h('span', { class: count === 0 ? 'dot teal' : 'dot' }), count === 0 ? '✓' : String(count));
    this.pill.setAttribute('aria-label', `Grammaid: ${label}. Open the sidebar.`);
    this.pill.title = `Grammaid: ${label}`;
    const r = el.getBoundingClientRect();
    const onScreen = r.bottom > 30 && r.top < window.innerHeight && r.right > 60 && r.left < window.innerWidth;
    this.pill.style.display = onScreen ? '' : 'none';
    const scrollbar = el.offsetWidth - el.clientWidth - el.clientLeft * 2;
    const right = Math.min(window.innerWidth, r.right) - 6 - Math.max(0, scrollbar);
    const bottom = Math.min(window.innerHeight, r.bottom) - 6;
    this.pill.style.left = `${right - this.pill.offsetWidth}px`;
    this.pill.style.top = `${small ? r.top + (r.height - this.pill.offsetHeight) / 2 : bottom - this.pill.offsetHeight}px`;
  }

  // ---- surfaces (card, popovers) --------------------------------------------------------------

  /**
   * Shows a floating surface anchored to a box. It grows out of the anchor (transform-origin sits
   * on it) and shrinks back into it when closed, so where it came from stays obvious.
   */
  openSurface(el: HTMLElement, anchor: Box, onClose?: () => void) {
    this.closeSurface(true);
    this.mount();
    el.classList.add('surface');
    this.ui.appendChild(el);
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    const margin = 8;
    const below = anchor.bottom + 8;
    const fitsBelow = below + hgt + margin <= window.innerHeight;
    const top = fitsBelow ? below : Math.max(margin, anchor.top - 8 - hgt);
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - w - margin));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    const ox = Math.max(0, Math.min(w, (anchor.left + anchor.right) / 2 - left));
    el.style.transformOrigin = `${ox}px ${fitsBelow ? 0 : hgt}px`;
    this.surface = { el, onClose };
    // Two frames so the starting state is committed before the transition begins.
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  }

  get surfaceEl(): HTMLElement | null {
    return this.surface?.el ?? null;
  }

  closeSurface(immediate = false) {
    const s = this.surface;
    if (!s) return;
    this.surface = null;
    s.el.classList.remove('open');
    s.el.style.pointerEvents = 'none';
    if (immediate) s.el.remove();
    else window.setTimeout(() => s.el.remove(), 200);
    try {
      s.onClose?.();
    } catch (e) {
      console.warn('Grammaid: close handler failed', e);
    }
  }

  /** A small element (the "Syn" button) placed in the UI layer; the caller positions it. */
  addFloating(el: HTMLElement) {
    this.mount();
    this.ui.appendChild(el);
  }

  toast(message: string, ms = 2600) {
    this.mount();
    if (!this.toastEl) {
      this.toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
      this.ui.appendChild(this.toastEl);
    }
    const el = this.toastEl;
    el.textContent = message;
    requestAnimationFrame(() => el.classList.add('open'));
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('open'), ms);
  }
}
