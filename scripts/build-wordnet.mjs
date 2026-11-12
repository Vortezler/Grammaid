// Converts WordNet (wordnet-db) into src/data/wordnet-synonyms.json:
//   { [lemma]: { [pos]: { synonyms: string[], gloss: string }[] } }
// pos is n, v, a (adjectives incl. satellites) or r (adverbs). Senses keep WordNet's frequency
// order; adjectives also pull in WordNet's "similar to" neighbours. To stay small, multiword and proper-noun lemmas are dropped, as are senses that have
// no single-word synonyms, and glosses are cut to a short phrase.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dict = require('wordnet-db').path;
const FILES = { n: 'noun', v: 'verb', a: 'adj', r: 'adv' };
const GLOSS_MAX = 36;
const MAX_SENSES = 6;
const MAX_SYNONYMS = 8;

const usable = (w) => /^[a-z][a-z-]*$/.test(w) && w.length <= 24;

function shortGloss(raw) {
  let g = raw.split(';')[0].trim().replace(/^\(.*?\)\s*/, '');
  if (g.length > GLOSS_MAX) {
    g = g.slice(0, GLOSS_MAX);
    g = g.slice(0, g.lastIndexOf(' ')).replace(/[,:]$/, '') + '...';
  }
  return g;
}

const out = {};
let senses = 0;

for (const [pos, name] of Object.entries(FILES)) {
  // synset offset -> { words, gloss }
  const synsets = new Map();
  for (const line of readFileSync(path.join(dict, `data.${name}`), 'utf8').split('\n')) {
    if (!line || line.startsWith('  ')) continue;
    const [head, gloss = ''] = line.split(' | ');
    const parts = head.split(' ');
    const count = parseInt(parts[3], 16);
    const words = [];
    for (let i = 0; i < count; i++) {
      const raw = parts[4 + i * 2];
      // skip proper nouns (capitalized) and strip adjective markers like "(p)"
      if (/[A-Z]/.test(raw)) continue;
      words.push(raw.replace(/\(.*?\)$/, '').replace(/_/g, ' '));
    }
    // "similar to" pointers (&) link an adjective to near-synonyms in neighbouring synsets
    const similar = [];
    const ptrStart = 4 + count * 2;
    const ptrCount = parseInt(parts[ptrStart], 10) || 0;
    for (let i = 0; i < ptrCount; i++) {
      if (parts[ptrStart + 1 + i * 4] === '&') similar.push(parts[ptrStart + 2 + i * 4]);
    }
    synsets.set(parts[0], { words, gloss: shortGloss(gloss), similar });
  }

  for (const line of readFileSync(path.join(dict, `index.${name}`), 'utf8').split('\n')) {
    if (!line || line.startsWith('  ')) continue;
    const parts = line.trim().split(' ');
    const lemma = parts[0].replace(/_/g, ' ');
    if (!usable(lemma)) continue;
    const synsetCount = parseInt(parts[2], 10);
    const offsets = parts.slice(parts.length - synsetCount);
    const entries = [];
    const seen = new Set();
    for (const off of offsets) {
      const syn = synsets.get(off);
      if (!syn) continue;
      const pool = [...syn.words];
      for (const near of syn.similar) pool.push(...(synsets.get(near)?.words ?? []));
      const synonyms = [...new Set(pool)].filter((w) => w !== lemma && usable(w) && !seen.has(w)).slice(0, MAX_SYNONYMS);
      if (synonyms.length === 0) continue;
      synonyms.forEach((w) => seen.add(w));
      entries.push({ synonyms, gloss: syn.gloss });
      if (entries.length >= MAX_SENSES) break;
    }
    if (entries.length === 0) continue;
    (out[lemma] ??= {})[pos] = entries;
    senses += entries.length;
  }
}

const target = path.resolve('src/data/wordnet-synonyms.json');
const json = JSON.stringify(out);
writeFileSync(target, json + '\n');
console.log(`${Object.keys(out).length} lemmas, ${senses} senses, ${(json.length / 1048576).toFixed(2)} MB -> ${target}`);
