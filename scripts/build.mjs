// Builds dist/: background (ESM, loaded by background.html), content (IIFE), sidebar (ESM),
// plus static files and the WASM binaries the background page loads at runtime.
import { build, context } from 'esbuild';
import { cp, mkdir, rm, copyFile, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const r = (...p) => path.join(root, ...p);

const common = {
  bundle: true,
  target: ['firefox115'],
  sourcemap: false,
  minify: !watch,
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.json': 'json' },
};

const entries = [
  {
    ...common,
    entryPoints: [r('src/background/index.ts')],
    outfile: path.join(dist, 'background.js'),
    format: 'esm',
    // Harper has a Node-only code path (guarded by a `process` check) that imports fs.
    external: ['fs', 'path', 'url', 'node:*'],
    // Transformers.js imports the WebGPU flavour of ONNX Runtime. Waterfox has no WebGPU, so
    // use the WASM-only bundle: half the size and no dynamic import of glue code.
    alias: { 'onnxruntime-web/webgpu': r('node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs') },
  },
  { ...common, entryPoints: [r('src/content/index.ts')], outfile: path.join(dist, 'content.js'), format: 'iife' },
  { ...common, entryPoints: [r('src/sidebar/index.tsx')], outfile: path.join(dist, 'sidebar.js'), format: 'esm' },
];

async function copyStatic() {
  await mkdir(path.join(dist, 'vendor/ort'), { recursive: true });
  await mkdir(path.join(dist, 'vendor/harper'), { recursive: true });
  await mkdir(path.join(dist, 'icons'), { recursive: true });
  await mkdir(path.join(dist, 'data'), { recursive: true });
  // The synonym index is loaded lazily by the background page on the first lookup. It ships as
  // one file per part of speech: each stays under the 5 MB per-file limit of the add-on linter.
  const lexicon = JSON.parse(await readFile(r('src/data/wordnet-synonyms.json'), 'utf8'));
  for (const pos of ['n', 'v', 'a', 'r']) {
    const part = {};
    for (const [lemma, entry] of Object.entries(lexicon)) if (entry[pos]) part[lemma] = entry[pos];
    await writeFile(path.join(dist, `data/wordnet-${pos}.json`), JSON.stringify(part));
  }
  await copyFile(r('manifest.json'), path.join(dist, 'manifest.json'));
  await cp(r('icons'), path.join(dist, 'icons'), { recursive: true });
  await copyFile(r('src/sidebar/index.html'), path.join(dist, 'sidebar.html'));
  await copyFile(r('src/sidebar/styles.css'), path.join(dist, 'sidebar.css'));
  await writeFile(
    path.join(dist, 'background.html'),
    '<!doctype html><meta charset="utf-8"><title>Grammaid background</title><script type="module" src="background.js"></script>\n',
  );
  const ort = r('node_modules/onnxruntime-web/dist');
  for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
    await copyFile(path.join(ort, f), path.join(dist, 'vendor/ort', f));
  }
  await copyFile(
    r('node_modules/harper.js/dist/harper_wasm_bg.wasm'),
    path.join(dist, 'vendor/harper/harper_wasm_bg.wasm'),
  );
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();
if (watch) {
  for (const e of entries) (await context(e)).watch();
  console.log('watching...');
} else {
  await Promise.all(entries.map((e) => build(e)));
  console.log('build complete -> dist/');
}
