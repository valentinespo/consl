import { money } from "@/lib/format";

// Distinct-but-related blue tones, darkest → lightest.
const BLUES = ["#1e3a8a", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"];

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

/** Donut pie of value-by-facility in graded blue tones; legend listed underneath. Hover a slice for its value. */
export function FacilityPie({ data }: { data: { code: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 62;
  const SW = 26;
  const C = 80;
  let angle = -Math.PI / 2;
  const segs = data.map((d, i) => {
    const frac = d.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const end = frac >= 0.9999 ? a1 - 0.0001 : a1;
    return { ...d, color: BLUES[i % BLUES.length], d: arc(C, C, R, a0, end), pct: frac * 100 };
  });

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 160 160" className="h-[168px] w-[168px]">
        {segs.map((s) => (
          <path key={s.code} d={s.d} fill="none" stroke={s.color} strokeWidth={SW} strokeLinecap="butt">
            <title>{`${s.code} · ${money(s.value)} (${s.pct.toFixed(1)}%)`}</title>
          </path>
        ))}
        <text x={C} y={C - 5} textAnchor="middle" className="fill-muted" style={{ fontSize: 9, letterSpacing: 0.5 }}>
          TOTAL
        </text>
        <text x={C} y={C + 12} textAnchor="middle" className="fill-ink" style={{ fontSize: 15, fontWeight: 600 }}>
          {money(total).replace(/\.\d+$/, "")}
        </text>
      </svg>
      <div className="mt-4 w-full space-y-2">
        {segs.map((s) => (
          <div key={s.code} className="flex items-center gap-2.5 text-[13px]" title={`${money(s.value)} (${s.pct.toFixed(1)}%)`}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="font-medium text-ink-soft">{s.code}</span>
            <span className="ml-auto tabular font-medium text-ink">{money(s.value)}</span>
            <span className="w-10 shrink-0 text-right tabular text-[11px] text-muted">{s.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
