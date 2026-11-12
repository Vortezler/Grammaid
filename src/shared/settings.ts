export type DialectName = 'American' | 'British' | 'Canadian' | 'Australian';

export interface Settings {
  enabled: boolean;
  /** Sites (hostnames) where Grammaid checks every text field automatically. */
  enabledSites: string[];
  dialect: DialectName;
  categories: { spelling: boolean; grammar: boolean; style: boolean };
  rewriteModelId: string;
  scoringModelId: string;
  detectorMinWords: number;
  userDictionary: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  enabledSites: [],
  dialect: 'American',
  categories: { spelling: true, grammar: true, style: true },
  rewriteModelId: 'Xenova/flan-t5-small',
  scoringModelId: 'Xenova/distilgpt2',
  detectorMinWords: 100,
  userDictionary: [],
};

export const MAX_LINT_CHARS = 20000;
export const LINT_DEBOUNCE_MS = 700;

/** Fill in anything missing from stored settings so old data keeps working. */
export function normalizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const d = DEFAULT_SETTINGS;
  const clean = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []);
  const strings = (v: unknown): string[] => [...new Set(clean(v))];
  const dialects: DialectName[] = ['American', 'British', 'Canadian', 'Australian'];
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled,
    enabledSites: [...new Set(clean(s.enabledSites).map(cleanHost).filter(Boolean))],
    dialect: dialects.includes(s.dialect as DialectName) ? (s.dialect as DialectName) : d.dialect,
    categories: {
      spelling: s.categories?.spelling ?? true,
      grammar: s.categories?.grammar ?? true,
      style: s.categories?.style ?? true,
    },
    rewriteModelId: typeof s.rewriteModelId === 'string' && s.rewriteModelId.trim() ? s.rewriteModelId.trim() : d.rewriteModelId,
    scoringModelId: typeof s.scoringModelId === 'string' && s.scoringModelId.trim() ? s.scoringModelId.trim() : d.scoringModelId,
    detectorMinWords:
      typeof s.detectorMinWords === 'number' && Number.isFinite(s.detectorMinWords)
        ? Math.min(1000, Math.max(30, Math.round(s.detectorMinWords)))
        : d.detectorMinWords,
    userDictionary: strings(s.userDictionary),
  };
}

/** Reduces whatever the user typed ("https://Example.com/path") to a bare hostname. */
export function cleanHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

/** True when this hostname is on the user's list (exact match or a subdomain of a listed site). */
export function isSiteEnabled(settings: Settings, hostname: string): boolean {
  const host = cleanHost(hostname);
  if (!host) return false;
  return settings.enabledSites.some((site) => host === site || host.endsWith('.' + site));
}

/** Hostname of a URL, or '' for pages without one (about:, file:, ...). */
export function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}
