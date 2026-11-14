import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { send, type ModelStatus } from '../shared/types';
import { Check } from './tabs/Check';
import { AiCheck } from './tabs/AiCheck';
import { Rewrite } from './tabs/Rewrite';
import { Translate } from './tabs/Translate';
import { Stats } from './tabs/Stats';
import { Settings } from './tabs/Settings';

const TABS = ['Check', 'AI Check', 'Rewrite', 'Translate', 'Stats', 'Settings'] as const;
type Tab = (typeof TABS)[number];

export const formatBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(0)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`);

/** Polls model status; quickly while something is loading, slowly otherwise. */
export function useModelStatus(): [ModelStatus | null, () => void] {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const timer = useRef(0);
  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    void send({ type: 'model-status' }).then((res) => {
      if (res.ok) setStatus(res.data);
      const busy = res.ok && (res.data.gpt2 === 'loading' || res.data.t5 === 'loading');
      timer.current = window.setTimeout(refresh, busy ? 500 : 4000);
    });
  }, []);
  useEffect(() => {
    refresh();
    return () => window.clearTimeout(timer.current);
  }, [refresh]);
  return [status, refresh];
}

function ModelBanner({ status, refresh }: { status: ModelStatus | null; refresh: () => void }) {
  if (!status) return null;
  const loading = status.gpt2 === 'loading' || status.t5 === 'loading';
  const ready = status.gpt2 === 'ready' && status.t5 === 'ready';
  const start = () => void send({ type: 'model-load' }).then(refresh);
  if (ready && !status.error) return null;
  if (loading) {
    const pct = status.progress === undefined ? null : Math.round(status.progress * 100);
    return (
      <div class="banner" role="status">
        <p>{pct === null ? 'Loading the language models…' : `Downloading the language models… ${pct}%`}</p>
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
          <i style={{ width: `${pct ?? 4}%` }} />
        </div>
      </div>
    );
  }
  if (status.error) {
    return (
      <div class="banner error" role="alert">
        <p>{status.error}</p>
        <div class="row">
          <button class="primary" onClick={start}>Retry</button>
        </div>
      </div>
    );
  }
  // Models are cached but not loaded yet: nothing to announce, they load on first use.
  if ((status.cacheBytes ?? 0) > 50 * 1048576) return null;
  return (
    <div class="banner">
      <p>
        Synonyms, rewriting and the AI check need a one-time download of about 180 MB. After that they work offline.
      </p>
      <div class="row">
        <button class="primary" onClick={start}>Download now</button>
      </div>
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>('Check');
  const [status, refresh] = useModelStatus();
  const index = TABS.indexOf(tab);

  const onKey = (e: KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = TABS[(index + delta + TABS.length) % TABS.length];
    setTab(next);
    document.getElementById(`tab-${TABS.indexOf(next)}`)?.focus();
  };

  return (
    <>
      <header class="chrome">
        <div class="brand">
          <img src="icons/icon.svg" alt="" />
          <h1>Grammaid</h1>
        </div>
        <div class="seg" role="tablist" aria-label="Grammaid sections" onKeyDown={onKey}>
          <span class="thumb" style={{ width: `calc((100% - 4px) / ${TABS.length})`, transform: `translateX(${index * 100}%)` }} />
          {TABS.map((t, i) => (
            <button
              key={t}
              id={`tab-${i}`}
              role="tab"
              aria-selected={t === tab}
              aria-controls="panel"
              tabIndex={t === tab ? 0 : -1}
              // respond on press, not release
              onPointerDown={() => setTab(t)}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </header>
      <main id="panel" aria-labelledby={`tab-${index}`}>
        {(tab === 'AI Check' || tab === 'Rewrite') && <ModelBanner status={status} refresh={refresh} />}
        {/* Every tab stays mounted so text you typed survives switching tabs. */}
        <Check active={tab === 'Check'} />
        <AiCheck active={tab === 'AI Check'} onModelActivity={refresh} />
        <Rewrite active={tab === 'Rewrite'} onModelActivity={refresh} />
        <Translate active={tab === 'Translate'} />
        <Stats active={tab === 'Stats'} />
        <Settings active={tab === 'Settings'} status={status} refreshStatus={refresh} />
      </main>
    </>
  );
}
