import { beforeEach, describe, expect, it } from 'vitest';
import { buildTextMap, editingHost, isTextControl, offsetFromPosition, rangeFromOffsets, readField } from '../../src/content/textmap';
import { applyReplacement } from '../../src/content/apply';
import { findEditable, shiftIssues } from '../../src/content/field-watcher';
import { trimRange } from '../../src/content/selection-actions';
import type { Issue } from '../../src/shared/types';

function editable(html: string): HTMLElement {
  const div = document.createElement('div');
  div.setAttribute('contenteditable', 'true');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('buildTextMap', () => {
  it('concatenates text nodes across nested inline elements', () => {
    const map = buildTextMap(editable('Hello <b>bold <i>and italic</i></b> world'));
    expect(map.text).toBe('Hello bold and italic world');
    expect(map.segments).toHaveLength(4);
  });

  it('inserts newlines for <br> and block boundaries', () => {
    expect(buildTextMap(editable('one<br>two')).text).toBe('one\ntwo');
    expect(buildTextMap(editable('<p>first</p><p>second</p>')).text).toBe('first\nsecond\n');
    expect(buildTextMap(editable('lead<div>inner</div>tail')).text).toBe('lead\ninner\ntail');
  });

  it('skips non-editable islands and script/style', () => {
    const map = buildTextMap(editable('keep <span contenteditable="false">skip</span><style>x{}</style> this'));
    expect(map.text).toBe('keep  this');
  });
});

describe('offset <-> Range round trips', () => {
  const cases: [string, string][] = [
    ['Hello <b>bold <i>and italic</i></b> world', 'italic'],
    ['one<br>two three', 'two'],
    ['<p>first para</p><p>second <em>para</em> here</p>', 'second para'],
    ['a<span>b</span>c<span>d</span>e', 'bcd'],
  ];
  for (const [html, target] of cases) {
    it(`maps "${target}" in ${html}`, () => {
      const map = buildTextMap(editable(html));
      const start = map.text.indexOf(target);
      expect(start).toBeGreaterThanOrEqual(0);
      const range = rangeFromOffsets(map, start, start + target.length);
      expect(range).not.toBeNull();
      expect(range!.toString()).toBe(target);
      expect(offsetFromPosition(map, range!.startContainer, range!.startOffset)).toBe(start);
      expect(offsetFromPosition(map, range!.endContainer, range!.endOffset)).toBe(start + target.length);
    });
  }

  it('maps every single character back to itself', () => {
    const map = buildTextMap(editable('<p>ab <b>cd</b></p><p>ef<br>gh</p>'));
    for (let i = 0; i < map.text.length; i++) {
      if (map.text[i] === '\n') continue;
      expect(rangeFromOffsets(map, i, i + 1)!.toString()).toBe(map.text[i]);
    }
  });

  it('maps element-level positions to the next text offset', () => {
    const root = editable('<p>first</p><p>second</p>');
    const map = buildTextMap(root);
    expect(offsetFromPosition(map, root, 1)).toBe(map.text.indexOf('second'));
    expect(offsetFromPosition(map, root, 2)).toBe(map.text.length);
  });

  it('returns null for an empty map', () => {
    expect(rangeFromOffsets(buildTextMap(editable('')), 0, 1)).toBeNull();
  });
});

describe('field detection', () => {
  const input = (attrs: string) => {
    document.body.innerHTML = `<input ${attrs}>`;
    return document.body.firstElementChild as HTMLInputElement;
  };

  it('accepts text-like controls and rejects the rest', () => {
    expect(isTextControl(document.createElement('textarea'))).toBe(true);
    expect(isTextControl(input('type="text"'))).toBe(true);
    expect(isTextControl(input(''))).toBe(true);
    expect(isTextControl(input('type="search"'))).toBe(true);
    expect(isTextControl(input('type="email"'))).toBe(true);
    for (const type of ['password', 'number', 'url', 'hidden', 'checkbox']) {
      expect(isTextControl(input(`type="${type}"`))).toBe(false);
    }
  });

  it('never returns password, disabled, readonly or spellcheck=false fields', () => {
    expect(findEditable(input('type="password"'))).toBeNull();
    expect(findEditable(input('type="text" disabled'))).toBeNull();
    expect(findEditable(input('type="text" readonly'))).toBeNull();
    expect(findEditable(input('type="text" spellcheck="false"'))).toBeNull();
    expect(findEditable(input('type="text"'))).not.toBeNull();
  });

  it('finds the outermost editing host', () => {
    const root = editable('<p>some <b id="inner">text</b></p>');
    expect(editingHost(document.getElementById('inner'))).toBe(root);
    expect(findEditable(document.getElementById('inner'))).toBe(root);
    expect(editingHost(document.body)).toBeNull();
  });
});

describe('applyReplacement (fallback path; jsdom has no execCommand)', () => {
  it('replaces a range in a textarea and fires a bubbling input event', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.value = 'I definately agree';
    let fired = 0;
    document.body.addEventListener('input', () => fired++);
    expect(applyReplacement(ta, 2, 12, 'definitely')).toBe(true);
    expect(ta.value).toBe('I definitely agree');
    expect(fired).toBe(1);
  });

  it('replaces a range that spans inline elements in a contenteditable', () => {
    const root = editable('I <b>defin</b>ately agree');
    const { text } = readField(root);
    const start = text.indexOf('definately');
    expect(applyReplacement(root, start, start + 10, 'definitely')).toBe(true);
    expect(readField(root).text).toBe('I definitely agree');
  });

  it('supports removing text', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.value = 'the the cat';
    expect(applyReplacement(ta, 0, 4, '')).toBe(true);
    expect(ta.value).toBe('the cat');
  });
});

describe('shiftIssues', () => {
  const issue = (start: number, end: number): Issue => ({ start, end, kind: 'spelling', message: '', suggestions: [], rule: 'r' });

  it('keeps issues before an edit, shifts those after, drops the touched one', () => {
    const before = 'aaa bbb ccc ddd';
    const after = 'aaa bbb XXccc ddd';
    const out = shiftIssues([issue(0, 3), issue(8, 11), issue(12, 15)], before, after);
    expect(out.map((i) => [i.start, i.end])).toEqual([[0, 3], [14, 17]]);
    expect(after.slice(14, 17)).toBe('ddd');
  });

  it('handles deletions and no-ops', () => {
    const list = [issue(0, 3), issue(8, 11)];
    expect(shiftIssues(list, 'aaa bbb ccc', 'aaa bbb ccc')).toBe(list);
    const out = shiftIssues(list, 'aaa bbb ccc', 'aaa ccc');
    expect(out.map((i) => [i.start, i.end])).toEqual([[0, 3], [4, 7]]);
  });
});

describe('shiftIssues adjacency', () => {
  const issue = (start: number, end: number): Issue => ({ start, end, kind: 'spelling', message: '', suggestions: [], rule: 'r' });

  it('drops an issue when typing extends its word, keeps it when a space follows', () => {
    expect(shiftIssues([issue(0, 3)], 'teh', 'tehn')).toEqual([]);
    expect(shiftIssues([issue(0, 3)], 'teh', 'teh ')).toHaveLength(1);
    expect(shiftIssues([issue(4, 7)], 'aaa teh', 'aaa xteh')).toEqual([]);
  });
});

describe('trimRange', () => {
  it('drops surrounding spaces and punctuation', () => {
    const text = 'Say "hello," please.';
    const r = trimRange(text, 3, 12);
    expect(text.slice(r.start, r.end)).toBe('hello');
  });
});
