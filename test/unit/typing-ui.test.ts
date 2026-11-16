import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Type } from '../../src/sidebar/tabs/Type';
import { IDLE_TYPING, type TypingStatus } from '../../src/shared/typing';
let root: HTMLDivElement;
let status: TypingStatus;
let targets = true;
const target = { tabId: 7, frameId: 3, fieldId: 'editor', label: 'Essay', kind: 'editor', frame: 'Embedded frame' };
const message = vi.fn(async (request: { type: string; action?: string }) => {
  if (request.type === 'typing-tabs') return { ok: true, data: [{ tabId: 7, title: 'Draft', host: 'example.com', active: true }] };
  if (request.type === 'typing-targets') return { ok: true, data: targets ? [target] : [] };
  if (request.type === 'typing-start') status = { ...IDLE_TYPING, jobId: 'session', state: 'typing', total: 6, target: { ...target, kind: 'editor' } };
  if (request.type === 'typing-control') status = { ...status, state: request.action === 'pause' ? 'paused' : request.action === 'resume' ? 'typing' : 'stopped' };
  return { ok: true, data: status };
});
beforeEach(() => {
  targets = true; status = { ...IDLE_TYPING }; message.mockClear();
  root = document.createElement('div'); document.body.append(root);
  vi.stubGlobal('browser', { runtime: { sendMessage: message } });
});
afterEach(() => { act(() => render(null, root)); root.remove(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { render(h(Type, { active: true }), root); await Promise.resolve(); }); await act(async () => { await Promise.resolve(); }); }
async function click(label: string) {
  const button = [...root.querySelectorAll('button')].find((button) => button.textContent === label)!;
  await act(async () => { button.click(); await Promise.resolve(); });
}
describe('typing panel', () => {
  it('sends text only on Start and exposes working pause/resume/stop controls', async () => {
    await mount();
    const textarea = root.querySelector('textarea')!;
    await act(() => { textarea.value = 'Hello.'; textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(message.mock.calls.some(([request]) => request.type === 'typing-start')).toBe(false);
    await click('Start typing');
    expect(message).toHaveBeenCalledWith({ type: 'typing-start', target, text: 'Hello.', options: { wordsPerMinute: 45, sentencePauses: true, position: 'caret' } });
    expect(textarea.disabled).toBe(true); expect(root.querySelector<HTMLSelectElement>('#typing-tab')?.disabled).toBe(true);
    await click('Pause'); expect(root.textContent).toContain('Resume');
    await click('Resume'); expect(root.textContent).toContain('Pause');
    await click('Stop'); expect(textarea.disabled).toBe(false); expect(root.textContent).toContain('Start typing');
  });
  it('cannot start without an editable destination', async () => {
    targets = false; await mount();
    expect(root.textContent).toContain('No editable fields found');
    const start = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Start typing')!;
    expect(start.disabled).toBe(true);
  });
});
