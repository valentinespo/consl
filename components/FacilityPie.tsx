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

/** Donut pie of value-by-facility in graded blue tones, with a legend. */
export function FacilityPie({ data }: { data: { code: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 52;
  const SW = 22; // ring thickness
  const C = 70;
  let angle = -Math.PI / 2; // start at top
  const segs = data.map((d, i) => {
    const frac = d.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    // Nudge full-circle single slices so the arc renders.
    const end = frac >= 0.9999 ? a1 - 0.0001 : a1;
    return { ...d, color: BLUES[i % BLUES.length], d: arc(C, C, R, a0, end), pct: frac * 100 };
  });

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-[132px] w-[132px] shrink-0">
        {segs.map((s) => (
          <path key={s.code} d={s.d} fill="none" stroke={s.color} strokeWidth={SW} strokeLinecap="butt" />
        ))}
        <text x={C} y={C - 4} textAnchor="middle" className="fill-muted" style={{ fontSize: 9, letterSpacing: 0.5 }}>
          TOTAL
        </text>
        <text x={C} y={C + 11} textAnchor="middle" className="fill-ink" style={{ fontSize: 13, fontWeight: 600 }}>
          {money(total).replace(/\.\d+$/, "")}
        </text>
      </svg>
      <div className="min-w-0 flex-1 space-y-2">
        {segs.map((s) => (
          <div key={s.code} className="flex items-center gap-2 text-[13px]">
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
