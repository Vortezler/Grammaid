// Tracks accepted spelling fixes: which words the user misspells, how often, and in which forms.
// Pure functions operate on a SpellStats object; the SpellingStore class adds persistence.
import type { SpellStats } from '../shared/types';

const MAX_LEN = 40;

export interface LeaderboardRow {
  rank: number;
  word: string;
  total: number;
  lastSeen: number;
  firstSeen: number;
}

/** Returns a new stats object with the fix recorded, or the same object if the pair is ignored. */
export function recordFix(stats: SpellStats, typo: string, correction: string, now: number = Date.now()): SpellStats {
  const t = typo.trim().toLowerCase();
  const c = correction.trim().toLowerCase();
  if (!t || !c || t === c) return stats;
  if (t.length > MAX_LEN || c.length > MAX_LEN) return stats;
  const prev = stats[c];
  const entry = prev
    ? { ...prev, forms: { ...prev.forms } }
    : { total: 0, lastSeen: now, firstSeen: now, forms: {} as Record<string, number> };
  entry.total += 1;
  entry.lastSeen = now;
  entry.forms[t] = (entry.forms[t] ?? 0) + 1;
  return { ...stats, [c]: entry };
}

export function leaderboard(stats: SpellStats): LeaderboardRow[] {
  return Object.entries(stats)
    .sort(([, a], [, b]) => b.total - a.total || b.lastSeen - a.lastSeen)
    .map(([word, e], i) => ({ rank: i + 1, word, total: e.total, lastSeen: e.lastSeen, firstSeen: e.firstSeen }));
}

/** The most common misspellings of a word, most frequent first. */
export function topForms(stats: SpellStats, word: string, n = 3): { typo: string; count: number }[] {
  const entry = stats[word.toLowerCase()];
  if (!entry) return [];
  return Object.entries(entry.forms)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, n)
    .map(([typo, count]) => ({ typo, count }));
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with one row per (word, misspelling). Columns: word,total,misspelling,count,lastSeen */
export function toCsv(stats: SpellStats): string {
  const lines = ['word,total,misspelling,count,lastSeen'];
  for (const row of leaderboard(stats)) {
    const entry = stats[row.word];
    const forms = Object.entries(entry.forms).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
    for (const [typo, count] of forms) {
      lines.push([row.word, entry.total, typo, count, new Date(entry.lastSeen).toISOString()].map(csvCell).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

export const toJson = (stats: SpellStats): string => JSON.stringify(stats, null, 2);

/** Keeps only well-formed entries, so imported or hand-edited data cannot break the Stats tab. */
export function sanitizeStats(raw: unknown): SpellStats {
  const out: SpellStats = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [word, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || word.length > MAX_LEN) continue;
    const v = value as Record<string, unknown>;
    const forms: Record<string, number> = {};
    if (v.forms && typeof v.forms === 'object') {
      for (const [typo, count] of Object.entries(v.forms as Record<string, unknown>)) {
        if (typeof count === 'number' && count > 0 && typo.length <= MAX_LEN) forms[typo.toLowerCase()] = Math.floor(count);
      }
    }
    const total = Object.values(forms).reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : Date.now());
    out[word.toLowerCase()] = { total, lastSeen: num(v.lastSeen), firstSeen: num(v.firstSeen), forms };
  }
  return out;
}

export interface KeyValueStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Persistent store. Writes are serialized through one promise chain: single writer, no races. */
export class SpellingStore {
  static readonly KEY = 'spellStats';
  private stats: SpellStats | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private storage: KeyValueStorage) {}

  async all(): Promise<SpellStats> {
    if (!this.stats) {
      const raw = await this.storage.get(SpellingStore.KEY);
      this.stats = sanitizeStats(raw[SpellingStore.KEY]);
    }
    return this.stats;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  record(typo: string, correction: string, now: number = Date.now()): Promise<void> {
    return this.enqueue(async () => {
      const before = await this.all();
      const after = recordFix(before, typo, correction, now);
      if (after === before) return;
      this.stats = after;
      await this.storage.set({ [SpellingStore.KEY]: after });
    });
  }

  replace(stats: SpellStats): Promise<void> {
    return this.enqueue(async () => {
      this.stats = sanitizeStats(stats);
      await this.storage.set({ [SpellingStore.KEY]: this.stats });
    });
  }

  reset(): Promise<void> {
    return this.replace({});
  }
}
