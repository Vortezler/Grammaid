import { MAX_SPEECH_FILE_BYTES, MAX_SPEECH_SECONDS, SPEECH_RATE } from '../shared/speech';

export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  if (!blob.size || blob.size > MAX_SPEECH_FILE_BYTES) throw new Error('Choose a nonempty audio file smaller than 25 MB.');
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (buffer.duration > MAX_SPEECH_SECONDS || buffer.duration < .25) throw new Error('Use audio between a quarter of a second and two minutes long.');
    // OfflineAudioContext provides proper browser resampling and channel downmixing.
    const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * SPEECH_RATE), SPEECH_RATE);
    const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
    return (await offline.startRendering()).getChannelData(0);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'EncodingError') throw new Error('This browser could not decode the audio format. Try WAV, MP3 or Ogg.');
    throw error;
  } finally { await context.close(); }
}

/** Own every microphone resource, including cancellation while the permission prompt is open. */
export class SpeechRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private timer = 0;
  private cancelled = false;
  private chunks: Blob[] = [];
  constructor(private finished: (blob: Blob) => void, private failed: (error: Error) => void, private started: () => void = () => undefined) {}
  async start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording is unavailable in this browser. You can still choose an audio file.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    if (this.cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
    this.stream = stream;
    try {
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); this.recorder = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size && !this.cancelled) this.chunks.push(event.data); };
      recorder.onstop = () => {
        this.release(); const chunks = this.chunks; this.chunks = [];
        if (!this.cancelled) this.finished(new Blob(chunks, { type: recorder.mimeType }));
      };
      recorder.onerror = () => { this.cancel(); this.failed(new Error('Microphone recording failed. Check the device and try again.')); };
      recorder.start(1000); this.started();
      this.timer = window.setTimeout(() => this.stop(), MAX_SPEECH_SECONDS * 1000);
    } catch (error) { this.cancel(); throw error; }
  }
  stop() { window.clearTimeout(this.timer); if (this.recorder?.state === 'recording') this.recorder.stop(); this.release(); }
  cancel() { this.cancelled = true; this.chunks = []; this.stop(); }
  private release() { window.clearTimeout(this.timer); this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null; }
}
