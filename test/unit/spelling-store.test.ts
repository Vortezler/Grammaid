import { describe, expect, it } from 'vitest';
import { leaderboard, recordFix, sanitizeStats, SpellingStore, toCsv, toJson, topForms, type KeyValueStorage } from '../../src/background/spelling-store';
import { cleanHost, hostOf, isSiteEnabled, normalizeSettings, DEFAULT_SETTINGS } from '../../src/shared/settings';
import { decide } from '../../src/background/activation';
import type { SpellStats } from '../../src/shared/types';

function memoryStorage(initial: Record<string, unknown> = {}): KeyValueStorage & { data: Record<string, unknown>; writes: number } {
  const store = {
    data: { ...initial },
    writes: 0,
    async get(key: string) {
      return key in store.data ? { [key]: store.data[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      store.writes++;
      Object.assign(store.data, structuredClone(items));
    },
  };
  return store;
}

const build = (fixes: [string, string, number][]): SpellStats => fixes.reduce<SpellStats>((s, [typo, word, t]) => recordFix(s, typo, word, t), {});

describe('recordFix', () => {
  it('records the pair under the lowercased correct word', () => {
    const s = recordFix({}, 'Definately', 'Definitely', 1000);
    expect(s).toEqual({ definitely: { total: 1, firstSeen: 1000, lastSeen: 1000, forms: { definately: 1 } } });
  });

  it('accumulates counts and tracks first/last seen', () => {
    const s = build([['definately', 'definitely', 1], ['definitly', 'definitely', 2], ['definately', 'definitely', 3]]);
    expect(s.definitely).toEqual({ total: 3, firstSeen: 1, lastSeen: 3, forms: { definately: 2, definitly: 1 } });
  });

  it('ignores identical pairs (any case), empty values and overlong entries', () => {
    const base: SpellStats = {};
    expect(recordFix(base, 'Word', 'word')).toBe(base);
    expect(recordFix(base, '', 'word')).toBe(base);
    expect(recordFix(base, 'wrod', '  ')).toBe(base);
    expect(recordFix(base, 'x'.repeat(41), 'word')).toBe(base);
    expect(recordFix(base, 'wrod', 'y'.repeat(41))).toBe(base);
  });

  it('does not mutate the previous stats object', () => {
    const a = recordFix({}, 'teh', 'the', 1);
    const b = recordFix(a, 'teh', 'the', 2);
    expect(a.the.total).toBe(1);
    expect(b.the.total).toBe(2);
  });
});

describe('leaderboard and topForms', () => {
  const stats = build([
    ['definately', 'definitely', 10],
    ['definately', 'definitely', 11],
    ['definitly', 'definitely', 12],
    ['recieve', 'receive', 20],
    ['recieve', 'receive', 21],
    ['recieve', 'receive', 30],
    ['teh', 'the', 5],
    ['seperate', 'separate', 40],
  ]);

  it('ranks by total, breaking ties by most recent', () => {
    const rows = leaderboard(stats);
    expect(rows.map((r) => r.word)).toEqual(['receive', 'definitely', 'separate', 'the']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(rows[0].total).toBe(3);
  });

  it('returns the top three misspellings ranked by count', () => {
    let s: SpellStats = {};
    const forms: [string, number][] = [['definately', 7], ['definitly', 3], ['defanitely', 1], ['definetly', 2]];
    for (const [typo, n] of forms) for (let i = 0; i < n; i++) s = recordFix(s, typo, 'definitely');
    expect(topForms(s, 'definitely')).toEqual([
      { typo: 'definately', count: 7 },
      { typo: 'definitly', count: 3 },
      { typo: 'definetly', count: 2 },
    ]);
    expect(topForms(s, 'Definitely', 1)).toEqual([{ typo: 'definately', count: 7 }]);
    expect(topForms(s, 'missing')).toEqual([]);
  });
});

describe('export', () => {
  const stats = build([['definately', 'definitely', 0], ['definately', 'definitely', 0], ['definitly', 'definitely', 86400000], ['te,h', 'the', 0]]);

  it('JSON is the stats object', () => {
    expect(JSON.parse(toJson(stats))).toEqual(stats);
  });

  it('CSV has the documented columns, one row per misspelling, with quoting', () => {
    const lines = toCsv(stats).trim().split('\n');
    expect(lines[0]).toBe('word,total,misspelling,count,lastSeen');
    expect(lines[1]).toBe('definitely,3,definately,2,1970-01-02T00:00:00.000Z');
    expect(lines[2]).toBe('definitely,3,definitly,1,1970-01-02T00:00:00.000Z');
    expect(lines[3]).toBe('the,1,"te,h",1,1970-01-01T00:00:00.000Z');
    expect(lines).toHaveLength(4);
  });
});

describe('sanitizeStats', () => {
  it('drops malformed entries and recomputes totals', () => {
    const out = sanitizeStats({
      Good: { total: 99, lastSeen: 5, firstSeen: 1, forms: { GOOOD: 2, bad: 'x', zero: 0 } },
      broken: 'nope',
      empty: { forms: {} },
    });
    expect(out).toEqual({ good: { total: 2, lastSeen: 5, firstSeen: 1, forms: { goood: 2 } } });
    expect(sanitizeStats(null)).toEqual({});
  });
});

describe('SpellingStore', () => {
  it('persists accepted fixes and reloads them', async () => {
    const storage = memoryStorage();
    const store = new SpellingStore(storage);
    await store.record('definately', 'definitely', 1);
    await store.record('definately', 'definitely', 2);
    expect((await new SpellingStore(storage).all()).definitely.total).toBe(2);
  });

  it('does not lose concurrent writes', async () => {
    const storage = memoryStorage();
    const store = new SpellingStore(storage);
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.record('teh', 'the', i)));
    expect((await store.all()).the.total).toBe(25);
    expect((storage.data.spellStats as SpellStats).the.total).toBe(25);
  });

  it('skips the write for ignored pairs, and resets', async () => {
    const storage = memoryStorage();
    const store = new SpellingStore(storage);
    await store.record('same', 'SAME');
    expect(storage.writes).toBe(0);
    await store.record('teh', 'the');
    await store.reset();
    expect(await store.all()).toEqual({});
    expect(storage.data.spellStats).toEqual({});
  });
});

describe('settings', () => {
  it('fills defaults and repairs bad values', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = normalizeSettings({ dialect: 'Klingon', detectorMinWords: 5, enabledSites: ['https://Example.COM/page', 'example.com', 'www.example.com', 7], categories: { style: false } });
    expect(s.dialect).toBe('American');
    expect(s.detectorMinWords).toBe(30);
    expect(s.enabledSites).toEqual(['example.com']);
    expect(s.categories).toEqual({ spelling: true, grammar: true, style: false });
  });

  it('matches listed sites by host and subdomain only', () => {
    const s = { ...DEFAULT_SETTINGS, enabledSites: ['example.com'] };
    expect(isSiteEnabled(s, 'example.com')).toBe(true);
    expect(isSiteEnabled(s, 'mail.Example.com')).toBe(true);
    expect(isSiteEnabled(s, 'www.example.com')).toBe(true);
    expect(isSiteEnabled(s, 'notexample.com')).toBe(false);
    expect(isSiteEnabled(s, '')).toBe(false);
    expect(isSiteEnabled(DEFAULT_SETTINGS, 'example.com')).toBe(false);
  });

  it('reduces what the user types to a hostname', () => {
    expect(cleanHost(' https://www.Example.com:8080/a/b?c#d ')).toBe('example.com');
    expect(cleanHost('docs.example.com')).toBe('docs.example.com');
    expect(hostOf('https://mail.example.com/inbox')).toBe('mail.example.com');
    expect(hostOf('not a url')).toBe('');
    expect(hostOf(undefined)).toBe('');
  });
});

describe('activation: where Grammaid scans', () => {
  const listed = { ...DEFAULT_SETTINGS, enabledSites: ['example.com'] };

  it('is off by default, on every site', () => {
    expect(decide(DEFAULT_SETTINGS, 'https://example.com/', false)).toEqual({ active: false, site: false, tab: false, host: 'example.com' });
    expect(decide(DEFAULT_SETTINGS, 'about:blank', false).active).toBe(false);
  });

  it('is on for listed sites and their subdomains only', () => {
    expect(decide(listed, 'https://example.com/write', false)).toMatchObject({ active: true, site: true, tab: false });
    expect(decide(listed, 'https://mail.example.com/', false).active).toBe(true);
    expect(decide(listed, 'https://other.org/', false).active).toBe(false);
  });

  it('is on in a tab the user activated, whatever the site', () => {
    expect(decide(DEFAULT_SETTINGS, 'https://other.org/', true)).toMatchObject({ active: true, site: false, tab: true });
    expect(decide(DEFAULT_SETTINGS, undefined, true).active).toBe(true);
  });

  it('the master switch overrides both', () => {
    const off = { ...listed, enabled: false };
    expect(decide(off, 'https://example.com/', false).active).toBe(false);
    expect(decide(off, 'https://other.org/', true).active).toBe(false);
  });
});
