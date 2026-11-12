// Text extraction and offset mapping. The string built here is the one that gets linted, so any
// [start, end) range in it can be turned back into a DOM Range (and the other way round).

export type TextControl = HTMLTextAreaElement | HTMLInputElement;
export type Editable = TextControl | HTMLElement;

export interface Segment {
  node: Text;
  start: number;
  end: number;
}

export interface TextMap {
  text: string;
  segments: Segment[];
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR',
  'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL',
]);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON', 'IFRAME', 'SVG', 'CANVAS']);

const ALLOWED_INPUT_TYPES = new Set(['text', 'search', 'email']);

export function isTextControl(el: Element | null): el is TextControl {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  // Read the attribute: unknown types fall back to "text" on the property, and that is fine,
  // but password/number/url/hidden must never be checked.
  return ALLOWED_INPUT_TYPES.has(((el as HTMLInputElement).type || 'text').toLowerCase());
}

/** The outermost contenteditable ancestor of `el` (the editing host), or null. */
export function editingHost(el: Element | null): HTMLElement | null {
  let node: Element | null = el;
  let host: HTMLElement | null = null;
  while (node) {
    const attr = node.getAttribute?.('contenteditable');
    if (attr !== null && attr !== undefined) {
      // An explicitly non-editable ancestor ends the editable region.
      if (attr.toLowerCase() === 'false') break;
      host = node as HTMLElement;
    }
    node = node.parentElement;
  }
  return host;
}

export function buildTextMap(root: HTMLElement): TextMap {
  let text = '';
  const segments: Segment[] = [];
  const newline = () => {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n';
  };

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data;
      if (data.length === 0) return;
      segments.push({ node: node as Text, start: text.length, end: text.length + data.length });
      text += data;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return;
    if (el !== root && el.getAttribute('contenteditable')?.toLowerCase() === 'false') return;
    if (tag === 'BR') {
      text += '\n';
      return;
    }
    const block = el !== root && BLOCK_TAGS.has(tag);
    if (block) newline();
    for (let child = el.firstChild; child; child = child.nextSibling) visit(child);
    if (block) newline();
  };
  visit(root);
  return { text, segments };
}

function locate(map: TextMap, offset: number, preferEnd: boolean): { node: Text; offset: number } | null {
  const segs = map.segments;
  if (segs.length === 0) return null;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].end < offset || (!preferEnd && segs[mid].end === offset)) lo = mid + 1;
    else hi = mid;
  }
  let seg = segs[lo];
  // For a range end sitting exactly on a segment boundary, stay in the earlier node.
  if (preferEnd && offset <= seg.start && lo > 0 && segs[lo - 1].end >= offset) seg = segs[lo - 1];
  const local = Math.max(0, Math.min(seg.node.data.length, offset - seg.start));
  return { node: seg.node, offset: local };
}

/** DOM Range covering text offsets [start, end), or null if the map no longer matches the DOM. */
export function rangeFromOffsets(map: TextMap, start: number, end: number): Range | null {
  const a = locate(map, start, false);
  const b = locate(map, end, true);
  if (!a || !b) return null;
  try {
    const range = a.node.ownerDocument.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return range;
  } catch {
    return null;
  }
}

/** Text offset of a DOM position (as found on a Selection or Range) inside the mapped root. */
export function offsetFromPosition(map: TextMap, node: Node, offset: number): number {
  if (node.nodeType === Node.TEXT_NODE) {
    const seg = map.segments.find((s) => s.node === node);
    if (seg) return seg.start + Math.min(offset, seg.node.data.length);
  }
  // Element position: the offset is that of the first text segment at or after the position.
  const doc = node.ownerDocument ?? (node as Document);
  const probe = doc.createRange();
  try {
    probe.setStart(node, offset);
    probe.collapse(true);
  } catch {
    return map.text.length;
  }
  for (const seg of map.segments) {
    if (probe.comparePoint(seg.node, 0) >= 0) return seg.start;
  }
  return map.text.length;
}

export interface FieldText {
  text: string;
  map: TextMap | null;
}

export function readField(el: Editable): FieldText {
  if (isTextControl(el)) return { text: el.value, map: null };
  const map = buildTextMap(el);
  return { text: map.text, map };
}
