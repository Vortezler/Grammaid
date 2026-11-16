import modelFiles from '../data/translation-models.json';

/** Explicit language choices: never silently substitute a neighbouring language. */
export const TRANSLATION_LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', group: 'World' },
  { code: 'es', name: 'Spanish', native: 'Español', group: 'World' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', native: '简体中文', group: 'World' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文', group: 'World' },
  { code: 'pt', name: 'Portuguese', native: 'Português', group: 'World' },
  { code: 'ru', name: 'Russian', native: 'Русский', group: 'World' },
  { code: 'de', name: 'German', native: 'Deutsch', group: 'World' },
  { code: 'fr', name: 'French', native: 'Français', group: 'World' },
  { code: 'ja', name: 'Japanese', native: '日本語', group: 'World' },
  { code: 'ko', name: 'Korean', native: '한국어', group: 'World' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', group: 'World' },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া', group: 'India' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', group: 'India' },
  { code: 'bodo', name: 'Bodo', native: 'बड़ो', group: 'India' },
  { code: 'doi', name: 'Dogri', native: 'डोगरी', group: 'India' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', group: 'India' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', group: 'India' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', group: 'India' },
  { code: 'ks', name: 'Kashmiri', native: 'کٲشُر', group: 'India' },
  { code: 'gom', name: 'Konkani', native: 'कोंकणी', group: 'India' },
  { code: 'mai', name: 'Maithili', native: 'मैथिली', group: 'India' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', group: 'India' },
  { code: 'mni-Mtei', name: 'Manipuri (Meitei)', native: 'ꯃꯤꯇꯩꯂꯣꯟ', group: 'India' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', group: 'India' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', group: 'India' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', group: 'India' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', group: 'India' },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्', group: 'India' },
  { code: 'sat', name: 'Santali (Ol Chiki)', native: 'ᱥᱟᱱᱛᱟᱲᱤ', group: 'India' },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي', group: 'India' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', group: 'India' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', group: 'India' },
  { code: 'ur', name: 'Urdu', native: 'اردو', group: 'India' },
] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number]['code'];
export type TranslationSource = TranslationLanguage;
export const MAX_TRANSLATION_CHARS = 2000;

export function translationLanguage(code: string) {
  return TRANSLATION_LANGUAGES.find((language) => language.code === code);
}

export function validateTranslation(text: unknown, source: string, target: string): asserts text is string {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter some text to translate.');
  if (text.length > MAX_TRANSLATION_CHARS) throw new Error(`Use at most ${MAX_TRANSLATION_CHARS.toLocaleString('en-US')} characters per translation.`);
  if (!translationLanguage(source)) throw new Error('Choose a supported source language.');
  if (!translationLanguage(target)) throw new Error('Choose a supported target language.');
}

export type TranslationModelId = keyof typeof modelFiles;
export const TRANSLATION_MODELS = modelFiles as Record<TranslationModelId, { revision: string; files: { name: string; bytes: number }[] }>;
const opus = (pair: string) => `Xenova/opus-mt-${pair}` as TranslationModelId;
const INDIC_OUT: TranslationModelId = 'hari31416/indictrans2-en-indic-dist-200M-ONNX-int8';
const INDIC_IN: TranslationModelId = 'hari31416/indictrans2-indic-en-dist-200M-ONNX-int8';
const NLLB: TranslationModelId = 'Xenova/nllb-200-distilled-600M';
const INDIC: Partial<Record<TranslationLanguage, string>> = { bodo: 'brx_Deva', doi: 'doi_Deva', ks: 'kas_Arab', gom: 'gom_Deva', 'mni-Mtei': 'mni_Mtei', ne: 'npi_Deva', sat: 'sat_Olck' };
const MULTI: Partial<Record<TranslationLanguage, string>> = { as: 'asm', bn: 'ben', gu: 'guj', kn: 'kan', mai: 'mai', ml: 'mal', mr: 'mar', or: 'ori', pa: 'pan_Guru', sa: 'san_Deva', sd: 'snd_Arab', ta: 'tam', te: 'tel', ur: 'urd', ja: 'jpn', 'zh-TW': 'cmn_Hant' };
const DEDICATED = new Set<TranslationLanguage>(['es', 'fr', 'de', 'ru', 'nl', 'hi']);

export interface TranslationLeg { model: TranslationModelId; source: TranslationLanguage; target: TranslationLanguage; prefix?: string; indic?: { source: string; target: string }; nllb?: { source: string; target: string } }
function leg(language: TranslationLanguage, outgoing: boolean): TranslationLeg {
  const source = outgoing ? 'en' : language;
  const target = outgoing ? language : 'en';
  const indic = INDIC[language];
  if (indic) return { model: outgoing ? INDIC_OUT : INDIC_IN, source, target, indic: { source: outgoing ? 'eng_Latn' : indic, target: outgoing ? indic : 'eng_Latn' } };
  if (language === 'ko' && outgoing) return { model: NLLB, source, target, nllb: { source: 'eng_Latn', target: 'kor_Hang' } };
  if (language === 'ko' || language === 'ja' && !outgoing) return { model: opus(`${language}-en`), source, target };
  if (language === 'pt') return { model: opus(outgoing ? 'en-ROMANCE' : 'ROMANCE-en'), source, target, prefix: outgoing ? '>>pt<< ' : undefined };
  if (language === 'zh-CN' || language === 'zh-TW' && !outgoing) return { model: opus(outgoing ? 'en-zh' : 'zh-en'), source, target };
  if (DEDICATED.has(language)) return { model: opus(outgoing ? `en-${language}` : `${language}-en`), source, target };
  const token = MULTI[language];
  if (!token) throw new Error(`No verified local pack for ${language}.`);
  return { model: opus(outgoing ? 'en-mul' : 'mul-en'), source, target, prefix: outgoing ? `>>${token}<< ` : undefined };
}

export function translationPlan(source: TranslationLanguage, target: TranslationLanguage): TranslationLeg[] {
  if (!translationLanguage(source) || !translationLanguage(target)) throw new Error('Choose supported languages.');
  if (source === target) return [];
  return [...(source === 'en' ? [] : [leg(source, false)]), ...(target === 'en' ? [] : [leg(target, true)])];
}
export function packModels(language: TranslationLanguage): TranslationModelId[] {
  return [...new Set([...translationPlan('en', language), ...translationPlan(language, 'en')].map((step) => step.model))];
}
export const modelUrl = (id: TranslationModelId, file: string) => `https://huggingface.co/${id}/resolve/${TRANSLATION_MODELS[id].revision}/${file}`;
export interface TranslationPackStatus { language: TranslationLanguage; state: 'missing' | 'downloading' | 'ready' | 'error'; bytes: number; downloadBytes: number; progress?: number; error?: string; shared: boolean }
export interface TranslationResult { text: string; source: TranslationLanguage; target: TranslationLanguage; viaEnglish: boolean }
