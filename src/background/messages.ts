// Routes typed requests from the content script and sidebar to the engines.
// Every handler resolves to { ok, data } or { ok: false, error }: nothing is ever thrown at callers.
import type { ContentRequest, ExportBundle, ModelStatus, PageText, Request, ResponseMap, Result } from '../shared/types';
import { normalizeSettings } from '../shared/settings';
import type { LintPipeline } from './lint';
import type { TransformersLanguageModel } from './model';
import type { SpellingStore } from './spelling-store';
import { getSettings, setSettings } from './settings';
import type { Lexicon } from './synonyms';
import { cacheSize, clearCache } from './model-cache';
import { activationFor, activeTab, toggleTab } from './activation';
import type { LocalTranslator } from './translation';
import type { TypingCoordinator } from './typing';
import type { LocalSpeech } from './speech';
import { ensureContent } from './injection';

export interface Engines {
  lint: LintPipeline;
  model: TransformersLanguageModel;
  lexicon: () => Promise<Lexicon>;
  translator: LocalTranslator;
  speech: LocalSpeech;
}
export interface Services { engines: () => Promise<Engines>; peekEngines: () => Engines | null; spelling: SpellingStore; typing: TypingCoordinator }

type Sender = { tab?: { id?: number; url?: string }; frameId?: number };
type Handlers = { [K in Request['type']]: (req: Extract<Request, { type: K }>, sender: Sender) => Promise<ResponseMap[K]> };

async function modelStatus(model?: TransformersLanguageModel): Promise<ModelStatus> {
  let cacheBytes: number | undefined;
  try {
    cacheBytes = await cacheSize();
  } catch {
    cacheBytes = undefined;
  }
  return { ...(model?.status() ?? { gpt2: 'idle' as const, t5: 'idle' as const }), cacheBytes };
}

async function askActiveTab(source: 'field' | 'selection'): Promise<PageText | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return null;
  const message: ContentRequest = { type: 'get-page-text', source };
  try {
    await ensureContent(tab.id);
    const reply = (await browser.tabs.sendMessage(tab.id, message)) as PageText | null | undefined;
    return reply ?? null;
  } catch {
    return null;
  }
}

export function createHandlers(s: Services): Handlers {
  return {
    'speech-status': async () => (await s.engines()).speech.status(),
    'speech-download': async () => { await (await s.engines()).speech.startDownload(); return null; },
    'speech-download-cancel': async () => { s.peekEngines()?.speech.cancelDownload(); return null; },
    'speech-remove': async () => { await (await s.engines()).speech.remove(); return null; },
    'speech-open-recorder': async () => { await browser.tabs.create({ url: browser.runtime.getURL('speech.html') }); return null; },
    'speech-transcribe': async (req) => (await s.engines()).speech.transcribe(req.jobId, req.pcm, req.language, req.options),
    'speech-cancel': async (req) => { s.peekEngines()?.speech.cancel(req.jobId); return null; },
    lint: async (req) => (await s.engines()).lint.lint(req.text),
    'typing-tabs': () => s.typing.tabs(),
    'typing-targets': (req) => s.typing.discover(req.tabId),
    'typing-targets-report': async (req, sender) => { s.typing.reportTargets(req.nonce, req.fields, req.frame, sender); return null; },
    'typing-status-report': async (req, sender) => { s.typing.update(req.status, sender); return null; },
    'typing-locate': async (req) => { await s.typing.locate(req.target); return null; },
    'typing-start': (req) => s.typing.start(req.target, req.text, req.options),
    'typing-status': () => s.typing.status(),
    'typing-control': (req) => s.typing.control(req.action),

    synonyms: async (req) => { const engine = await s.engines(); return (await import('./synonyms')).findSynonyms(await engine.lexicon(), engine.model, req.sentence, req.word, req.wordStart); },

    rephrase: async (req) => (await import('./rephrase')).rephraseText((await s.engines()).model, req.text),

    translate: async (req) => (await s.engines()).translator.translate(req.text, req.source, req.target),
    'translation-packs': async () => (await s.engines()).translator.status(),
    'translation-download': async (req) => { await (await s.engines()).translator.startDownload(req.language); return null; },
    'translation-cancel': async () => { s.peekEngines()?.translator.cancelDownload(); return null; },
    'translation-remove': async (req) => { await (await s.engines()).translator.remove(req.language); return null; },

    detect: async (req) => (await import('./detector')).detect(req.text, (await s.engines()).model, (await getSettings()).detectorMinWords),

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

    'model-status': () => modelStatus(s.peekEngines()?.model),
    'open-settings': async () => { await browser.runtime.openOptionsPage(); return null; },

    'model-load': async () => {
      const { model } = await s.engines();
      // Start both downloads; progress is read back through model-status.
      void model
        .ensureGpt2()
        .then(() => model.ensureT5())
        .catch(() => undefined);
      return modelStatus(model);
    },

    'model-clear': async () => {
      const engine = await s.engines();
      await engine.speech.unload();
      await engine.translator.unload();
      await engine.model.unload();
      await clearCache();
      await engine.translator.forgetPacks();
      return modelStatus(engine.model);
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

    // From a content script: its own tab. From the sidebar (no sender tab): the active tab.
    'get-activation': async (_req, sender) => activationFor(sender.tab ?? (await activeTab())),

    'toggle-tab': async (_req, sender) => toggleTab(sender.tab ?? (await activeTab())),

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
  browser.runtime.onMessage.addListener((message: unknown, sender: Sender): Promise<Result<unknown>> | undefined => {
    const req = message as Request | null;
    if (!req || typeof req !== 'object' || typeof req.type !== 'string' || !(req.type in handlers)) return undefined;
    const handler = handlers[req.type] as (r: Request, s: Sender) => Promise<unknown>;
    return handler(req, sender ?? {}).then(
      (data): Result<unknown> => ({ ok: true, data }),
      (e): Result<unknown> => {
        console.error(`Grammaid: "${req.type}" failed`, e);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      },
    );
  });
}
