import { useEffect, useRef, useState } from 'preact/hooks';
import { send, type Issue } from '../../shared/types';
import { MAX_LINT_CHARS } from '../../shared/settings';
import { IssueList } from '../components/IssueList';

export function Check({ active }: { active: boolean }) {
  const [text, setText] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [state, setState] = useState<'idle' | 'checking' | 'done' | 'error'>('idle');
  const [note, setNote] = useState('');
  const seq = useRef(0);

  // Check shortly after typing stops; stale answers are discarded.
  useEffect(() => {
    const id = ++seq.current;
    if (!text.trim()) {
      setIssues([]);
      setState('idle');
      return;
    }
    setState('checking');
    const timer = window.setTimeout(async () => {
      const res = await send({ type: 'lint', text });
      if (id !== seq.current) return;
      if (res.ok) {
        setIssues(res.data);
        setState('done');
      } else {
        setNote(res.error);
        setState('error');
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [text]);

  const useField = async () => {
    const res = await send({ type: 'get-page-text', source: 'field' });
    if (res.ok && res.data) {
      setText(res.data.text);
      setNote('');
    } else setNote('Click into a text field on the page first, then try again.');
  };

  const apply = (issue: Issue, replacement: string) => {
    const problem = text.slice(issue.start, issue.end);
    setText(text.slice(0, issue.start) + replacement + text.slice(issue.end));
    if (issue.kind === 'spelling' && replacement) void send({ type: 'spelling-accepted', typo: problem, correction: replacement });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNote('Copied.');
    } catch {
      setNote('Could not copy. Select the text and copy it by hand.');
    }
  };

  const counts = { spelling: 0, grammar: 0, style: 0 };
  for (const i of issues) counts[i.kind]++;

  return (
    <section class="panel" hidden={!active}>
      <div class="stack">
        <h2>Check text</h2>
        <p class="muted">Paste text here, or pull it from the field you are typing in. Useful for Google Docs, which cannot be checked inline.</p>
      </div>
      <textarea value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="Paste or type text to check" aria-label="Text to check" spellcheck={false} />
      <div class="row">
        <button onClick={useField}>Use focused field</button>
        <button onClick={copy} disabled={!text}>Copy result</button>
        <span class="grow" />
        <span class="small muted" role="status">
          {state === 'checking' && 'Checking…'}
          {state === 'done' && (issues.length === 0 ? 'No issues found' : `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`)}
        </span>
      </div>
      {note && <p class={state === 'error' ? 'small error-text' : 'small muted'} role="status">{note}</p>}
      {text.length > MAX_LINT_CHARS && <p class="small muted">Only the first {MAX_LINT_CHARS.toLocaleString()} characters are checked.</p>}
      {state === 'done' && issues.length > 0 && (
        <p class="small muted">
          {counts.spelling} spelling · {counts.grammar} grammar · {counts.style} style
        </p>
      )}
      <IssueList text={text} issues={issues} onApply={apply} />
    </section>
  );
}
