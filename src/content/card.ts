// The suggestion card shown when an underline is clicked.
import type { Issue } from '../shared/types';
import { h } from './ui';

export interface CardActions {
  apply(replacement: string): void;
  addToDictionary(): void;
  ignore(): void;
  close(): void;
}

const KIND_LABEL: Record<Issue['kind'], string> = { spelling: 'Spelling', grammar: 'Grammar', style: 'Style' };

/** Keeps Tab inside `container` and maps Escape to `onEscape`. */
export function trapKeys(container: HTMLElement, onEscape: () => void) {
  container.addEventListener('keydown', (e) => {
    e.stopPropagation(); // the page must not react to keys typed into Grammaid's UI
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled])'));
    if (items.length === 0) return;
    const root = container.getRootNode() as ShadowRoot | Document;
    const index = items.indexOf(root.activeElement as HTMLElement);
    const next = e.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : index === items.length - 1 ? 0 : index + 1;
    e.preventDefault();
    items[next].focus();
  });
}

export function buildCard(issue: Issue, problemText: string, actions: CardActions): HTMLElement {
  const fixes = issue.suggestions.slice(0, 5).map((s) =>
    h(
      'button',
      {
        class: 'fix',
        type: 'button',
        'aria-label': s === '' ? `Remove "${problemText}"` : `Replace with "${s}"`,
        onClick: () => actions.apply(s),
      },
      s === '' ? 'Remove' : s,
    ),
  );

  const card = h(
    'div',
    { class: 'card', role: 'dialog', 'aria-label': `${KIND_LABEL[issue.kind]} suggestion` },
    h('div', { class: 'kind' }, h('span', { class: issue.kind === 'style' ? 'dot style' : 'dot' }), issue.rule === KIND_LABEL[issue.kind] ? issue.rule : `${KIND_LABEL[issue.kind]} · ${issue.rule}`),
    h('p', { class: 'msg' }, issue.message),
    fixes.length > 0 && h('div', { class: 'row' }, ...fixes),
    h('div', { class: 'sep' }),
    h(
      'div',
      { class: 'foot' },
      issue.kind === 'spelling'
        ? h('button', { class: 'quiet', type: 'button', onClick: () => actions.addToDictionary() }, 'Add to dictionary')
        : h('span'),
      h('button', { class: 'quiet', type: 'button', onClick: () => actions.ignore() }, 'Ignore this'),
    ),
  );
  trapKeys(card, () => actions.close());
  // Pressing inside the card must not move the page's selection or blur-close anything.
  card.addEventListener('mousedown', (e) => {
    if (!(e.target instanceof HTMLButtonElement)) e.preventDefault();
  });
  return card;
}
