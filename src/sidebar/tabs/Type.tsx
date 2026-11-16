import { useEffect, useRef, useState } from 'preact/hooks';
import { send } from '../../shared/types';
import { DEFAULT_TYPING_OPTIONS, IDLE_TYPING, MAX_TYPING_CHARS, typingActive, type TypingControl, type TypingOptions, type TypingStatus, type TypingTab, type TypingTarget } from '../../shared/typing';

export function Type({ active }: { active: boolean }) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<TypingOptions>({ ...DEFAULT_TYPING_OPTIONS });
  const [tabs, setTabs] = useState<TypingTab[]>([]);
  const [tabId, setTabId] = useState(-1);
  const [fields, setFields] = useState<TypingTarget[]>([]);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [status, setStatus] = useState<TypingStatus>({ ...IDLE_TYPING });
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState('');
  const discovery = useRef(0);
  const command = useRef({ pending: false, revision: 0 });
  const running = typingActive(status);
  const target = fields[fieldIndex];
  const findFields = async (id: number) => {
    const sequence = ++discovery.current;
    setFields([]); setFieldIndex(0); setFinding(true); setNote('');
    const result = await send({ type: 'typing-targets', tabId: id });
    if (sequence !== discovery.current) return;
    setFinding(false);
    if (result.ok) { setFields(result.data); if (!result.data.length) setNote('No editable fields found. Open a page with a text field, then refresh. Browser settings and protected pages cannot be used.'); }
    else setNote(result.error);
  };
  const refreshTabs = async () => {
    setNote('');
    const result = await send({ type: 'typing-tabs' });
    if (!result.ok) { setNote(result.error); return; }
    setTabs(result.data);
    const chosen = result.data.find((tab) => tab.tabId === tabId) ?? result.data.find((tab) => tab.active) ?? result.data[0];
    setTabId(chosen?.tabId ?? -1);
    if (chosen) await findFields(chosen.tabId);
    else { setFields([]); setNote('Open a web page with an editable field first.'); }
  };
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const refresh = async () => {
      if (command.current.pending) return;
      const revision = command.current.revision;
      const result = await send({ type: 'typing-status' });
      if (alive && result.ok && !command.current.pending && revision === command.current.revision) setStatus(result.data);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 600);
    return () => { alive = false; window.clearInterval(timer); };
  }, [active]);
  useEffect(() => {
    if (active && !tabs.length) void refreshTabs();
    // Discover on first open; later refreshes are explicit to preserve the chosen field.
  }, [active]);
  const start = async () => {
    if (!target || busy || running) return;
    command.current.pending = true; command.current.revision++;
    setBusy(true); setNote('');
    const result = await send({ type: 'typing-start', target, text, options });
    if (result.ok) setStatus(result.data); else setNote(result.error);
    command.current.pending = false;
    setBusy(false);
  };
  const control = async (action: TypingControl) => {
    if (command.current.pending) return;
    command.current.pending = true; command.current.revision++;
    setBusy(true); setNote('');
    const result = await send({ type: 'typing-control', action });
    if (result.ok) setStatus(result.data); else setNote(result.error);
    command.current.pending = false;
    setBusy(false);
  };
  const locate = async () => {
    if (!target) return;
    const result = await send({ type: 'typing-locate', target });
    setNote(result.ok ? 'Target focused. Place the caret where typing should begin, then press Start typing.' : result.error);
  };
  return <section hidden={!active} class="panel typing-panel">
    <h2>Type text</h2>
    <p class="muted">Paste your text and type it into a chosen field with varied pacing and occasional pauses. Typing runs locally; the destination page can read text entered there.</p>
    <label for="typing-source">Text to type</label>
    <textarea id="typing-source" rows={7} value={text} maxLength={MAX_TYPING_CHARS} disabled={running || busy} placeholder="Your text, exactly as you want it written…" onInput={(event) => setText(event.currentTarget.value)} />
    <p class="small muted typing-count">{text.length.toLocaleString()} / {MAX_TYPING_CHARS.toLocaleString()}</p>
    <div class="card typing-destination">
      <div class="row between"><h3>Destination</h3><button class="plain small" disabled={running || busy || finding} onClick={() => void refreshTabs()}>Refresh tabs</button></div>
      <label for="typing-tab">Browser tab</label>
      <select id="typing-tab" value={tabId} disabled={running || busy || finding} onChange={(event) => { const id = Number(event.currentTarget.value); setTabId(id); void findFields(id); }}>
        {!tabs.length && <option value={-1}>No available tabs</option>}
        {tabs.map((tab) => <option key={tab.tabId} value={tab.tabId}>{tab.title} · {tab.host}</option>)}
      </select>
      <label for="typing-field">Text field</label>
      <select id="typing-field" value={fieldIndex} disabled={running || busy || finding || !fields.length} onChange={(event) => setFieldIndex(Number(event.currentTarget.value))}>
        {!fields.length && <option value={0}>{finding ? 'Finding fields…' : 'No fields found'}</option>}
        {fields.map((field, i) => <option key={`${field.frameId}:${field.fieldId}`} value={i}>{field.label} · {field.kind}{field.frameId ? ` · ${field.frame}` : ''}</option>)}
      </select>
      <div class="row"><button disabled={running || busy || finding || tabId < 0} onClick={() => void findFields(tabId)}>Refresh fields</button><button disabled={running || busy || !target} onClick={() => void locate()}>Focus field</button></div>
    </div>
    <div class="card typing-options">
      <label for="typing-speed" class="row between"><span>Approximate speed</span><strong>{options.wordsPerMinute} WPM</strong></label>
      <input id="typing-speed" type="range" min={15} max={150} step={5} value={options.wordsPerMinute} disabled={running || busy} onInput={(event) => setOptions({ ...options, wordsPerMinute: Number(event.currentTarget.value) })} />
      <p class="small muted">Timing varies for each character. Pauses can reduce the average speed.</p>
      <label class="check"><input type="checkbox" checked={options.sentencePauses} disabled={running || busy} onChange={(event) => setOptions({ ...options, sentencePauses: event.currentTarget.checked })} />Occasional sentence pauses (2–8 seconds)</label>
      <label for="typing-position">Insert text</label>
      <select id="typing-position" value={options.position} disabled={running || busy} onChange={(event) => setOptions({ ...options, position: event.currentTarget.value as TypingOptions['position'] })}>
        <option value="caret">At caret / replace selected text</option><option value="append">At the end of the field</option>
      </select>
    </div>
    {status.state !== 'idle' && <div class={`card typing-session ${status.state === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
      <div class="row between"><strong>{status.state === 'done' ? 'Complete' : status.state === 'typing' ? 'Typing' : status.state === 'starting' ? 'Starting' : status.state === 'paused' ? 'Paused' : status.state === 'error' ? 'Needs attention' : 'Stopped'}</strong><span class="small muted">{status.written} / {status.total}</span></div>
      {status.target && <p class="small muted">{status.target.label} · {status.target.frame}</p>}
      <progress max={Math.max(1, status.total)} value={status.written} aria-label="Typing progress" />
      <p>{status.message}</p>
    </div>}
    <div class="row typing-actions">
      {!running ? <button class="primary" disabled={busy || finding || !target || !text.trim()} onClick={() => void start()}>Start typing</button>
        : <><button class="primary" disabled={busy || status.state === 'starting'} onClick={() => void control(status.state === 'paused' ? 'resume' : 'pause')}>{status.state === 'paused' ? 'Resume' : 'Pause'}</button><button class="danger" disabled={busy} onClick={() => void control('stop')}>Stop</button></>}
    </div>
    {note && <p role="status" class="note">{note}</p>}
    <p class="small muted">Press Escape in the page to stop. Switching tabs or moving the caret pauses typing. Editing the field stops the session. Autocorrect stays out of the way while text is being typed.</p>
    <p class="small muted">Works with standard text fields and compatible rich editors. Pacing does not guarantee human indistinguishability or bypass history checks.</p>
  </section>;
}
