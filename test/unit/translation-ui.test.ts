import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Translate } from '../../src/sidebar/tabs/Translate';
import { openTranslation } from '../../src/background/translation';

let root: HTMLDivElement;
const message = vi.fn(async () => ({ ok: true, data: { provider: 'Google Translate' } }));
const create = vi.fn(async (_options: { url: string }) => ({}));

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  message.mockClear(); create.mockClear();
  vi.stubGlobal('browser', { runtime: { sendMessage: message }, tabs: { create } });
});
afterEach(() => {
  act(() => render(null, root)); root.remove(); vi.unstubAllGlobals();
});

const change = async (selector: string, value: string, event = 'change') => {
  const el = root.querySelector<HTMLInputElement>(selector)!;
  await act(() => { el.value = value; el.dispatchEvent(new Event(event, { bubbles: true })); });
};
const click = async (text: string) => {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
  await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });
};
const mount = async () => { await act(() => render(h(Translate, { active: true }), root)); };

describe('Translate sidebar', () => {
  it('keeps typing and language changes local; opens only after an explicit click', async () => {
    await mount();
    await change('textarea', 'नमस्ते & hello', 'input');
    await change('[aria-label="Source language"]', 'hi');
    await change('[aria-label="Target language"]', 'fr');
    expect(message).not.toHaveBeenCalled();
    await click('Translate with');
    expect(message).toHaveBeenCalledWith({ type: 'translate-open', text: 'नमस्ते & hello', source: 'hi', target: 'fr' });
    expect(root.textContent).toContain('Opened Google Translate');
  });

  it('does not send text when Firefox declines optional content permission', async () => {
    const request = vi.fn(async () => false);
    vi.stubGlobal('browser', { runtime: { sendMessage: message }, permissions: { getAll: async () => ({ data_collection: [] }), request } });
    await mount();
    await change('textarea', 'Hello', 'input');
    await click('Translate with');
    expect(request).toHaveBeenCalledWith({ data_collection: ['websiteContent'] });
    expect(message).not.toHaveBeenCalled();
    expect(root.textContent).toContain('permission was declined');
  });

  it('guides a cross-provider pair through English without sending the wrong language', async () => {
    await mount();
    await change('[aria-label="Source language"]', 'bodo');
    await change('[aria-label="Target language"]', 'sat');
    await change('textarea', 'Source text', 'input');
    await click('1. Translate');
    expect(message).toHaveBeenLastCalledWith({ type: 'translate-open', text: 'Source text', source: 'bodo', target: 'en' });
    await change('textarea[placeholder="Paste the English result here"]', 'English result', 'input');
    await click('2. Translate');
    expect(message).toHaveBeenLastCalledWith({ type: 'translate-open', text: 'English result', source: 'en', target: 'sat' });
    await change('[aria-label="Target language"]', 'hi');
    expect(root.querySelector('textarea[placeholder="Paste the English result here"]')).toBeNull();
  });
});

describe('background translation handoff', () => {
  it('validates before navigation and enforces revoked content permission', async () => {
    await expect(openTranslation('', 'en', 'hi')).rejects.toThrow('Enter some text');
    expect(create).not.toHaveBeenCalled();
    vi.stubGlobal('browser', { tabs: { create }, permissions: { getAll: async () => ({ data_collection: [] }) } });
    await expect(openTranslation('Hello', 'en', 'hi')).rejects.toThrow('permission');
    expect(create).not.toHaveBeenCalled();
  });

  it('uses a regular browser tab and surfaces navigation failures', async () => {
    const result = await openTranslation('Hello', 'en', 'bodo');
    expect(result.provider).toBe('Bing Translator');
    expect(new URL(create.mock.calls[0][0].url).searchParams.get('text')).toBe('Hello');
    create.mockRejectedValueOnce(new Error('Browser tab unavailable'));
    await expect(openTranslation('Hello', 'en', 'hi')).rejects.toThrow('Browser tab unavailable');
  });
});
