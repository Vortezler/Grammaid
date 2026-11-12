// Packs dist/ into artifacts/grammaid-<version>.xpi with web-ext.
import { execSync } from 'node:child_process';
import { readFileSync, renameSync, existsSync, rmSync, mkdirSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
mkdirSync('artifacts', { recursive: true });
const zip = `artifacts/grammaid-${version}.zip`;
const out = `artifacts/grammaid-${version}.xpi`;
for (const f of [zip, out]) if (existsSync(f)) rmSync(f);
execSync(
  `npx web-ext build --source-dir dist --artifacts-dir artifacts --overwrite-dest --filename grammaid-${version}.zip`,
  { stdio: 'inherit' },
);
renameSync(zip, out);
console.log(`packaged -> ${out}`);
