// Rephrasing: sampled rewrites from the local seq2seq model, filtered and ranked by fluency,
// plus deterministic results (Tighten, Active voice hint) that never need a model.
import type { RephraseOption, RephraseResponse } from '../shared/types';
import { countWords } from '../shared/sentences';
import type { LanguageModel } from './model';
import { tighten, activeVoiceHint } from './style-rules';

const SAMPLES = 4;
const MAX_MODEL_RESULTS = 3;
const MIN_RATIO = 0.6;
const MAX_RATIO = 1.4;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

/** True when any run of three words appears twice: the usual sign of a looping small model. */
export function hasRepeatedNgram(text: string, n = 3): boolean {
  const words = normalize(text).split(' ').filter(Boolean);
  const seen = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) {
    const gram = words.slice(i, i + n).join(' ');
    if (seen.has(gram)) return true;
    seen.add(gram);
  }
  return false;
}

export function filterCandidates(original: string, candidates: string[]): string[] {
  const originalWords = Math.max(1, countWords(original));
  const base = normalize(original);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const text = raw.trim();
    const key = normalize(text);
    if (!key || key === base || seen.has(key)) continue;
    const ratio = countWords(text) / originalWords;
    if (ratio < MIN_RATIO || ratio > MAX_RATIO) continue;
    if (hasRepeatedNgram(text)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function deterministicOptions(text: string): RephraseOption[] {
  const out: RephraseOption[] = [];
  const tight = tighten(text);
  if (tight !== text) out.push({ text: tight, source: 'tighten', note: 'Wordy phrases replaced with shorter ones.' });
  const hint = activeVoiceHint(text);
  if (hint) out.push({ text, source: 'active-hint', note: hint });
  return out;
}

export async function rephraseText(model: LanguageModel | null, text: string): Promise<RephraseResponse> {
  const input = text.trim();
  const options: RephraseOption[] = [];
  let modelError: string | undefined;
  if (model) {
    try {
      const kept = filterCandidates(input, await model.rephrase(input, SAMPLES));
      if (kept.length > 1) {
        try {
          const scores = await model.scoreSentences(kept);
          const order = kept
            .map((t, i) => ({ t, s: Number.isNaN(scores[i].meanLogProb) ? -Infinity : scores[i].meanLogProb }))
            .sort((a, b) => b.s - a.s);
          kept.splice(0, kept.length, ...order.map((o) => o.t));
        } catch {
          // ranking is a nicety; unranked rewrites are still useful
        }
      }
      for (const t of kept.slice(0, MAX_MODEL_RESULTS)) options.push({ text: t, source: 'model' });
    } catch (e) {
      modelError = e instanceof Error ? e.message : String(e);
    }
  }
  options.push(...deterministicOptions(input));
  return { options, modelError };
}
