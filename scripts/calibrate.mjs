// Runs the real detector (real distilgpt2, via Node) over test/fixtures and prints the scores, so
// the constants in src/background/detector-config.ts can be tuned. Needs a network connection the
// first time, to download the model into a temp-dir cache (override with GRAMMAID_HF_CACHE).
import { build } from 'esbuild';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const work = path.join(os.tmpdir(), 'grammaid-calibrate');
mkdirSync(work, { recursive: true });
const entry = path.join(work, 'entry.ts');
const src = (p) => JSON.stringify(path.resolve('src', p));
writeFileSync(
  entry,
  `export { TransformersLanguageModel } from ${src('background/model.ts')};
export { detect } from ${src('background/detector.ts')};
export { DETECTOR } from ${src('background/detector-config.ts')};
export { env } from '@huggingface/transformers';
`,
);
const outfile = path.join(work, 'entry.mjs');
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  nodePaths: [path.resolve('node_modules')],
  logLevel: 'warning',
});
// The bundle lives outside the project, so point Node at the project's node_modules.
const bundled = path.resolve('.calibrate-cache/entry.mjs');
mkdirSync(path.dirname(bundled), { recursive: true });
writeFileSync(bundled, readFileSync(outfile));

const { TransformersLanguageModel, detect, DETECTOR, env } = await import(pathToFileURL(bundled).href);
env.cacheDir = process.env.GRAMMAID_HF_CACHE || path.join(os.tmpdir(), 'grammaid-hf');

const model = new TransformersLanguageModel({
  scoringModelId: () => 'Xenova/distilgpt2',
  rewriteModelId: () => 'Xenova/flan-t5-small',
  device: 'cpu',
});

const dir = 'test/fixtures';
const rows = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
  const text = readFileSync(path.join(dir, file), 'utf8');
  const r = await detect(text, model, 50, DETECTOR);
  if (r.tooShort) {
    rows.push({ file, percent: 'too short' });
    continue;
  }
  const scored = r.sentences.filter((s) => s.band !== 'skipped');
  const meanScore = scored.reduce((a, s) => a + s.score, 0) / Math.max(1, scored.length);
  const ppl = r.signals.find((s) => s.name === 'Predictability')?.value;
  const burst = r.signals.find((s) => s.name === 'Burstiness')?.value;
  rows.push({ file, percent: r.percent, label: r.label, meanScore: meanScore.toFixed(2), threshold: r.threshold.toFixed(2), ppl, burst });
}
console.table(rows);

const pct = (prefix) => rows.filter((r) => r.file.startsWith(prefix) && typeof r.percent === 'number').map((r) => r.percent);
const human = pct('human-');
const ai = pct('ai-');
console.log(`human: max ${Math.max(...human)}%   ai: min ${Math.min(...ai)}%`);
console.log(Math.max(...human) < Math.min(...ai) ? 'Fixtures separate cleanly.' : 'Fixtures overlap: tune detector-config.ts.');
