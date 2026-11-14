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
export type TranslationSource = TranslationLanguage | 'auto';
export const MAX_TRANSLATION_CHARS = 5000;

export function translationLanguage(code: string) {
  return TRANSLATION_LANGUAGES.find((language) => language.code === code);
}

export function validateTranslation(text: unknown, source: string, target: string): asserts text is string {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter some text to translate.');
  if (text.length > MAX_TRANSLATION_CHARS) throw new Error(`Use at most ${MAX_TRANSLATION_CHARS.toLocaleString('en-US')} characters per translation.`);
  if (source !== 'auto' && !translationLanguage(source)) throw new Error('Choose a supported source language.');
  if (!translationLanguage(target)) throw new Error('Choose a supported target language.');
}

export type TranslationProvider = 'Google Translate' | 'Bing Translator';
const BING_ONLY: readonly string[] = ['bodo', 'ks'];
const GOOGLE_ONLY: readonly string[] = ['mni-Mtei', 'sat'];

/** Some pairs need an English intermediate because neither website covers both languages. */
export function translationPlan(source: TranslationSource, target: TranslationLanguage): { provider: TranslationProvider; bridge: boolean } {
  const bing = BING_ONLY.includes(source) || BING_ONLY.includes(target);
  const google = GOOGLE_ONLY.includes(source) || GOOGLE_ONLY.includes(target);
  return { provider: BING_ONLY.includes(source) || (bing && !google) ? 'Bing Translator' : 'Google Translate', bridge: bing && google };
}

/** Normal website navigation only: no API requests, credentials, scraping, or remote code. */
export function translationUrl(text: string, source: TranslationSource, target: TranslationLanguage): string {
  validateTranslation(text, source, target);
  const plan = translationPlan(source, target);
  if (plan.bridge) throw new Error('Translate this pair through English in two steps.');
  if (plan.provider === 'Bing Translator') {
    const codes: Record<string, string> = { auto: 'auto-detect', bodo: 'brx', 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', gom: 'kok' };
    const url = new URL('https://www.bing.com/translator');
    url.search = new URLSearchParams({ from: codes[source] ?? source, to: codes[target] ?? target, text }).toString();
    return url.href;
  }
  const url = new URL('https://translate.google.com/');
  url.search = new URLSearchParams({ sl: source, tl: target, text, op: 'translate' }).toString();
  return url.href;
}
