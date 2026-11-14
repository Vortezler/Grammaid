import { useEffect, useState } from 'preact/hooks';
import { send } from '../../shared/types';
import {
  MAX_TRANSLATION_CHARS, TRANSLATION_LANGUAGES, translationLanguage, translationPlan,
  type TranslationLanguage, type TranslationSource,
} from '../../shared/translation';

function LanguageOptions() {
  return <>{(['World', 'India'] as const).map((group) => (
    <optgroup label={group === 'India' ? 'India · all 22 scheduled languages' : 'Other languages'} key={group}>
      {TRANSLATION_LANGUAGES.filter((language) => language.group === group).map((language) => (
        <option key={language.code} value={language.code}>{language.name} · {language.native}</option>
      ))}
    </optgroup>
  ))}</>;
}

export function Translate({ active }: { active: boolean }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState<TranslationSource>('auto');
  const [target, setTarget] = useState<TranslationLanguage>('en');
  const [intermediate, setIntermediate] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [consentMode, setConsentMode] = useState<'loading' | 'builtin' | 'inline' | 'error'>('loading');
  const plan = translationPlan(source, target);

  useEffect(() => {
    if (!active) return;
    // Older Waterfox versions use the disclosure beside the explicit translate button.
    if (!browser.permissions?.getAll) { setConsentMode('inline'); return; }
    void browser.permissions.getAll().then(
      (permissions) => setConsentMode(permissions.data_collection ? 'builtin' : 'inline'),
      () => setConsentMode('error'),
    );
  }, [active]);

  const reset = () => { setNote(''); setIntermediate(''); };
  const pull = async () => {
    const res = await send({ type: 'get-page-text', source: 'selection' });
    if (res.ok && res.data?.text.trim()) { setText(res.data.text); reset(); }
    else setNote('Select text on the page first, then try again.');
  };
  const open = async (input: string, from: TranslationSource, to: TranslationLanguage) => {
    setBusy(true);
    setNote('');
    if (consentMode === 'builtin') {
      try {
        // Called directly from the button event, before any await, to retain the user gesture.
        const granted = await browser.permissions.request({ data_collection: ['websiteContent'] });
        if (!granted) { setNote('Translation was not opened. Website content permission was declined.'); setBusy(false); return; }
      } catch {
        setNote('Could not request translation permission. Try reopening the sidebar.'); setBusy(false); return;
      }
    }
    const res = await send({ type: 'translate-open', text: input, source: from, target: to });
    setBusy(false);
    setNote(res.ok ? `Opened ${res.data.provider} in a new tab. Read or copy your translation there.` : res.error);
  };

  return (
    <section class="panel" hidden={!active}>
      <div class="stack">
        <h2>Translate</h2>
        <p class="muted">Translate on the web. No API key, account or model download needed. Results open in a new tab.</p>
      </div>
      <div class="translation-languages">
        <label class="field">
          <span>From</span>
          <select aria-label="Source language" value={source} disabled={busy} onChange={(e) => { setSource(e.currentTarget.value as TranslationSource); reset(); }}>
            <option value="auto">Detect language</option><LanguageOptions />
          </select>
        </label>
        <button class="translation-swap" aria-label="Swap languages" disabled={busy || source === 'auto'} onClick={() => {
          if (source === 'auto') return;
          setSource(target); setTarget(source); reset();
        }}>⇄</button>
        <label class="field">
          <span>To</span>
          <select aria-label="Target language" value={target} disabled={busy} onChange={(e) => { setTarget(e.currentTarget.value as TranslationLanguage); reset(); }}><LanguageOptions /></select>
        </label>
      </div>
      <label class="field">
        <span>Text to translate</span>
        <textarea dir="auto" value={text} disabled={busy} onInput={(e) => { setText(e.currentTarget.value); reset(); }} placeholder="Type or paste text in any supported language" style={{ minHeight: '9rem' }} />
      </label>
      <p class={text.length > MAX_TRANSLATION_CHARS ? 'small error-text' : 'small muted'}>{text.length.toLocaleString()} / {MAX_TRANSLATION_CHARS.toLocaleString()} characters</p>
      <p class="disclaimer">
        Clicking a translate button sends that text to {plan.bridge ? 'Google Translate or Bing Translator (one per step)' : plan.provider}. It appears in the new tab’s URL and may be saved in browser history.
        Grammaid keeps no translation history. An internet connection is required.
      </p>
      {source === 'auto' && <p class="small muted">For Bodo or Kashmiri input, choose the source language explicitly so Grammaid can use Bing Translator.</p>}
      {source === target && <p class="small muted">Choose two different languages to translate.</p>}
      {plan.bridge && (
        <div class="card">
          <h3>Translate through English</h3>
          <p class="small muted">No single website here supports both of these languages. First translate to English, then paste that result below to translate into {translationLanguage(target)?.name}.</p>
        </div>
      )}
      <div class="row">
        <button class="primary" disabled={busy || consentMode === 'loading' || consentMode === 'error' || !text.trim() || text.length > MAX_TRANSLATION_CHARS || source === target} onClick={() => open(text, source, plan.bridge ? 'en' : target)}>
          {busy ? 'Opening…' : plan.bridge ? '1. Translate to English ↗' : `Translate with ${plan.provider} ↗`}
        </button>
        <button disabled={busy} onClick={pull}>Use selection</button>
        <button disabled={busy || !text} onClick={() => { setText(''); reset(); }}>Clear</button>
      </div>
      {plan.bridge && <div class="card">
        <label class="field"><span>English translation from step 1</span><textarea dir="auto" value={intermediate} disabled={busy} onInput={(e) => setIntermediate(e.currentTarget.value)} placeholder="Paste the English result here" /></label>
        <button class="primary" disabled={busy || consentMode === 'loading' || consentMode === 'error' || !intermediate.trim() || intermediate.length > MAX_TRANSLATION_CHARS} onClick={() => open(intermediate, 'en', target)}>2. Translate to {translationLanguage(target)?.name} ↗</button>
      </div>}
      {consentMode === 'error' && <p class="small error-text" role="alert">Could not check translation permission. Reopen the sidebar to retry.</p>}
      {note && <p class="small muted" role="status">{note}</p>}
      <details class="card"><summary>Languages and coverage</summary>
        <p class="small muted">{TRANSLATION_LANGUAGES.length} choices, including Simplified and Traditional Chinese and all 22 scheduled Indian languages. Bodo and Kashmiri use Bing Translator; other languages use Google Translate. Pairs between Bodo/Kashmiri and Manipuri/Santali use English in two steps. Translation quality and website availability vary.</p>
      </details>
    </section>
  );
}
