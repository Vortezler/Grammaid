// Routes typed requests from the content script and sidebar to the engines.
// Every handler resolves to { ok, data } or { ok: false, error }: nothing is ever thrown at callers.
import type { ContentRequest, ExportBundle, ModelStatus, PageText, Request, ResponseMap, Result } from '../shared/types';
import { normalizeSettings } from '../shared/settings';
import type { LintPipeline } from './lint';
import type { TransformersLanguageModel } from './model';
import type { SpellingStore } from './spelling-store';
import { getSettings, setSettings } from './settings';
import { findSynonyms, type Lexicon } from './synonyms';
import { rephraseText } from './rephrase';
import { detect } from './detector';
import { cacheSize, clearCache } from './model-cache';

export interface Services {
  lint: LintPipeline;
  model: TransformersLanguageModel;
  spelling: SpellingStore;
  lexicon: () => Promise<Lexicon>;
}

type Handlers = { [K in Request['type']]: (req: Extract<Request, { type: K }>) => Promise<ResponseMap[K]> };

async function modelStatus(model: TransformersLanguageModel): Promise<ModelStatus> {
  let cacheBytes: number | undefined;
  try {
    cacheBytes = await cacheSize();
  } catch {
    cacheBytes = undefined;
  }
  return { ...model.status(), cacheBytes };
}

async function askActiveTab(source: 'field' | 'selection'): Promise<PageText | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return null;
  const message: ContentRequest = { type: 'get-page-text', source };
  try {
    const reply = (await browser.tabs.sendMessage(tab.id, message)) as PageText | null | undefined;
    return reply ?? null;
  } catch {
    return null;
  }
}

export function createHandlers(s: Services): Handlers {
  return {
    lint: (req) => s.lint.lint(req.text),

    synonyms: async (req) => findSynonyms(await s.lexicon(), s.model, req.sentence, req.word, req.wordStart),

    rephrase: (req) => rephraseText(s.model, req.text),

    detect: async (req) => detect(req.text, s.model, (await getSettings()).detectorMinWords),

    'spelling-accepted': async (req) => {
      await s.spelling.record(req.typo, req.correction);
      return null;
    },

    'get-stats': () => s.spelling.all(),

    'reset-stats': async () => {
      await s.spelling.reset();
      return null;
    },

    'get-settings': () => getSettings(),

    'set-settings': (req) => setSettings(req.patch),

    'add-word': async (req) => {
      const word = req.word.trim();
      const current = await getSettings();
      if (!word || current.userDictionary.some((w) => w.toLowerCase() === word.toLowerCase())) return current;
      return setSettings({ userDictionary: [...current.userDictionary, word] });
    },

    'model-status': () => modelStatus(s.model),

    'model-load': async () => {
      // Start both downloads; progress is read back through model-status.
      void s.model
        .ensureGpt2()
        .then(() => s.model.ensureT5())
        .catch(() => undefined);
      return modelStatus(s.model);
    },

    'model-clear': async () => {
      await s.model.unload();
      await clearCache();
      return modelStatus(s.model);
    },

    'open-sidebar': async () => {
      try {
        await browser.sidebarAction.open();
        return { opened: true };
      } catch {
        // sidebarAction.open() only works inside a user-input handler; the page asks its user
        // to press Alt+Shift+G instead.
        return { opened: false };
      }
    },

    'get-page-text': (req) => askActiveTab(req.source),

    'export-data': async (): Promise<ExportBundle> => ({
      app: 'grammaid',
      version: 1,
      settings: await getSettings(),
      spellStats: await s.spelling.all(),
    }),

    'import-data': async (req) => {
      const data = req.data as Partial<ExportBundle> | null;
      if (!data || data.app !== 'grammaid') throw new Error('That file is not a Grammaid export.');
      if (data.settings) await setSettings(normalizeSettings(data.settings));
      if (data.spellStats) await s.spelling.replace(data.spellStats);
      return null;
    },
  };
}

export function listen(handlers: Handlers): void {
  browser.runtime.onMessage.addListener((message: unknown): Promise<Result<unknown>> | undefined => {
    const req = message as Request | null;
    if (!req || typeof req !== 'object' || typeof req.type !== 'string' || !(req.type in handlers)) return undefined;
    const handler = handlers[req.type] as (r: Request) => Promise<unknown>;
    return handler(req).then(
      (data): Result<unknown> => ({ ok: true, data }),
      (e): Result<unknown> => {
        console.error(`Grammaid: "${req.type}" failed`, e);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      },
    );
  });
}
