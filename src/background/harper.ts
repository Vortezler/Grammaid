// Harper (WASM) wrapper: turns Harper lints into Grammaid issues.
import { LocalLinter, Dialect, SuggestionKind, createBinaryModuleFromUrl, type Lint } from 'harper.js';
import type { Issue } from '../shared/types';
import type { DialectName } from '../shared/settings';

const DIALECTS: Record<DialectName, Dialect> = {
  American: Dialect.American,
  British: Dialect.British,
  Canadian: Dialect.Canadian,
  Australian: Dialect.Australian,
};

/** Harper reports offsets in Unicode code points; the DOM uses UTF-16 code units. */
export function codePointMapper(text: string): (cp: number) => number {
  if (!/[\ud800-\udfff]/.test(text)) return (cp) => cp;
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    map.push(i);
    i += ch.length;
  }
  map.push(i);
  return (cp) => map[Math.min(cp, map.length - 1)];
}

function suggestionsFor(lint: Lint, problem: string): string[] {
  const out: string[] = [];
  for (const s of lint.suggestions()) {
    try {
      const kind = s.kind();
      const replacement = s.get_replacement_text();
      const value =
        kind === SuggestionKind.Remove ? '' : kind === SuggestionKind.InsertAfter ? problem + replacement : replacement;
      if (!out.includes(value) && value !== problem) out.push(value);
    } finally {
      s.free();
    }
    if (out.length >= 5) break;
  }
  return out;
}

export class HarperEngine {
  private linter: LocalLinter | null = null;
  private ready: Promise<void> | null = null;
  private dialect: DialectName;
  private words: string[];

  constructor(
    private wasmUrl: string,
    dialect: DialectName,
    words: string[],
  ) {
    this.dialect = dialect;
    this.words = words;
  }

  private init(): Promise<void> {
    this.ready ??= (async () => {
      const binary = createBinaryModuleFromUrl(this.wasmUrl);
      const linter = new LocalLinter({ binary, dialect: DIALECTS[this.dialect] });
      await linter.setup();
      if (this.words.length) await linter.importWords(this.words);
      this.linter = linter;
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  setup(): Promise<void> {
    return this.init();
  }

  async configure(dialect: DialectName, words: string[]): Promise<void> {
    const dialectChanged = dialect !== this.dialect;
    const wordsChanged = words.length !== this.words.length || words.some((w, i) => w !== this.words[i]);
    this.dialect = dialect;
    this.words = words;
    if (!this.linter) return;
    if (dialectChanged) await this.linter.setDialect(DIALECTS[dialect]);
    if (dialectChanged || wordsChanged) {
      await this.linter.clearWords();
      if (words.length) await this.linter.importWords(words);
    }
  }

  async lint(text: string): Promise<Issue[]> {
    await this.init();
    const linter = this.linter;
    if (!linter) return [];
    const toUtf16 = codePointMapper(text);
    const lints = await linter.lint(text, { language: 'plaintext' });
    const issues: Issue[] = [];
    for (const lint of lints) {
      try {
        const span = lint.span();
        const start = toUtf16(span.start);
        const end = toUtf16(span.end);
        span.free();
        const kindName = lint.lint_kind();
        const problem = text.slice(start, end);
        issues.push({
          start,
          end,
          // "Typo" is Harper's kind for slips like "teh"; they are spelling mistakes to the user.
          kind: kindName === 'Spelling' || kindName === 'Typo' ? 'spelling' : 'grammar',
          message: lint.message().replace(/`([^`]*)`/g, '“$1”'),
          suggestions: suggestionsFor(lint, problem),
          rule: lint.lint_kind_pretty(),
        });
      } catch (e) {
        console.warn('Grammaid: skipped a lint that could not be read', e);
      } finally {
        lint.free();
      }
    }
    return issues;
  }
}
