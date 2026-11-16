import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { TypingCoordinator } from '../../src/background/typing';
import { DEFAULT_TYPING_OPTIONS, type TypingStatus, type TypingTarget } from '../../src/shared/typing';
import type { ContentRequest } from '../../src/shared/types';

let coordinator: TypingCoordinator;
let status: TypingStatus | null;
let navigate: (tabId: number, change: { status: string }) => void;
const sendMessage = vi.fn(async (_tabId: number, request: ContentRequest, _options?: { frameId: number }) => {
  if (request.type === 'typing-discover') {
    coordinator.reportTargets(request.nonce, [{ fieldId: 'main', label: 'Main', kind: 'textarea' }], 'Main page', { tab: { id: 7 }, frameId: 0 });
    coordinator.reportTargets(request.nonce, [{ fieldId: 'embedded', label: 'Frame', kind: 'editor' }], 'Embedded', { tab: { id: 7 }, frameId: 4 });
    coordinator.reportTargets(request.nonce, [{ fieldId: 'wrong', label: 'Wrong tab', kind: 'textarea' }], 'Page', { tab: { id: 8 }, frameId: 0 });
    return true;
  }
  if (request.type === 'typing-start-in-field') { status = { jobId: request.jobId, state: 'typing', written: 0, total: 4, sequence: 1, message: 'Typing' }; return { ...status }; }
  if (request.type === 'typing-get-state') return status;
  if (request.type === 'typing-control-in-field' && status) {
    status = { ...status, state: request.action === 'pause' ? 'paused' : request.action === 'resume' ? 'typing' : 'stopped', sequence: status.sequence + 1 };
    return { ...status };
  }
  return true;
});
beforeEach(() => {
  vi.useFakeTimers(); status = null; sendMessage.mockClear();
  vi.stubGlobal('browser', { tabs: {
    query: vi.fn(async () => [{ id: 7, url: 'https://example.com', title: 'Example', active: true }, { id: 8, url: 'about:config' }]),
    sendMessage, executeScript: vi.fn(async () => []), update: vi.fn(async () => ({})),
    onUpdated: { addListener: (callback: typeof navigate) => { navigate = callback; } }, onRemoved: { addListener: vi.fn() },
  } });
  coordinator = new TypingCoordinator(); coordinator.register();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function discover(): Promise<TypingTarget[]> {
  const result = coordinator.discover(7); await vi.advanceTimersByTimeAsync(500); return result;
}
describe('typing session routing', () => {
  it('lists supported tabs and discovers fields from multiple frames with verified senders', async () => {
    expect(await coordinator.tabs()).toEqual([{ tabId: 7, title: 'Example', host: 'example.com', active: true }]);
    expect((await discover()).map((target) => target.fieldId)).toEqual(['main', 'embedded']);
  });
  it('pins start/control to the chosen frame and rejects overlapping sessions', async () => {
    const target = (await discover())[1];
    const started = await coordinator.start(target, 'text', DEFAULT_TYPING_OPTIONS);
    expect(started.state).toBe('typing');
    expect(sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'typing-start-in-field', fieldId: 'embedded', text: 'text' }), { frameId: 4 });
    await expect(coordinator.start(target, 'more', DEFAULT_TYPING_OPTIONS)).rejects.toThrow('Stop');
    expect((await coordinator.control('pause')).state).toBe('paused');
    expect((await coordinator.control('resume')).state).toBe('typing');
    expect((await coordinator.control('stop')).state).toBe('stopped');
    expect(sendMessage.mock.calls.filter(([, request]) => request.type === 'typing-control-in-field').every(([, , options]) => options?.frameId === 4)).toBe(true);
  });
  it('ignores status from other tabs, frames, stale jobs and old sequences', async () => {
    const target = (await discover())[1]; await coordinator.start(target, 'text', DEFAULT_TYPING_OPTIONS);
    const update = { ...status!, written: 3, sequence: 2 };
    coordinator.update(update, { tab: { id: 8 }, frameId: 4 });
    coordinator.update(update, { tab: { id: 7 }, frameId: 0 });
    coordinator.update({ ...update, jobId: 'old' }, { tab: { id: 7 }, frameId: 4 });
    expect((await coordinator.status()).written).toBe(0);
    coordinator.update(update, { tab: { id: 7 }, frameId: 4 });
    expect((await coordinator.status()).written).toBe(3);
    status = update;
    await coordinator.control('stop');
    coordinator.update({ ...update, sequence: 100 }, { tab: { id: 7 }, frameId: 4 });
    expect((await coordinator.status()).state).toBe('stopped');
  });
  it('stops and invalidates old targets when the owning tab navigates', async () => {
    const target = (await discover())[0]; await coordinator.start(target, 'text', DEFAULT_TYPING_OPTIONS);
    navigate(7, { status: 'loading' }); expect((await coordinator.status()).state).toBe('stopped');
    await expect(coordinator.start(target, 'text', DEFAULT_TYPING_OPTIONS)).rejects.toThrow('Refresh');
  });
  it('detects a removed frame rather than silently writing elsewhere', async () => {
    const target = (await discover())[1]; await coordinator.start(target, 'text', DEFAULT_TYPING_OPTIONS);
    status = null; expect((await coordinator.status()).state).toBe('stopped');
  });
  it('cancels an in-flight start and stops the content session when its reply arrives', async () => {
    const target = (await discover())[0];
    let complete!: (reply: TypingStatus) => void;
    sendMessage.mockImplementationOnce(async () => new Promise<TypingStatus>((resolve) => { complete = resolve; }));
    const starting = coordinator.start(target, 'text', DEFAULT_TYPING_OPTIONS);
    await Promise.resolve(); await Promise.resolve();
    expect((await coordinator.control('stop')).state).toBe('stopped');
    complete({ jobId: (await coordinator.status()).jobId, state: 'typing', written: 0, total: 4, sequence: 1, message: '' });
    expect((await starting).state).toBe('stopped');
    expect(sendMessage).toHaveBeenLastCalledWith(7, expect.objectContaining({ type: 'typing-control-in-field', action: 'stop' }), { frameId: 0 });
  });
});
