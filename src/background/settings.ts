// Settings live in browser.storage.local under "settings". The background page is the only writer.
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../shared/settings';

type Listener = (next: Settings, prev: Settings) => void;

const KEY = 'settings';
let current: Settings = DEFAULT_SETTINGS;
let loaded: Promise<Settings> | null = null;
const listeners = new Set<Listener>();

export function loadSettings(): Promise<Settings> {
  loaded ??= browser.storage.local.get(KEY).then((raw) => {
    current = normalizeSettings(raw[KEY]);
    return current;
  });
  return loaded;
}

export async function getSettings(): Promise<Settings> {
  await loadSettings();
  return current;
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  await loadSettings();
  const prev = current;
  current = normalizeSettings({
    ...prev,
    ...patch,
    categories: { ...prev.categories, ...(patch.categories ?? {}) },
  });
  await browser.storage.local.set({ [KEY]: current });
  for (const l of listeners) {
    try {
      l(current, prev);
    } catch (e) {
      console.error('Grammaid settings listener failed', e);
    }
  }
  return current;
}

export function onSettingsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
