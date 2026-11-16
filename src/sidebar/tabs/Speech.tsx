import { useEffect, useRef, useState } from 'preact/hooks';
import { send } from '../../shared/types';
import { cleanTranscript, DEFAULT_SPEECH_OPTIONS, encodeSpeech, MAX_SPEECH_SECONDS, SPEECH_MODEL, type SpeechOptions, type SpeechResult, type SpeechStatus } from '../../shared/speech';
import { decodeAudio, SpeechRecorder } from '../speech-audio';

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const languageLabels: Record<string, string> = { ba: 'Bashkir', bo: 'Tibetan', jw: 'Javanese' };
const languages = SPEECH_MODEL.languages.map((code) => ({ code, name: languageLabels[code] ?? languageNames.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
export function Speech({ active, recordingPage = false }: { active: boolean; recordingPage?: boolean }) {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [language, setLanguage] = useState('en');
  const [options, setOptions] = useState<SpeechOptions>({ ...DEFAULT_SPEECH_OPTIONS });
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<'idle' | 'permission' | 'recording' | 'decoding' | 'transcribing'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<SpeechRecorder | null>(null);
  const job = useRef('');
  const alive = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const refresh = async () => { const reply = await send({ type: 'speech-status' }); if (alive.current && reply.ok) setStatus(reply.data); };
  useEffect(() => {
    if (!active) return;
    void refresh(); const timer = window.setInterval(() => void refresh(), 700);
    return () => window.clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const start = Date.now(); setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.min(MAX_SPEECH_SECONDS, Math.floor((Date.now() - start) / 1000))), 250);
    return () => window.clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    const cleanup = () => { alive.current = false; version.current++; recorder.current?.cancel(); if (job.current) void send({ type: 'speech-cancel', jobId: job.current }); };
    window.addEventListener('pagehide', cleanup);
    return () => { cleanup(); window.removeEventListener('pagehide', cleanup); };
  }, []);
  const processing = phase !== 'idle';
  const modelBusy = status?.state === 'downloading' || status?.state === 'loading' || status?.state === 'transcribing';
  const ready = status?.downloadBytes === 0 && status.state !== 'downloading';
  const transcribe = async (blob: Blob) => {
    const operation = ++version.current;
    setPhase('decoding'); setNote('Preparing audio locally…');
    try {
      const audio = await decodeAudio(blob);
      if (!alive.current || operation !== version.current) return;
      const id = crypto.randomUUID(); job.current = id; setPhase('transcribing'); setNote('');
      const reply = await send({ type: 'speech-transcribe', jobId: id, pcm: encodeSpeech(audio), language, options });
      if (!alive.current || operation !== version.current) return;
      if (reply.ok) { setResult(reply.data); setText(reply.data.text); setNote(`${reply.data.removedFillers} hesitation${reply.data.removedFillers === 1 ? '' : 's'} removed. Review the transcript before using it.`); }
      else setNote(reply.error);
    } catch (error) { if (alive.current && operation === version.current) setNote(error instanceof Error ? error.message : String(error)); }
    finally { if (alive.current && operation === version.current) { job.current = ''; setPhase('idle'); void refresh(); } }
  };
  const record = async () => {
    setPhase('permission'); setNote('');
    const controller = new SpeechRecorder((blob) => { recorder.current = null; if (alive.current) void transcribe(blob); },
      (error) => { if (alive.current) { recorder.current = null; setPhase('idle'); setNote(error.message); } },
      () => { if (alive.current) setPhase('recording'); });
    recorder.current = controller;
    try { await controller.start(); }
    catch (error) {
      if (alive.current && recorder.current === controller) {
        recorder.current = null; setPhase('idle');
        setNote(error instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name) ? 'Microphone access was not granted. Allow it in the browser’s site permissions, or choose an audio file.' : error instanceof Error ? error.message : String(error));
      }
    }
  };
  const cancel = async () => {
    if (phase === 'transcribing' && job.current) { setNote('Cancelling after the current model step…'); await send({ type: 'speech-cancel', jobId: job.current }); return; }
    version.current++; recorder.current?.cancel(); recorder.current = null; setPhase('idle'); setNote('Recording discarded.');
  };
  const manage = async (action: 'speech-download' | 'speech-download-cancel' | 'speech-remove') => {
    const reply = await send({ type: action }); if (!reply.ok) setNote(reply.error); else setNote(''); await refresh();
  };
  const openRecorder = async () => { const reply = await send({ type: 'speech-open-recorder' }); if (!reply.ok) setNote(reply.error); };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setNote('Transcript copied.'); } catch { setNote('Select the transcript and copy it manually.'); } };
  return <section class="panel speech-panel" hidden={!active}>
    <div><p class="eyebrow">LOCAL DICTATION</p><h2>Speak your draft</h2></div>
    <p class="muted">Record up to two minutes or choose an audio file. Whisper transcribes and adds punctuation on your device, with optional cleanup.</p>
    <div class="card">
      <div class="row between"><h3>Whisper Base · multilingual</h3><span class="status-badge">{ready ? 'Installed' : 'Local model'}</span></div>
      <p class="small muted">{status ? mb(status.bytes) : 'About 80 MB'} one-time download. No account, API or audio upload.</p>
      {status?.state === 'downloading' ? <>
        <progress aria-label="Speech model download" max={1} value={status.progress ?? 0} /><p class="small muted">Downloading · {Math.round((status.progress ?? 0) * 100)}%</p>
        <button onClick={() => void manage('speech-download-cancel')}>Stop download</button>
      </> : <div class="row">{!ready ? <button class="primary" disabled={processing || modelBusy} onClick={() => void manage('speech-download')}>{status?.error ? 'Resume download' : 'Download speech model'}{status ? ` · ${mb(status.downloadBytes)}` : ''}</button>
        : <button class="plain small" disabled={processing || modelBusy} onClick={() => void manage('speech-remove')}>Remove speech model</button>}</div>}
      {status?.error && <p class="error-text" role="status">{status.error}</p>}
    </div>
    <div class="card">
      <label for="speech-language">Spoken language</label>
      <select id="speech-language" value={language} disabled={processing} onChange={(event) => setLanguage(event.currentTarget.value)}><option value="auto">Detect automatically</option>{languages.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</select>
      <label class="check"><input type="checkbox" checked={options.removeFillers} disabled={processing} onChange={(event) => setOptions({ ...options, removeFillers: event.currentTarget.checked })} />Remove English “uh” / “um” hesitations</label>
      <p class="small muted">Filler cleanup applies when English is selected. Words like “like” and “you know” are kept.</p>
      <label class="check"><input type="checkbox" checked={options.format} disabled={processing} onChange={(event) => setOptions({ ...options, format: event.currentTarget.checked })} />Tidy capitalization, spacing and final punctuation</label>
      {recordingPage ? <div class="row">
        {phase === 'recording' ? <button class="primary" onClick={() => recorder.current?.stop()}>Stop & transcribe</button>
          : <button class="primary" disabled={!ready || processing || modelBusy} onClick={() => void record()}>Start recording</button>}
        {['permission', 'recording', 'decoding', 'transcribing'].includes(phase) && <button onClick={() => void cancel()}>{phase === 'transcribing' ? 'Cancel transcription' : 'Discard'}</button>}
      </div> : <button class="primary" disabled={processing} onClick={() => void openRecorder()}>Open microphone recorder</button>}
      <p class="small muted">{recordingPage ? 'Your microphone turns on only after Start recording and browser permission. Stop releases it before transcription.' : 'Recording opens in a Grammaid tab so the browser can show its microphone permission prompt.'}</p>
      <input ref={input} type="file" accept="audio/*" hidden aria-label="Audio file" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void transcribe(file); }} />
      <button disabled={!ready || processing || modelBusy} onClick={() => input.current?.click()}>Choose audio file</button>
      {!recordingPage && phase === 'transcribing' && <button onClick={() => void cancel()}>Cancel transcription</button>}
      {(processing || modelBusy && status?.state !== 'downloading') && <p role="status" class="speech-activity">{phase === 'recording' ? `● Recording · ${elapsed}s / ${MAX_SPEECH_SECONDS}s` : phase === 'permission' ? 'Waiting for microphone permission…' : phase === 'decoding' ? 'Preparing audio…' : status?.state === 'loading' ? 'Loading local speech model…' : 'Transcribing locally… This can take a moment.'}</p>}
    </div>
    {result && <div class="card speech-result">
      <div class="row between"><h3>Your transcript</h3><span class="small muted">{result.seconds.toFixed(1)}s audio</span></div>
      <textarea aria-label="Speech transcript" rows={8} value={text} onInput={(event) => setText(event.currentTarget.value)} />
      <div class="row"><button class="primary" disabled={!text.trim()} onClick={() => void copy()}>Copy transcript</button><button onClick={() => { const cleaned = cleanTranscript(options.format ? result.formattedSource ?? result.raw : result.raw, result.language, options); setText(cleaned.text); setNote(`${cleaned.removedFillers} hesitations removed. Cleanup uses the selected options and the original transcription.`); }}>Reapply cleanup</button></div>
      <details><summary>Original model transcript</summary><p class="speech-original">{result.raw}</p></details>
      <button class="plain small" onClick={() => { setResult(null); setText(''); setNote(''); }}>Clear transcript</button>
    </div>}
    {note && <p class="note" role="status">{note}</p>}
    <p class="small muted">No profanity or slur filter. The model can still mishear or omit words; review both versions. Recordings and transcripts stay in memory and are not saved to a history. Microphone audio and imported files are never sent online.</p>
  </section>;
}
