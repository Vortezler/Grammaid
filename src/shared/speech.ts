import manifest from '../data/speech-model.json';
export const SPEECH_MODEL = manifest;
export const SPEECH_RATE = 16000;
export const MAX_SPEECH_SECONDS = 120;
export const MAX_SPEECH_FILE_BYTES = 25 * 1024 * 1024;
export interface SpeechOptions { removeFillers: boolean; format: boolean }
export const DEFAULT_SPEECH_OPTIONS: SpeechOptions = { removeFillers: true, format: true };
export interface SpeechResult { raw: string; formattedSource?: string; text: string; removedFillers: number; seconds: number; language: string }
export interface SpeechStatus {
  state: 'missing' | 'downloading' | 'ready' | 'loading' | 'transcribing' | 'error';
  bytes: number; downloadBytes: number; progress?: number; error?: string; jobId?: string;
}
export const speechUrl = (name: string) => `https://huggingface.co/${SPEECH_MODEL.id}/resolve/${SPEECH_MODEL.revision}/${name}`;
export const speechLanguageValid = (language: string) => language === 'auto' || SPEECH_MODEL.languages.includes(language);
export function validateSpeechOptions(language: string, options: SpeechOptions) {
  if (!speechLanguageValid(language)) throw new Error('Choose a supported speech language.');
  if (!options || typeof options.removeFillers !== 'boolean' || typeof options.format !== 'boolean') throw new Error('Choose valid transcript settings.');
}
/** Conservative cleanup: no vocabulary blacklist and no semantic rewriting. */
export function cleanTranscript(raw: string, language: string, options: SpeechOptions): { text: string; removedFillers: number } {
  let text = raw.trim(); let removedFillers = 0;
  if (options.removeFillers && language === 'en') {
    text = text.replace(/(^|[ \t]+|,[ \t]*)(?:u+h+|u+m+)(?![\p{L}\p{N}_'’\-]|[ \t]+(?:huh|oh)\b)(?:[ \t]*[,;:])?/gimu, (_whole, prefix: string) => { removedFillers++; return prefix ? ' ' : ''; });
    if (removedFillers) text = text.replace(/^[,;:.!?\s]+/u, '').replace(/[ \t]{2,}/gu, ' ').replace(/[ \t]+([,;:.!?])/gu, '$1').replace(/([,;:])[ \t]*([.!?])/gu, '$2').trim();
  }
  if (options.format && text) {
    text = text.replace(/[ \t]+/gu, ' ').replace(/ *\n */gu, '\n').replace(/\n{3,}/gu, '\n\n')
      .replace(/ +([,.;:!?。！？،।])/gu, '$1').trim();
    // Punctuation within sentences comes from Whisper; only tidy casing and a final mark.
    text = text.replace(/(^|[.!?。！？।]\s+|\n+)([\p{Ll}])/gu, (_whole, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase(language === 'auto' ? undefined : language));
    if (language === 'en') text = text.replace(/\bi(?=\b|['’])/gu, 'I');
    if (!/[.!?。！？।…:;]["'”’）)]*$/u.test(text)) {
      const stop = ['zh', 'ja'].includes(language) ? '。' : language === 'hi' ? '।' : '.';
      text = text.replace(/(["'”’）)]*)$/u, `${stop}$1`);
    }
  }
  return { text, removedFillers };
}
/** PCM16/base64 is portable through both Firefox structured clone and JSON-based harnesses. */
export function encodeSpeech(samples: Float32Array): string {
  if (!samples.length || samples.length > SPEECH_RATE * MAX_SPEECH_SECONDS) throw new Error(`Use audio up to ${MAX_SPEECH_SECONDS} seconds long.`);
  const bytes = new Uint8Array(samples.length * 2); const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error('The audio contains invalid samples.');
    const sample = Math.max(-1, Math.min(1, samples[i])); view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += 8192) parts.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
  return btoa(parts.join(''));
}
export function decodeSpeech(encoded: string): Float32Array {
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(SPEECH_RATE * MAX_SPEECH_SECONDS * 2 / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) throw new Error('Invalid audio. Use a recording of up to two minutes.');
  const binary = atob(encoded);
  if (!binary.length || binary.length % 2 || binary.length > SPEECH_RATE * MAX_SPEECH_SECONDS * 2) throw new Error('Invalid audio sample length.');
  const samples = new Float32Array(binary.length / 2);
  for (let i = 0; i < samples.length; i++) { const word = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8; samples[i] = (word > 32767 ? word - 65536 : word) / 32768; }
  return samples;
}
export function hasAudibleSignal(samples: Float32Array): boolean {
  let energy = 0; let peak = 0;
  for (const sample of samples) { energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
  return Math.sqrt(energy / Math.max(1, samples.length)) >= .0003 || peak >= .002;
}
/** Insert paragraph breaks at model segment boundaries without changing the model's words. */
export function speechParagraphs(raw: string, chunks: { text: string; timestamp: [number, number] }[]): string {
  let cursor = 0; let output = ''; let previousEnd = 0;
  for (const chunk of chunks) {
    const text = chunk.text.trim(); if (!text) continue;
    const start = raw.indexOf(text, cursor);
    if (start < 0) return raw; // unmatched segment metadata must not lose or duplicate text
    output += raw.slice(cursor, start);
    if (cursor && chunk.timestamp[0] - previousEnd >= 1.8 && /[.!?。！？।]["”’']?$/u.test(output.trim())) output = output.trimEnd() + '\n\n';
    output += text; cursor = start + text.length; previousEnd = Number(chunk.timestamp[1] ?? chunk.timestamp[0]);
  }
  return output + raw.slice(cursor);
}
