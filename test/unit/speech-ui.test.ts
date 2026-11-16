import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Speech } from '../../src/sidebar/tabs/Speech';
import type { SpeechStatus } from '../../src/shared/speech';
let root: HTMLDivElement;
let status: SpeechStatus;
const audio = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock('../../src/sidebar/speech-audio', () => ({ decodeAudio: audio.decode, SpeechRecorder: vi.fn() }));
const message = vi.fn(async (request: { type: string }) => {
  if (request.type === 'speech-status') return { ok: true, data: status };
  if (request.type === 'speech-download') status = { ...status, state: 'ready', downloadBytes: 0 };
  if (request.type === 'speech-transcribe') return { ok: true, data: { raw: 'um, i agree.', text: 'I agree.', removedFillers: 1, language: 'en', seconds: .5 } };
  return { ok: true, data: null };
});
beforeEach(() => {
  status = { state: 'missing', bytes: 80000000, downloadBytes: 80000000 }; message.mockClear();
  audio.decode.mockResolvedValue(new Float32Array(8000).fill(.1));
  root = document.createElement('div'); document.body.append(root); vi.stubGlobal('browser', { runtime: { sendMessage: message } });
});
afterEach(() => { act(() => render(null, root)); root.remove(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { render(h(Speech, { active: true }), root); await Promise.resolve(); }); }
async function click(label: string) {
  const button = [...root.querySelectorAll('button')].find((button) => button.textContent?.includes(label))!;
  await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });
}
describe('speech panel', () => {
  it('starts no automatic download or recording and opens the microphone page only when requested', async () => {
    await mount(); expect(message.mock.calls.map(([request]) => request.type)).toEqual(['speech-status']);
    expect(root.textContent).toContain('No profanity or slur filter');
    const choose = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Choose audio file')!;
    expect(choose.disabled).toBe(true);
    await click('Open microphone recorder'); expect(message).toHaveBeenCalledWith({ type: 'speech-open-recorder' });
  });
  it('imports audio locally, displays both versions, copies edited text and clears the transcript', async () => {
    await mount(); await click('Download speech model');
    const file = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(file, 'files', { configurable: true, value: [new File(['audio'], 'speech.wav', { type: 'audio/wav' })] });
    await act(async () => { file.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(audio.decode).toHaveBeenCalledOnce(); expect(message).toHaveBeenCalledWith(expect.objectContaining({ type: 'speech-transcribe', language: 'en', pcm: expect.any(String), options: { removeFillers: true, format: true } }));
    expect(root.textContent).toContain('um, i agree.');
    const transcript = root.querySelector('textarea')!; expect(transcript.value).toBe('I agree.');
    await act(() => { transcript.value = 'My edit.'; transcript.dispatchEvent(new Event('input', { bubbles: true })); });
    const writeText = vi.fn(async () => undefined); vi.stubGlobal('navigator', { clipboard: { writeText } });
    await click('Copy transcript'); expect(writeText).toHaveBeenCalledWith('My edit.');
    await click('Reapply cleanup'); expect(transcript.value).toBe('I agree.');
    await click('Clear transcript'); expect(root.querySelector('textarea')).toBeNull();
  });
});
