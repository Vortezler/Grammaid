import { useEffect, useRef, useState } from 'preact/hooks';
import { send, type Activation, type ExportBundle, type ModelStatus } from '../../shared/types';
import { cleanHost, type DialectName, type Settings as SettingsData } from '../../shared/settings';
import { formatBytes } from '../App';
import { download } from './Stats';

interface Props {
  active: boolean;
  status: ModelStatus | null;
  refreshStatus: () => void;
}

const DIALECTS: DialectName[] = ['American', 'British', 'Canadian', 'Australian'];
const STATE_TEXT = { idle: 'not loaded', loading: 'loading…', ready: 'ready', error: 'error' } as const;

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="row between">
      <span>{label}</span>
      <span class="switch">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
        <i />
      </span>
    </label>
  );
}

function TokenList({ items, onRemove, empty }: { items: string[]; onRemove: (item: string) => void; empty: string }) {
  if (items.length === 0) return <p class="small muted">{empty}</p>;
  return (
    <ul class="list">
      {items.map((item) => (
        <li class="token" key={item}>
          {item}
          <button aria-label={`Remove ${item}`} onClick={() => onRemove(item)}>×</button>
        </li>
      ))}
    </ul>
  );
}

function AddRow({ placeholder, label, onAdd }: { placeholder: string; label: string; onAdd: (value: string) => void }) {
  const [value, setValue] = useState('');
  const submit = (e: Event) => {
    e.preventDefault();
    if (value.trim()) onAdd(value.trim());
    setValue('');
  };
  return (
    <form class="row" onSubmit={submit} style={{ flexWrap: 'nowrap' }}>
      <input type="text" class="grow" value={value} placeholder={placeholder} aria-label={label} onInput={(e) => setValue(e.currentTarget.value)} />
      <button type="submit" disabled={!value.trim()}>Add</button>
    </form>
  );
}

export function Settings({ active, status, refreshStatus }: Props) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [note, setNote] = useState('');
  const [clearing, setClearing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = () => void send({ type: 'get-settings' }).then((res) => res.ok && setSettings(res.data));
  useEffect(() => {
    if (active) load();
  }, [active]);

  const patch = async (p: Partial<SettingsData>) => {
    // Show the change at once; the background confirms (and normalizes) it.
    setSettings((s) => (s ? { ...s, ...p, categories: { ...s.categories, ...(p.categories ?? {}) } } : s));
    const res = await send({ type: 'set-settings', patch: p });
    if (res.ok) setSettings(res.data);
    else setNote(res.error);
  };

  // Where Grammaid is running right now, for the tab the user is looking at. Polled lightly
  // while this tab is open, because the user can switch browser tabs at any time.
  const [here, setHere] = useState<Activation | null>(null);
  const refreshHere = () => void send({ type: 'get-activation' }).then((res) => res.ok && setHere(res.data));
  useEffect(() => {
    if (!active) return;
    refreshHere();
    const timer = window.setInterval(refreshHere, 1500);
    return () => window.clearInterval(timer);
  }, [active]);

  const setSite = async (host: string, on: boolean) => {
    if (!settings) return;
    const site = cleanHost(host);
    if (!site) return setNote('That does not look like a site name. Try something like example.com.');
    const rest = settings.enabledSites.filter((x) => x !== site);
    await patch({ enabledSites: on ? [...rest, site] : rest });
    refreshHere();
  };

  const toggleTab = async () => {
    const res = await send({ type: 'toggle-tab' });
    if (res.ok) setHere(res.data);
    else setNote(res.error);
  };

  const exportAll = async () => {
    const res = await send({ type: 'export-data' });
    if (res.ok) download('grammaid-data.json', JSON.stringify(res.data, null, 2), 'application/json');
    else setNote(res.error);
  };

  const importAll = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as ExportBundle;
      const res = await send({ type: 'import-data', data });
      setNote(res.ok ? 'Imported.' : res.error);
      load();
    } catch {
      setNote('That file could not be read as a Grammaid export.');
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const clearModels = async () => {
    setClearing(true);
    await send({ type: 'model-clear' });
    setClearing(false);
    refreshStatus();
  };

  if (!settings) return <section class="panel" hidden={!active} />;
  const loading = status?.gpt2 === 'loading' || status?.t5 === 'loading';
  const pct = status?.progress === undefined ? null : Math.round(status.progress * 100);

  return (
    <section class="panel" hidden={!active}>
      <h2>Settings</h2>

      <div class="card">
        <Switch label="Check my writing" checked={settings.enabled} onChange={(v) => patch({ enabled: v })} />
        <div class="divider" />
        <Switch label="Spelling" checked={settings.categories.spelling} onChange={(v) => patch({ categories: { ...settings.categories, spelling: v } })} />
        <Switch label="Grammar" checked={settings.categories.grammar} onChange={(v) => patch({ categories: { ...settings.categories, grammar: v } })} />
        <Switch label="Style and phrasing" checked={settings.categories.style} onChange={(v) => patch({ categories: { ...settings.categories, style: v } })} />
        <div class="divider" />
        <label class="field">
          <span>English dialect</span>
          <select value={settings.dialect} onChange={(e) => patch({ dialect: e.currentTarget.value as DialectName })}>
            {DIALECTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>

      <div class="card">
        <h3>Where Grammaid runs</h3>
        <p class="small muted">
          Grammaid stays off until you turn it on. It checks every text field in a tab when the site is on your list, or after you click
          the Grammaid toolbar button in that tab.
        </p>
        <p role="status">
          <span class={here?.active ? 'dot teal' : 'dot off'} />
          {!here
            ? 'Checking this tab…'
            : !settings.enabled
              ? 'Off everywhere ("Check my writing" is switched off).'
              : here.site
                ? `On in this tab: ${here.host} is on your list.`
                : here.tab
                  ? 'On in this tab until you close it.'
                  : 'Off in this tab.'}
        </p>
        <div class="row">
          <button class={here?.tab ? '' : 'primary'} onClick={toggleTab} disabled={!settings.enabled}>
            {here?.tab ? 'Turn off in this tab' : 'Turn on in this tab'}
          </button>
          {here?.host && !here.site && <button onClick={() => setSite(here.host, true)}>Always check {here.host}</button>}
        </div>
        <div class="divider" />
        <h3>Sites checked automatically</h3>
        <TokenList items={settings.enabledSites} empty="No sites yet. Add the ones you write on." onRemove={(s) => setSite(s, false)} />
        <AddRow placeholder="example.com" label="Site to check automatically" onAdd={(s) => setSite(s, true)} />
      </div>

      <div class="card">
        <h3>Personal dictionary</h3>
        <TokenList items={settings.userDictionary} empty="No words added yet. Words here are never flagged." onRemove={(w) => patch({ userDictionary: settings.userDictionary.filter((x) => x !== w) })} />
        <AddRow placeholder="Add a word" label="Word to add to the dictionary" onAdd={(w) => patch({ userDictionary: [...settings.userDictionary, w] })} />
      </div>

      <div class="card">
        <h3>Language models</h3>
        <p class="small muted">
          Used for synonym ranking, rewriting and the AI check. Downloaded once from Hugging Face (about 180 MB), then kept on this computer.
        </p>
        <p class="small">
          Scoring model: <strong>{status ? STATE_TEXT[status.gpt2] : '…'}</strong> · Rewrite model: <strong>{status ? STATE_TEXT[status.t5] : '…'}</strong> · On disk:{' '}
          <strong>{status?.cacheBytes === undefined ? '…' : formatBytes(status.cacheBytes)}</strong>
        </p>
        {loading && (
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
            <i style={{ width: `${pct ?? 4}%` }} />
          </div>
        )}
        {status?.error && <p class="small error-text" role="alert">{status.error}</p>}
        <div class="row">
          <button class="primary" disabled={loading} onClick={() => void send({ type: 'model-load' }).then(refreshStatus)}>
            {loading ? `Downloading… ${pct ?? 0}%` : status?.error ? 'Retry download' : 'Download models'}
          </button>
          <button disabled={loading || clearing} onClick={clearModels}>{clearing ? 'Clearing…' : 'Clear models'}</button>
        </div>
        <div class="divider" />
        <label class="field">
          <span>Rewrite model id</span>
          <input type="text" value={settings.rewriteModelId} onChange={(e) => patch({ rewriteModelId: e.currentTarget.value })} spellcheck={false} />
          <span class="small muted">A Transformers.js-compatible seq2seq model on Hugging Face. Bigger models rewrite better but download and run slower.</span>
        </label>
        <label class="field">
          <span>Minimum words for the AI check</span>
          <input type="number" min={30} max={1000} value={settings.detectorMinWords} onChange={(e) => patch({ detectorMinWords: Number(e.currentTarget.value) })} />
        </label>
      </div>

      <div class="card">
        <h3>Your data</h3>
        <p class="small muted">Settings, dictionary and spelling stats, as one JSON file. Nothing is ever sent anywhere.</p>
        <div class="row">
          <button onClick={exportAll}>Export</button>
          <button onClick={() => fileInput.current?.click()}>Import…</button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => importAll(e.currentTarget.files?.[0])} />
        </div>
      </div>

      {note && <p class="small muted" role="status">{note}</p>}
    </section>
  );
}
