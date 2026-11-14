import { translationPlan, translationUrl, type TranslationLanguage, type TranslationSource } from '../shared/translation';

/** Only called for an explicit translate request; never fetches the provider's API. */
export async function openTranslation(text: string, source: TranslationSource, target: TranslationLanguage) {
  const url = translationUrl(text, source, target);
  if (browser.permissions?.getAll) {
    const permissions = await browser.permissions.getAll();
    if (permissions.data_collection && !permissions.data_collection.includes('websiteContent')) {
      throw new Error('Allow website content permission from the Translate tab before translating.');
    }
  }
  await browser.tabs.create({ url });
  return { provider: translationPlan(source, target).provider };
}
