import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
await mkdir('artifacts', { recursive: true });
await build({ entryPoints: ['scripts/speech-smoke-entry.ts'], outfile: 'artifacts/speech-smoke.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external',
  alias: { 'onnxruntime-web/webgpu': path.resolve('node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs') },
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const child = spawn(process.execPath, ['artifacts/speech-smoke.mjs'], { stdio: 'inherit' });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
