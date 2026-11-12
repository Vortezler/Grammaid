interface Props {
  data: { label: string; value: number }[];
  ariaLabel: string;
}

/** Horizontal SVG bar chart. Labels sit above their bars so long words never get clipped. */
export function BarChart({ data, ariaLabel }: Props) {
  const width = 300;
  const rowHeight = 30;
  const max = Math.max(1, ...data.map((d) => d.value));
  const valueWidth = 30;
  const barMax = width - valueWidth;
  return (
    <svg class="chart" viewBox={`0 0 ${width} ${data.length * rowHeight}`} role="img" aria-label={ariaLabel}>
      {data.map((d, i) => {
        const y = i * rowHeight;
        const w = Math.max(3, (d.value / max) * barMax);
        return (
          <g key={d.label}>
            <title>{`${d.label}: ${d.value}`}</title>
            <text x={0} y={y + 11}>{d.label}</text>
            <rect class="track" x={0} y={y + 16} width={barMax} height={7} rx={3.5} />
            <rect class="bar" x={0} y={y + 16} width={w} height={7} rx={3.5} />
            <text class="value" x={width} y={y + 23} text-anchor="end">{d.value}</text>
          </g>
        );
      })}
    </svg>
  );
}
