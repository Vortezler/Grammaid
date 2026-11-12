import { useState } from 'preact/hooks';
import { send, type RephraseOption, type RephraseResponse } from '../../shared/types';
import { countWords } from '../../shared/sentences';
import { diffWords } from '../../shared/diff';

interface Props {
  active: boolean;
  onModelActivity: () => void;
}

const LABEL: Record<RephraseOption['source'], string> = { model: 'Rewrite', tighten: 'Tighten', 'active-hint': 'Active voice hint' };

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <p class="option-text">
      {diffWords(before, after).map((p, i) => (p.type === 'same' ? p.text : p.type === 'add' ? <ins key={i}>{p.text}</ins> : <del key={i}>{p.text}</del>))}
    </p>
  );
}

export function Rewrite({ active, onModelActivity }: Props) {
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [result, setResult] = useState<RephraseResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const pull = async () => {
    const res = await send({ type: 'get-page-text', source: 'selection' });
    if (res.ok && res.data) {
      setText(res.data.text.trim());
      setNote('');
    } else setNote('Select a sentence on the page first, then try again.');
  };

  const run = async () => {
    const input = text.trim();
    if (countWords(input) < 4) {
      setNote('Enter at least four words.');
      return;
    }
    setBusy(true);
    setNote('');
    setResult(null);
    window.setTimeout(onModelActivity, 300);
    const res = await send({ type: 'rephrase', text: input });
    setBusy(false);
    onModelActivity();
    if (!res.ok) {
      setNote(res.error);
      return;
    }
    setSource(input);
    setResult(res.data);
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNote('Copied.');
    } catch {
      setNote('Could not copy. Select the text and copy it by hand.');
    }
  };

  return (
    <section class="panel" hidden={!active}>
      <div class="stack">
        <h2>Rewrite</h2>
        <p class="muted">Get alternative phrasings for a sentence. Rewrites come from a small local model, so expect modest changes.</p>
      </div>
      <textarea value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="A sentence or short passage" aria-label="Text to rewrite" style={{ minHeight: '6rem' }} />
      <div class="row">
        <button class="primary" onClick={run} disabled={busy || !text.trim()}>
          {busy ? 'Rewriting…' : 'Rewrite'}
        </button>
        <button onClick={pull}>Use selection</button>
      </div>
      {note && <p class="small muted" role="status">{note}</p>}
      {result?.modelError && <p class="small error-text" role="alert">{result.modelError}</p>}
      {result && result.options.length === 0 && !result.modelError && (
        <p class="muted">No better phrasing found for this one.</p>
      )}
      {result?.options.map((o, i) => (
        <div class="card" key={i}>
          <p class="caption">{LABEL[o.source]}</p>
          {o.source === 'active-hint' ? <p>{o.note}</p> : <Diff before={source} after={o.text} />}
          {o.source !== 'active-hint' && (
            <div class="row">
              <button onClick={() => copy(o.text)}>Copy</button>
              <button
                onClick={() => {
                  setText(o.text);
                  setResult(null);
                  setNote('Accepted. You can rewrite it again or copy it.');
                }}
              >
                Accept
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
