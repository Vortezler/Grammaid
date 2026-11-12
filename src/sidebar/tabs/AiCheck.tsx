import { useState } from 'preact/hooks';
import { send, type DetectResult } from '../../shared/types';
import { SentenceHighlights } from '../components/SentenceHighlights';

interface Props {
  active: boolean;
  onModelActivity: () => void;
}

const ARROW = { up: '↑', down: '↓', neutral: '·' } as const;
const ARROW_LABEL = { up: 'Pushes towards AI', down: 'Pushes towards human', neutral: 'Neutral' } as const;

export function AiCheck({ active, onModelActivity }: Props) {
  const [text, setText] = useState('');
  const [analysed, setAnalysed] = useState('');
  const [result, setResult] = useState<DetectResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const pull = async (source: 'field' | 'selection') => {
    const res = await send({ type: 'get-page-text', source });
    if (res.ok && res.data) {
      setText(res.data.text);
      setNote('');
    } else {
      setNote(source === 'field' ? 'Click into a text field on the page first, then try again.' : 'Select some text on the page first, then try again.');
    }
  };

  const run = async () => {
    setBusy(true);
    setNote('');
    setResult(null);
    // The first run may trigger the model download; let the banner show its progress.
    window.setTimeout(onModelActivity, 300);
    const res = await send({ type: 'detect', text });
    setBusy(false);
    onModelActivity();
    if (!res.ok) {
      setNote(res.error);
      return;
    }
    setAnalysed(text);
    setResult(res.data);
  };

  const labelClass = result && !result.tooShort ? (result.label === 'Likely human' ? 'human' : result.label === 'Likely AI' ? 'ai' : 'mixed') : '';

  return (
    <section class="panel" hidden={!active}>
      <div class="stack">
        <h2>AI check</h2>
        <p class="muted">Estimates how AI-written a text looks, using only signals computed on this computer.</p>
      </div>
      <textarea value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="Paste at least a few paragraphs" aria-label="Text to analyse" spellcheck={false} />
      <div class="row">
        <button onClick={() => pull('field')}>Use text from page field</button>
        <button onClick={() => pull('selection')}>Use selection</button>
      </div>
      <div class="row">
        <button class="primary" onClick={run} disabled={busy || !text.trim()}>
          {busy ? 'Analysing…' : 'Run AI check'}
        </button>
        {busy && <span class="small muted" role="status">This can take a few seconds per paragraph.</span>}
      </div>
      {note && <p class="small error-text" role="alert">{note}</p>}

      {result?.tooShort && (
        <div class="card" role="status">
          <h3>Too short for a reliable result</h3>
          <p class="muted">
            This text has {result.words} words. At least {result.minWords} are needed (you can change this in Settings).
          </p>
        </div>
      )}

      {result && !result.tooShort && (
        <>
          <div class="card" aria-live="polite">
            <p class="caption">Result</p>
            <p class="display">{result.percent}%</p>
            <p>of words flagged as likely AI-written</p>
            <p>
              <span class={`label-pill ${labelClass}`}>{result.label}</span>
            </p>
          </div>
          <div class="card">
            <div class="row between">
              <h3>Sentence by sentence</h3>
              <span class="legend small muted">
                <span><i style={{ background: 'var(--flag-red)' }} />Likely AI</span>
                <span><i style={{ background: 'var(--flag-yellow)' }} />Uncertain</span>
              </span>
            </div>
            <SentenceHighlights text={analysed} sentences={result.sentences} />
          </div>
          <div class="card">
            <h3>What pushed the score</h3>
            <div>
              {result.signals.map((s) => (
                <div class="signal" key={s.name}>
                  <span class={`arrow ${s.direction}`} title={ARROW_LABEL[s.direction]} aria-label={ARROW_LABEL[s.direction]}>
                    {ARROW[s.direction]}
                  </span>
                  <span>
                    <strong>{s.name}</strong> <span class="muted">{s.value}</span>
                  </span>
                  <span />
                  <span class="small muted">{s.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <p class="disclaimer">
        This is an approximate, local estimate. It is not Turnitin and does not predict what Turnitin will say. It can wrongly flag formal
        writing and writing by non-native speakers, and it can miss AI text. It is never proof of anything.
      </p>
    </section>
  );
}
