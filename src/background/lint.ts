// Lint pipeline: engine issues + style rules -> filtered, prioritized, sorted, cached.
import type { Issue, IssueKind } from '../shared/types';
import { MAX_LINT_CHARS, type Settings } from '../shared/settings';
import { runStyleRules } from './style-rules';

const PRIORITY: Record<IssueKind, number> = { spelling: 0, grammar: 1, style: 2 };

/**
 * Sorts by position and resolves overlaps: when two issues touch the same text the higher
 * priority one wins (spelling > grammar > style); ties go to the earlier, then the shorter, issue.
 */
export function resolveOverlaps(issues: Issue[]): Issue[] {
  const ranked = [...issues].sort(
    (a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.start - b.start || a.end - a.start - (b.end - b.start),
  );
  const kept: Issue[] = [];
  for (const issue of ranked) {
    if (issue.end <= issue.start) continue;
    if (kept.some((k) => issue.start < k.end && k.start < issue.end)) continue;
    kept.push(issue);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function filterIssues(issues: Issue[], text: string, settings: Settings): Issue[] {
  const dict = new Set(settings.userDictionary.map((w) => w.toLowerCase()));
  return issues.filter((issue) => {
    if (!settings.categories[issue.kind]) return false;
    if (issue.kind === 'spelling' && dict.has(text.slice(issue.start, issue.end).toLowerCase())) return false;
    return true;
  });
}

export type Engine = (text: string) => Promise<Issue[]>;

const CACHE_MAX = 20;

export class LintPipeline {
  private cache = new Map<string, Issue[]>();

  constructor(
    private engine: Engine,
    private getSettings: () => Promise<Settings>,
  ) {}

  clearCache(): void {
    this.cache.clear();
  }

  async lint(fullText: string): Promise<Issue[]> {
    const text = fullText.length > MAX_LINT_CHARS ? fullText.slice(0, MAX_LINT_CHARS) : fullText;
    if (!text.trim()) return [];
    const hit = this.cache.get(text);
    if (hit) {
      // refresh recency
      this.cache.delete(text);
      this.cache.set(text, hit);
      return hit;
    }
    const settings = await this.getSettings();
    const engineIssues = settings.categories.spelling || settings.categories.grammar ? await this.engine(text) : [];
    const styleIssues = settings.categories.style ? runStyleRules(text) : [];
    const result = resolveOverlaps(filterIssues([...engineIssues, ...styleIssues], text, settings));
    this.cache.set(text, result);
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return result;
  }
}
