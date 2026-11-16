import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Settings } from '../../src/sidebar/tabs/Settings';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
let root: HTMLDivElement;
const message = vi.fn(async (request: { type: string; patch?: object }) => ({ ok: true, data: { ...DEFAULT_SETTINGS, ...request.patch } }));
beforeEach(() => { message.mockClear(); root = document.createElement('div'); document.body.append(root); vi.stubGlobal('browser', { runtime: { sendMessage: message }, storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } }); });
afterEach(() => { act(() => render(null, root)); root.remove(); vi.unstubAllGlobals(); });
it('saves activation mode in the standalone page without targeting the settings tab for checking', async () => {
  await act(async () => { render(h(Settings, { active: true, standalone: true, status: null, refreshStatus: vi.fn() }), root); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(message.mock.calls.map(([request]) => request.type)).toEqual(['get-settings']);
  expect(root.textContent).not.toContain('Turn on in this tab'); expect(root.textContent).toContain('never captures your screen');
  const select = root.querySelector<HTMLSelectElement>('select[aria-label="Activation mode"]')!;
  await act(async () => { select.value = 'sites'; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
  expect(message).toHaveBeenCalledWith({ type: 'set-settings', patch: { activationMode: 'sites' } });
});
