import type { SentenceScore } from '../../shared/types';

interface Props {
  text: string;
  sentences: SentenceScore[];
}

const TITLE: Record<SentenceScore['band'], string> = {
  flagged: 'Likely AI-written',
  uncertain: 'Uncertain',
  ok: 'Reads as human-written',
  skipped: 'Too short to judge',
};

/** The analysed text with each sentence tinted by its band (red = likely AI, yellow = uncertain). */
export function SentenceHighlights({ text, sentences }: Props) {
  const parts: preact.ComponentChildren[] = [];
  let pos = 0;
  sentences.forEach((s, i) => {
    if (s.start > pos) parts.push(text.slice(pos, s.start));
    const detail = Number.isFinite(s.perplexity) ? ` (score ${s.score.toFixed(2)}, perplexity ${s.perplexity.toFixed(0)})` : '';
    parts.push(
      <span key={i} class={s.band === 'flagged' || s.band === 'uncertain' ? s.band : undefined} title={TITLE[s.band] + detail}>
        {text.slice(s.start, s.end)}
      </span>,
    );
    pos = s.end;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <div class="sentences">{parts}</div>;
}
