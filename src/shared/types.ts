// Message and data shapes shared by the background page, content script and sidebar.
import type { Settings } from './settings';
import type { TranslationLanguage, TranslationPackStatus, TranslationResult } from './translation';
import type { TypingControl, TypingField, TypingOptions, TypingStatus, TypingTab, TypingTarget } from './typing';
import type { SpeechOptions, SpeechResult, SpeechStatus } from './speech';

export type IssueKind = 'spelling' | 'grammar' | 'style';

export interface Issue {
  start: number;
  end: number;
  kind: IssueKind;
  message: string;
  suggestions: string[];
  rule: string;
}

export interface SynonymResult {
  word: string;
  gloss: string;
  score: number;
  /** Characters before the word that must change too (an "a"/"an" fix). */
  before?: { length: number; text: string };
}

export interface SynonymResponse {
  original: string;
  results: SynonymResult[];
  /** False when the language model was unavailable and results are in WordNet order. */
  ranked: boolean;
  modelError?: string;
}

export interface RephraseOption {
  text: string;
  source: 'model' | 'tighten' | 'active-hint';
  note?: string;
}

export interface RephraseResponse {
  options: RephraseOption[];
  /** Set when the model could not be used; deterministic options are still returned. */
  modelError?: string;
}

export type SentenceBand = 'ok' | 'uncertain' | 'flagged' | 'skipped';

export interface SentenceScore {
  text: string;
  start: number;
  end: number;
  words: number;
  perplexity: number;
  score: number;
  band: SentenceBand;
}

export interface SignalNote {
  name: string;
  value: string;
  direction: 'up' | 'down' | 'neutral';
  detail: string;
}

export type DetectResult =
  | { tooShort: true; words: number; minWords: number }
  | {
      tooShort: false;
      percent: number;
      label: 'Likely human' | 'Mixed' | 'Likely AI';
      threshold: number;
      sentences: SentenceScore[];
      signals: SignalNote[];
      words: number;
    };

export interface SpellEntry {
  total: number;
  lastSeen: number;
  firstSeen: number;
  forms: Record<string, number>;
}
export type SpellStats = Record<string, SpellEntry>;

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
export interface ModelStatus {
  gpt2: LoadState;
  t5: LoadState;
  progress?: number;
  error?: string;
  cacheBytes?: number;
}

export interface PageText {
  text: string;
  source: 'field' | 'selection';
}

export interface ExportBundle {
  app: 'grammaid';
  version: 1;
  settings: Settings;
  spellStats: SpellStats;
}

/** Requests handled by the background page. */
export type Request =
  | { type: 'open-settings' }
  | { type: 'speech-status' }
  | { type: 'speech-download' }
  | { type: 'speech-download-cancel' }
  | { type: 'speech-remove' }
  | { type: 'speech-open-recorder' }
  | { type: 'speech-transcribe'; jobId: string; pcm: string; language: string; options: SpeechOptions }
  | { type: 'speech-cancel'; jobId: string }
  | { type: 'lint'; text: string }
  | { type: 'typing-tabs' }
  | { type: 'typing-targets'; tabId: number }
  | { type: 'typing-targets-report'; nonce: string; fields: TypingField[]; frame: string }
  | { type: 'typing-locate'; target: TypingTarget }
  | { type: 'typing-start'; target: TypingTarget; text: string; options: TypingOptions }
  | { type: 'typing-status' }
  | { type: 'typing-status-report'; status: TypingStatus }
  | { type: 'typing-control'; action: TypingControl }
  | { type: 'synonyms'; sentence: string; word: string; wordStart: number }
  | { type: 'rephrase'; text: string }
  | { type: 'translate'; text: string; source: TranslationLanguage; target: TranslationLanguage }
  | { type: 'translation-packs' }
  | { type: 'translation-download'; language: TranslationLanguage }
  | { type: 'translation-cancel' }
  | { type: 'translation-remove'; language: TranslationLanguage }
  | { type: 'detect'; text: string }
  | { type: 'spelling-accepted'; typo: string; correction: string }
  | { type: 'get-stats' }
  | { type: 'reset-stats' }
  | { type: 'get-settings' }
  | { type: 'set-settings'; patch: Partial<Settings> }
  | { type: 'add-word'; word: string }
  | { type: 'model-status' }
  | { type: 'model-load' }
  | { type: 'model-clear' }
  | { type: 'open-sidebar' }
  | { type: 'get-activation' }
  | { type: 'toggle-tab' }
  | { type: 'get-page-text'; source: 'field' | 'selection' }
  | { type: 'export-data' }
  | { type: 'import-data'; data: ExportBundle };

export interface ResponseMap {
  'open-settings': null;
  'speech-status': SpeechStatus;
  'speech-download': null;
  'speech-download-cancel': null;
  'speech-remove': null;
  'speech-open-recorder': null;
  'speech-transcribe': SpeechResult;
  'speech-cancel': null;
  lint: Issue[];
  'typing-tabs': TypingTab[];
  'typing-targets': TypingTarget[];
  'typing-targets-report': null;
  'typing-locate': null;
  'typing-start': TypingStatus;
  'typing-status': TypingStatus;
  'typing-status-report': null;
  'typing-control': TypingStatus;
  synonyms: SynonymResponse;
  rephrase: RephraseResponse;
  translate: TranslationResult;
  'translation-packs': TranslationPackStatus[];
  'translation-download': null;
  'translation-cancel': null;
  'translation-remove': null;
  detect: DetectResult;
  'spelling-accepted': null;
  'get-stats': SpellStats;
  'reset-stats': null;
  'get-settings': Settings;
  'set-settings': Settings;
  'add-word': Settings;
  'model-status': ModelStatus;
  'model-load': ModelStatus;
  'model-clear': ModelStatus;
  'open-sidebar': { opened: boolean };
  'get-activation': Activation;
  'toggle-tab': Activation;
  'get-page-text': PageText | null;
  'export-data': ExportBundle;
  'import-data': null;
}

/** Whether Grammaid scans the current tab, and why. */
export interface Activation {
  active: boolean;
  /** The tab's site is on the user's list. */
  site: boolean;
  /** The user switched Grammaid on for this tab (toolbar button). */
  tab: boolean;
  host: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Messages the background sends to a tab's content script. */
export type ContentRequest =
  | { type: 'typing-discover'; nonce: string }
  | { type: 'typing-locate'; fieldId: string }
  | { type: 'typing-start-in-field'; jobId: string; fieldId: string; text: string; options: TypingOptions }
  | { type: 'typing-control-in-field'; jobId: string; action: TypingControl }
  | { type: 'typing-get-state'; jobId: string }
  | { type: 'run-action'; action: 'synonyms' | 'rephrase' }
  | { type: 'activation-changed'; activation: Activation; announce: boolean }
  | { type: 'get-page-text'; source: 'field' | 'selection' };

/** Typed wrapper around runtime.sendMessage; never throws. */
export async function send<R extends Request>(req: R): Promise<Result<ResponseMap[R['type']]>> {
  try {
    const res = (await browser.runtime.sendMessage(req)) as Result<ResponseMap[R['type']]> | undefined;
    return res ?? { ok: false, error: 'Grammaid did not respond. Try reloading the extension.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
