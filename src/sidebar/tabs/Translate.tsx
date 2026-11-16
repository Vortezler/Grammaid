import { useEffect, useState } from 'preact/hooks';
import { send } from '../../shared/types';
import { MAX_TRANSLATION_CHARS, TRANSLATION_LANGUAGES, type TranslationLanguage, type TranslationPackStatus, type TranslationResult } from '../../shared/translation';

const size = (bytes: number) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.ceil(bytes / 1048576)} MB`;
function LanguageOptions() {
  return <>{(['World', 'India'] as const).map((group) => <optgroup label={group === 'India' ? 'India · 22 scheduled languages' : 'World languages'} key={group}>
    {TRANSLATION_LANGUAGES.filter((l) => l.group === group).map((l) => <option value={l.code} key={l.code}>{l.name} · {l.native}</option>)}
  </optgroup>)}</>;
}

export function Translate({ active }: { active: boolean }) {
  const [source, setSource] = useState<TranslationLanguage>('en');
  const [target, setTarget] = useState<TranslationLanguage>('es');
  const [text, setText] = useState('');
  const [packs, setPacks] = useState<TranslationPackStatus[]>([]);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [showPacks, setShowPacks] = useState(false);
  const refresh = async () => {
    const res = await send({ type: 'translation-packs' });
    if (res.ok) setPacks(res.data); else setNote(res.error);
  };
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [active]);
  const downloading = packs.some((p) => p.state === 'downloading');
  const ready = [source, target].every((code) => packs.some((p) => p.language === code && p.state === 'ready'));
  const reset = () => { setResult(null); setNote(''); };
  const manage = async (language: TranslationLanguage, remove = false) => {
    setNote('');
    const res = await send(remove ? { type: 'translation-remove', language } : { type: 'translation-download', language });
    if (!res.ok) setNote(res.error);
    await refresh();
  };
  const run = async () => {
    const input = text;
    setBusy(true); reset();
    const res = await send({ type: 'translate', text: input, source, target });
    setBusy(false);
    if (res.ok) setResult(res.data); else setNote(res.error);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(result!.text); setNote('Translation copied.'); }
    catch { setNote('Could not copy. Select the translation and copy it manually.'); }
  };
  const pull = async () => {
    const res = await send({ type: 'get-page-text', source: 'selection' });
    if (res.ok && res.data?.text.trim()) { setText(res.data.text); reset(); }
    else setNote('Select text on the page first, then try again.');
  };
  const packRow = (pack: TranslationPackStatus) => {
    const language = TRANSLATION_LANGUAGES.find((l) => l.code === pack.language)!;
    return <div class="pack-row" key={pack.language}>
      <div class="row between"><div><strong>{language.name}</strong><span class="pack-native">{language.native}</span></div>
        {pack.language === 'en' ? <span class="status-badge">Included</span> : pack.state === 'ready'
          ? <button class="plain small" disabled={busy || downloading} onClick={() => manage(pack.language, true)}>Remove</button>
          : <button disabled={busy || downloading} onClick={() => manage(pack.language)}>{pack.downloadBytes === 0 ? 'Enable' : pack.state === 'error' ? 'Resume' : `Get · ${size(pack.downloadBytes)}`}</button>}
      </div>
      <p class="small muted">{pack.state === 'ready' ? 'Ready offline' : pack.state === 'downloading' ? `Downloading · ${Math.round((pack.progress ?? 0) * 100)}%` : `${size(pack.bytes)} total${pack.shared ? ' · shared engine files reused' : ' · both directions'}`}</p>
      {pack.language === 'ko' && <p class="small muted">Includes NLLB · CC BY-NC 4.0 · non-commercial use</p>}
      {pack.state === 'downloading' && <><div class="progress" role="progressbar" aria-label={`${language.name} download`} aria-valuenow={Math.round((pack.progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${(pack.progress ?? 0) * 100}%` }} /></div><button class="plain" onClick={async () => { await send({ type: 'translation-cancel' }); await refresh(); }}>Stop download</button></>}
      {pack.error && <p class="small error-text" role="alert">{pack.error}</p>}
    </div>;
  };
  return <section class="panel" hidden={!active}>
    <div class="section-heading"><div><p class="eyebrow">YOUR WORDS, ON YOUR DEVICE</p><h2>Translate</h2></div><span class="status-badge">Local</span></div>
    <p class="muted">Download only the languages you need. Your text stays here, even when you are offline.</p>
    <div class="translation-languages">
      <label class="field"><span>From</span><select aria-label="Source language" disabled={busy} value={source} onChange={(e) => { setSource(e.currentTarget.value as TranslationLanguage); reset(); }}><LanguageOptions /></select></label>
      <button class="translation-swap" aria-label="Swap languages" disabled={busy} onClick={() => { setSource(target); setTarget(source); reset(); }}>⇄</button>
      <label class="field"><span>To</span><select aria-label="Target language" disabled={busy} value={target} onChange={(e) => { setTarget(e.currentTarget.value as TranslationLanguage); reset(); }}><LanguageOptions /></select></label>
    </div>
    <div class="editor-card"><label class="field"><span>Original</span><textarea aria-label="Text to translate" dir="auto" spellcheck={false} value={text} disabled={busy} placeholder="A thought in one language. A new way to say it." onInput={(e) => { setText(e.currentTarget.value); reset(); }} /></label><div class="row between"><button class="plain small" disabled={busy} onClick={pull}>Use selection</button><span class={text.length > MAX_TRANSLATION_CHARS ? 'small error-text' : 'small muted'}>{text.length.toLocaleString()} / {MAX_TRANSLATION_CHARS.toLocaleString()}</span></div></div>
    {!ready && <div class="card"><h3>Get ready to translate</h3><p class="small muted">Install the source and target packs below. Some packs share model files; those download only once.</p>{packs.filter((p) => [source, target].includes(p.language) && p.state !== 'ready').map(packRow)}</div>}
    <div class="row"><button class="primary" disabled={busy || downloading || !ready || !text.trim() || text.length > MAX_TRANSLATION_CHARS || source === target} onClick={run}>{busy ? 'Translating on this device…' : 'Translate'}</button><button disabled={busy || !text} onClick={() => { setText(''); reset(); }}>Clear</button></div>
    {busy && <p class="small muted" role="status">Local models can take a little time. You can switch sidebar tabs while this runs.</p>}
    {result && <div class="card translation-result"><div class="row between"><p class="caption">Translation</p><button class="plain" onClick={copy}>Copy</button></div><p class="option-text" dir="auto" lang={result.target}>{result.text}</p>{result.viaEnglish && <p class="small muted">Translated locally through English.</p>}</div>}
    {note && <p class="small muted" role="status">{note}</p>}
    <button class="pack-toggle" aria-expanded={showPacks} onClick={() => setShowPacks(!showPacks)}>Language library <span>{packs.filter((p) => p.state === 'ready').length} ready · {showPacks ? '−' : '+'}</span></button>
    {showPacks && <div class="card"><input type="search" aria-label="Search language packs" placeholder="Find a language…" value={search} onInput={(e) => setSearch(e.currentTarget.value)} />{packs.filter((p) => { const l = TRANSLATION_LANGUAGES.find((l) => l.code === p.language)!; return `${l.name} ${l.native}`.toLowerCase().includes(search.toLowerCase()); }).map(packRow)}<p class="small muted">Pack sizes include both directions with English. Indian packs may reuse a shared OPUS or IndicTrans engine. Korean uses a larger NLLB engine (CC BY-NC 4.0). Quality varies, particularly for smaller languages. No detection model or online fallback is used; choose the source language.</p></div>}
  </section>;
}
