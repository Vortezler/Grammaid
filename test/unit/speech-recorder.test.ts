import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechRecorder } from '../../src/sidebar/speech-audio';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('microphone resource ownership', () => {
  it('releases a late permission result after the user cancels', async () => {
    let grant!: (stream: MediaStream) => void; const stop = vi.fn(); const done = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise<MediaStream>((resolve) => { grant = resolve; }) } });
    vi.stubGlobal('MediaRecorder', class {});
    const recorder = new SpeechRecorder(done, vi.fn()); const starting = recorder.start(); recorder.cancel();
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream); await starting;
    expect(stop).toHaveBeenCalledOnce(); expect(done).not.toHaveBeenCalled();
  });
  it('stops the microphone before handing recorded audio to transcription', async () => {
    vi.useFakeTimers(); const stop = vi.fn(); const done = vi.fn(() => expect(stop).toHaveBeenCalled());
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } });
    class Recorder {
      static isTypeSupported() { return true; }
      state = 'inactive'; mimeType = 'audio/webm';
      ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }, 0); }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    const recorder = new SpeechRecorder(done, vi.fn()); await recorder.start(); recorder.stop();
    expect(stop).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(0); expect(done).toHaveBeenCalledOnce();
  });
  it('releases microphone tracks if constructing the recorder fails', async () => {
    const stop = vi.fn(); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } });
    class Recorder { static isTypeSupported() { return true; } constructor() { throw new Error('Unsupported codec'); } }
    vi.stubGlobal('MediaRecorder', Recorder); const recorder = new SpeechRecorder(vi.fn(), vi.fn());
    await expect(recorder.start()).rejects.toThrow('Unsupported codec'); expect(stop).toHaveBeenCalledOnce();
  });
});
