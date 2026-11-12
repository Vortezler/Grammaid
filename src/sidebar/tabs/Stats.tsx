import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { send, type SpellStats } from '../../shared/types';
import { leaderboard, toCsv, toJson, topForms } from '../../background/spelling-store';
import { BarChart } from '../components/BarChart';

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const lastSeen = (ms: number) => {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString();
};

export function Stats({ active }: { active: boolean }) {
  const [stats, setStats] = useState<SpellStats | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef(0);

  const load = useCallback(() => {
    void send({ type: 'get-stats' }).then((res) => res.ok && setStats(res.data));
  }, []);

  // Refresh whenever the tab is shown, and live while it stays open.
  useEffect(() => {
    if (!active) return;
    load();
    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && 'spellStats' in changes) load();
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [active, load]);

  const reset = async () => {
    if (!confirming) {
      // Destructive and irreversible: ask once, and let the question expire by itself.
      setConfirming(true);
      window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => setConfirming(false), 5000);
      return;
    }
    window.clearTimeout(confirmTimer.current);
    setConfirming(false);
    await send({ type: 'reset-stats' });
    setOpen(null);
    load();
  };

  const rows = stats ? leaderboard(stats) : [];
  const totalFixes = rows.reduce((a, r) => a + r.total, 0);

  return (
    <section class="panel" hidden={!active}>
      <div class="stack">
        <h2>Spelling stats</h2>
        <p class="muted">Words you misspell most, counted each time you accept a spelling fix.</p>
      </div>

      {stats && rows.length === 0 && (
        <div class="card empty">
          <p>No spelling fixes yet.</p>
          <p class="small">Accept a spelling suggestion and it will show up here.</p>
        </div>
      )}

      {rows.length > 0 && stats && (
        <>
          <div class="card">
            <div class="row between">
              <h3>Top {Math.min(10, rows.length)} most misspelled</h3>
              <span class="small muted">{totalFixes} {totalFixes === 1 ? 'fix' : 'fixes'}</span>
            </div>
            <BarChart
              ariaLabel="Most misspelled words by number of accepted fixes"
              data={rows.slice(0, 10).map((r) => ({ label: r.word, value: r.total }))}
            />
          </div>

          <div class="card">
            <h3>Leaderboard</h3>
            <p class="small muted">Select a word to see how you usually misspell it.</p>
            <ol class="lb">
              {rows.map((r) => {
                const expanded = open === r.word;
                return (
                  <li key={r.word}>
                    <button class="lb-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.word)}>
                      <span class="rank">{r.rank}</span>
                      <span>
                        <span class="word">{r.word}</span> <span class="small muted">· {lastSeen(r.lastSeen)}</span>
                      </span>
                      <span class="count" aria-label={`${r.total} fixes`}>{r.total}</span>
                      <span class="chev" aria-hidden="true">›</span>
                    </button>
                    {expanded && (
                      <ol class="forms" aria-label={`Top misspellings of ${r.word}`}>
                        {topForms(stats, r.word, 3).map((f, i) => (
                          <li key={f.typo}>
                            <span class="rank muted">{i + 1}.</span>
                            <span class="typo">{f.typo}</span>
                            <span class="muted">×{f.count}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      )}

      <div class="row">
        <button disabled={rows.length === 0} onClick={() => stats && download('grammaid-spelling-stats.json', toJson(stats), 'application/json')}>
          Export JSON
        </button>
        <button disabled={rows.length === 0} onClick={() => stats && download('grammaid-spelling-stats.csv', toCsv(stats), 'text/csv')}>
          Export CSV
        </button>
        <span class="grow" />
        <button class="danger" disabled={rows.length === 0} onClick={reset}>
          {confirming ? 'Really delete all stats?' : 'Reset stats'}
        </button>
      </div>
    </section>
  );
}
