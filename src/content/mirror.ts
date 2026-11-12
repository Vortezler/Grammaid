// Measures where text sits inside a <textarea>/<input>, which expose no geometry of their own.
// A hidden "mirror" div copies the control's text styles; spans inside it stand in for ranges.
import type { TextControl } from './textmap';

export interface LocalRect {
  /** Relative to the control's border-box origin, with scroll position NOT yet subtracted. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const COPIED = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'fontKerning',
  'fontFeatureSettings', 'fontVariationSettings', 'lineHeight', 'letterSpacing', 'wordSpacing',
  'textTransform', 'textIndent', 'textAlign', 'textRendering', 'tabSize', 'direction',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
] as const;

export class Mirror {
  private div: HTMLDivElement;

  constructor(container: ShadowRoot | HTMLElement) {
    const doc = container.ownerDocument ?? document;
    this.div = doc.createElement('div');
    const s = this.div.style;
    s.position = 'absolute';
    s.top = '0';
    s.left = '-99999px';
    s.visibility = 'hidden';
    s.pointerEvents = 'none';
    s.overflow = 'hidden';
    s.borderStyle = 'solid';
    s.borderColor = 'transparent';
    s.boxSizing = 'content-box';
    s.margin = '0';
    container.appendChild(this.div);
  }

  /** Rectangles for each [start, end) range of the control's value; one array per range. */
  measure(el: TextControl, ranges: { start: number; end: number }[]): LocalRect[][] {
    const view = el.ownerDocument.defaultView;
    if (!view || ranges.length === 0) return ranges.map(() => []);
    const cs = view.getComputedStyle(el);
    const s = this.div.style;
    for (const prop of COPIED) s[prop] = cs[prop];
    const isArea = el.tagName === 'TEXTAREA';
    s.whiteSpace = isArea ? 'pre-wrap' : 'pre';
    s.overflowWrap = isArea ? 'break-word' : 'normal';
    s.wordBreak = isArea ? cs.wordBreak : 'normal';
    const px = (v: string) => parseFloat(v) || 0;
    // clientWidth excludes a vertical scrollbar, so wrapping matches what the user sees.
    const contentWidth = el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
    s.width = isArea ? `${Math.max(0, contentWidth)}px` : 'auto';
    s.height = 'auto';

    const text = el.value;
    const doc = this.div.ownerDocument;
    const frag = doc.createDocumentFragment();
    const spans: (HTMLSpanElement | null)[] = [];
    let pos = 0;
    // Ranges arrive sorted and non-overlapping; anything else is skipped rather than mis-measured.
    for (const r of ranges) {
      if (r.start < pos || r.end <= r.start || r.end > text.length) {
        spans.push(null);
        continue;
      }
      if (r.start > pos) frag.appendChild(doc.createTextNode(text.slice(pos, r.start)));
      const span = doc.createElement('span');
      span.textContent = text.slice(r.start, r.end);
      frag.appendChild(span);
      spans.push(span);
      pos = r.end;
    }
    // Trailing text matters for right/center aligned controls and for the last wrapped line.
    frag.appendChild(doc.createTextNode(text.slice(pos) + '​'));
    this.div.replaceChildren(frag);

    const origin = this.div.getBoundingClientRect();
    // Single-line inputs centre their text vertically; the mirror is top-aligned.
    let dy = 0;
    if (!isArea) {
      const inner = el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
      const line = this.div.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
      dy = Math.max(0, (inner - line) / 2);
    }
    const out = spans.map((span) => {
      if (!span) return [];
      return Array.from(span.getClientRects())
        .filter((r) => r.width > 0)
        .map((r) => ({ x: r.left - origin.left, y: r.top - origin.top + dy, width: r.width, height: r.height }));
    });
    this.div.replaceChildren();
    return out;
  }
}
