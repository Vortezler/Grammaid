import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
await mkdir('artifacts', { recursive: true });
await build({ entryPoints: ['scripts/translation-smoke-entry.ts'], outfile: 'artifacts/translation-smoke.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external',
  alias: { 'onnxruntime-web/webgpu': path.resolve('node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs') },
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const processRun = spawn(process.execPath, ['artifacts/translation-smoke.mjs', ...process.argv.slice(2)], { stdio: 'inherit' });
processRun.on('exit', (code) => { process.exitCode = code ?? 1; });
