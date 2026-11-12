import type { Issue } from '../../shared/types';

const KIND: Record<Issue['kind'], string> = { spelling: 'Spelling', grammar: 'Grammar', style: 'Style' };

interface Props {
  text: string;
  issues: Issue[];
  onApply: (issue: Issue, replacement: string) => void;
}

/** A few words either side of the problem, so each issue can be recognised out of context. */
function Context({ text, issue }: { text: string; issue: Issue }) {
  const from = Math.max(0, issue.start - 28);
  const to = Math.min(text.length, issue.end + 28);
  const clip = (s: string) => s.replace(/\s+/g, ' ');
  return (
    <p class="small muted">
      {from > 0 && '…'}
      {clip(text.slice(from, issue.start))}
      <mark class={issue.kind}>{clip(text.slice(issue.start, Math.min(issue.end, issue.start + 80)))}</mark>
      {issue.end - issue.start > 80 ? '…' : clip(text.slice(issue.end, to))}
      {to < text.length && '…'}
    </p>
  );
}

export function IssueList({ text, issues, onApply }: Props) {
  if (issues.length === 0) return null;
  return (
    <div class="card" role="list" aria-label="Issues">
      {issues.map((issue) => (
        <div class="issue" role="listitem" key={`${issue.start}-${issue.end}-${issue.rule}`}>
          <p class="caption">
            <span class={issue.kind === 'style' ? 'dot style' : 'dot'} />
            {issue.rule === KIND[issue.kind] ? issue.rule : `${KIND[issue.kind]} · ${issue.rule}`}
          </p>
          <Context text={text} issue={issue} />
          <p>{issue.message}</p>
          {issue.suggestions.length > 0 && (
            <div class="row">
              {issue.suggestions.slice(0, 5).map((s) => (
                <button class="chip" key={s} onClick={() => onApply(issue, s)}>
                  {s === '' ? 'Remove' : s}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
