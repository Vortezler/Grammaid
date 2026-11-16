import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Translate } from '../../src/sidebar/tabs/Translate';
import { TRANSLATION_LANGUAGES, type TranslationPackStatus } from '../../src/shared/translation';
let root: HTMLDivElement;
let packs: TranslationPackStatus[];
const message = vi.fn(async (request: { type: string; language?: string }) => {
  if (request.type === 'translation-packs') return { ok: true, data: packs };
  if (request.type === 'translation-download') packs = packs.map((p) => p.language === request.language ? { ...p, state: 'ready' } : p);
  if (request.type === 'translate') return { ok: true, data: { text: 'Hola.', source: 'en', target: 'es', viaEnglish: false } };
  return { ok: true, data: null };
});
beforeEach(() => {
  packs = TRANSLATION_LANGUAGES.map((l) => ({ language: l.code, state: l.code === 'en' ? 'ready' : 'missing', bytes: 1000000, downloadBytes: 1000000, shared: false }));
  root = document.createElement('div'); document.body.append(root); message.mockClear();
  vi.stubGlobal('browser', { runtime: { sendMessage: message } });
});
afterEach(() => { act(() => render(null, root)); root.remove(); vi.unstubAllGlobals(); });
const click = async (label: string) => {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;
  await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });
};
describe('local translator sidebar', () => {
  it('offers a selected pack, sends no text on edit, and renders a local result', async () => {
    await act(() => render(h(Translate, { active: true }), root));
    await act(async () => { await Promise.resolve(); });
    expect(root.textContent).toContain('Get ready to translate');
    await click('Get ·');
    const textarea = root.querySelector('textarea')!;
    await act(() => { textarea.value = 'Hello.'; textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(message.mock.calls.filter(([r]) => r.type === 'translate')).toHaveLength(0);
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Translate')!;
    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(message).toHaveBeenCalledWith({ type: 'translate', text: 'Hello.', source: 'en', target: 'es' });
    expect(root.textContent).toContain('Hola.');
    expect(root.textContent).not.toContain('new tab');
  });
});
