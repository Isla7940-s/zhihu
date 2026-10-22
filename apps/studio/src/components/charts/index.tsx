"use client";
/**
 * 解说用图表（纯 SVG，确定性渲染，progress∈[0,1] 控制入场动画）。
 * 画布尺寸用 viewBox 定义，外层容器决定实际大小。
 */
import type { Analysis, Hypothesis } from "@/lib/analysis";
import { primaryOf } from "@/lib/analysis";

const C = {
  text: "#e8ebf1",
  muted: "#8b93a5",
  grid: "#262b37",
  accent: "#ff4d6d",
  amber: "#ffb020",
  green: "#22c55e",
  blue: "#38bdf8",
  violet: "#a78bfa",
};
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const font = "'Noto Sans SC','WenQuanYi Zen Hei',sans-serif";

function Frame({ w, h, children, title }: { w: number; h: number; children: React.ReactNode; title?: string }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: "block", fontFamily: font }}>
      {title && (
        <text x={0} y={34} fill={C.text} fontSize={34} fontWeight={800}>
          {title}
        </text>
      )}
      {children}
    </svg>
  );
}

/* ---------------- 取证：重复帧 ---------------- */
export function ForensicsChart({ a, progress = 1 }: { a: Analysis; progress?: number }) {
  const hist = a.forensics.hold_length_histogram;
  const keys = ["1", "2", "3", "4"];
  const rest = Object.entries(hist).filter(([k]) => +k > 4).reduce((s, [, v]) => s + v, 0);
  const vals = [...keys.map((k) => hist[k] ?? 0), rest];
  const labels = ["1 次", "2 次", "3 次", "4 次", "更多"];
  const max = Math.max(...vals);
  const W = 960, H = 640;
  const p = ease(progress * 1.4);
  const mode = +Object.entries(hist).sort((x, y) => y[1] - x[1])[0][0];
  const realFps = Math.round(a.forensics.container_fps / mode);
  return (
    <Frame w={W} h={H}>
      <text x={0} y={60} fill={C.muted} fontSize={30}>标称帧率</text>
      <text x={0} y={140} fill={C.text} fontSize={88} fontWeight={800}>{a.forensics.container_fps.toFixed(0)}<tspan fontSize={36} fill={C.muted}> fps</tspan></text>
      <text x={500} y={60} fill={C.muted} fontSize={30}>真实画面（剔除重复帧）</text>
      <text x={500} y={140} fill={C.amber} fontSize={88} fontWeight={800}>≈{realFps}<tspan fontSize={36} fill={C.muted}> fps</tspan></text>
      <text x={0} y={222} fill={C.muted} fontSize={28}>每个真实画面被重复显示几次（帧数）</text>
      {vals.map((v, i) => {
        const bw = 150, gap = 40, x = i * (bw + gap) + 10;
        const bh = (v / max) * 300 * p;
        return (
          <g key={i}>
            <rect x={x} y={590 - bh} width={bw} height={bh} rx={10} fill={i === 1 ? C.amber : "#3a4152"} />
            <text x={x + bw / 2} y={580 - bh} fill={C.text} fontSize={30} fontWeight={700} textAnchor="middle">{p > 0.6 ? v : ""}</text>
            <text x={x + bw / 2} y={630} fill={C.muted} fontSize={28} textAnchor="middle">{labels[i]}</text>
          </g>
        );
      })}
    </Frame>
  );
}

/* ---------------- 标线规格假设 ---------------- */
export function HypothesesChart({ a, progress = 1 }: { a: Analysis; progress?: number }) {
  const W = 960, H = 760;
  const duty = a.dashes.duty_measured;
  const p = ease(progress * 1.3);
  const axis = (x: number) => 60 + (x / 0.5) * 840;
  return (
    <Frame w={W} h={H}>
      {a.hypotheses.map((h, i) => {
        const y = 40 + i * 230;
        const primary = h.id === a.primary;
        const scale = 840 / 15;
        return (
          <g key={h.id} opacity={primary ? 1 : 0.55}>
            <text x={0} y={y + 30} fill={primary ? C.amber : C.muted} fontSize={30} fontWeight={800}>
              {primary ? "▶ " : ""}{h.label}
            </text>
            {[0, 1].map((k) => (
              <g key={k}>
                <rect x={60 + k * h.period_m * scale * 0.5} y={y + 60} width={h.dash_m * scale * 0.5} height={22} fill="#eef0f2" rx={3} />
              </g>
            ))}
            <text x={60} y={y + 120} fill={C.muted} fontSize={26}>线段 {h.dash_m} m · 周期 {h.period_m} m · 占空比 {(h.expected_duty * 100).toFixed(0)}%</text>
            <text x={940} y={y + 110} fill={primary ? C.text : C.muted} fontSize={64} fontWeight={800} textAnchor="end">
              {Math.round(h.ego_speed_kmh.median * p)}
              <tspan fontSize={28} fill={C.muted}> km/h</tspan>
            </text>
            <text x={940} y={y + 150} fill={C.muted} fontSize={24} textAnchor="end">90% 区间 {h.ego_speed_kmh.p05.toFixed(0)}–{h.ego_speed_kmh.p95.toFixed(0)}</text>
          </g>
        );
      })}
      <g transform="translate(0, 540)">
        <text x={0} y={0} fill={C.muted} fontSize={28}>实测占空比（线段时长 ÷ 周期）</text>
        <line x1={60} x2={900} y1={80} y2={80} stroke={C.grid} strokeWidth={6} strokeLinecap="round" />
        {a.hypotheses.map((h) => (
          <g key={h.id}>
            <line x1={axis(h.expected_duty)} x2={axis(h.expected_duty)} y1={58} y2={102} stroke={C.muted} strokeWidth={4} />
            <text x={axis(h.expected_duty)} y={140} fill={C.muted} fontSize={24} textAnchor="middle">{(h.expected_duty * 100).toFixed(0)}%</text>
          </g>
        ))}
        <circle cx={axis(duty * p)} cy={80} r={16} fill={C.amber} />
        <text x={axis(duty * p)} y={42} fill={C.amber} fontSize={30} fontWeight={800} textAnchor="middle">实测 {(duty * 100).toFixed(0)}%</text>
      </g>
    </Frame>
  );
}

/* ---------------- 本车速度（分段） ---------------- */
export function SpeedChart({ a, progress = 1 }: { a: Analysis; progress?: number }) {
  const W = 960, H = 620;
  const prim = primaryOf(a);
  const alt = a.hypotheses.find((h) => h.id !== prim.id)!;
  const x = (t: number) => 90 + (t / 3) * 820;
  const y = (v: number) => 540 - ((v - 30) / 70) * 480;
  const p = ease(progress * 1.2);
  const draw = (h: Hypothesis, color: string, main: boolean) =>
    h.speed_segments.map((s, i) => {
      if (i / h.speed_segments.length > p) return null;
      return (
        <g key={`${h.id}${i}`} opacity={main ? 1 : 0.35}>
          <line x1={x(s.t)} x2={x(s.t)} y1={y(s.kmh.p05)} y2={y(s.kmh.p95)} stroke={color} strokeWidth={6} />
          <circle cx={x(s.t)} cy={y(s.kmh.median)} r={main ? 12 : 9} fill={color} />
          {main && <text x={x(s.t) + 18} y={y(s.kmh.median) + 10} fill={C.text} fontSize={30} fontWeight={800}>{s.kmh.median.toFixed(0)}</text>}
        </g>
      );
    });
  return (
    <Frame w={W} h={H}>
      {[40, 60, 80, 100].map((v) => (
        <g key={v}>
          <line x1={90} x2={930} y1={y(v)} y2={y(v)} stroke={C.grid} strokeWidth={2} />
          <text x={78} y={y(v) + 9} fill={C.muted} fontSize={24} textAnchor="end">{v}</text>
        </g>
      ))}
      {[0, 1, 2, 3].map((t) => (
        <text key={t} x={x(t)} y={590} fill={C.muted} fontSize={24} textAnchor="middle">{t}s</text>
      ))}
      <text x={90} y={30} fill={C.muted} fontSize={26}>本车速度 km/h（竖线 = 90% 区间）</text>
      {draw(alt, C.violet, false)}
      {draw(prim, C.amber, true)}
      <text x={930} y={y(alt.speed_segments[0].kmh.median) - 16} fill={C.violet} fontSize={22} textAnchor="end" opacity={0.7}>6+9 规格</text>
    </Frame>
  );
}

/* ---------------- 车距（带状区间） ---------------- */
export function GapChart({ a, progress = 1 }: { a: Analysis; progress?: number }) {
  const W = 960, H = 640;
  const h = primaryOf(a);
  const L = h.lead;
  const t0 = L.t[0], t1 = L.t[L.t.length - 1];
  const x = (t: number) => 90 + ((t - t0) / (t1 - t0)) * 820;
  const y = (d: number) => 560 - (d / 20) * 500;
  const n = Math.max(2, Math.round(L.t.length * ease(progress * 1.2)));
  const idx = L.t.slice(0, n).map((_, i) => i);
  const area = [
    ...idx.map((i) => `${x(L.t[i])},${y(L.distance_m.p95[i] ?? 0)}`),
    ...idx.reverse().map((i) => `${x(L.t[i])},${y(L.distance_m.p05[i] ?? 0)}`),
  ].join(" ");
  const line = L.t.slice(0, n).map((t, i) => `${x(t)},${y(L.distance_m.median[i] ?? 0)}`).join(" ");
  const k = L.t.findIndex((t) => t >= 1.4);
  return (
    <Frame w={W} h={H}>
      {[0, 5, 10, 15, 20].map((d) => (
        <g key={d}>
          <line x1={90} x2={930} y1={y(d)} y2={y(d)} stroke={C.grid} strokeWidth={2} />
          <text x={78} y={y(d) + 9} fill={C.muted} fontSize={24} textAnchor="end">{d}m</text>
        </g>
      ))}
      {[1, 2, 3].map((t) => (
        <text key={t} x={x(t)} y={610} fill={C.muted} fontSize={24} textAnchor="middle">{t}s</text>
      ))}
      <text x={90} y={30} fill={C.muted} fontSize={26}>本车 → 自卸车 车距（阴影 = 90% 区间）</text>
      <polygon points={area} fill="rgba(255,77,109,0.25)" />
      <polyline points={line} fill="none" stroke={C.accent} strokeWidth={6} strokeLinejoin="round" />
      {n > k && k >= 0 && (
        <g>
          <circle cx={x(L.t[k])} cy={y(L.distance_m.median[k] ?? 0)} r={13} fill={C.accent} />
          <text x={x(L.t[k]) + 22} y={y(L.distance_m.median[k] ?? 0) - 18} fill={C.text} fontSize={44} fontWeight={800}>
            {(L.distance_m.median[k] ?? 0).toFixed(1)} m
          </text>
          <text x={x(L.t[k]) + 22} y={y(L.distance_m.median[k] ?? 0) + 22} fill={C.muted} fontSize={24}>
            区间 {(L.distance_m.p05[k] ?? 0).toFixed(1)}–{(L.distance_m.p95[k] ?? 0).toFixed(1)} m · 接近速度 {(L.closing_speed_kmh.median[k] ?? 0).toFixed(0)} km/h
          </text>
        </g>
      )}
    </Frame>
  );
}

/* ---------------- 停车距离 vs 实际车距 ---------------- */
export function StoppingChart({ a, progress = 1 }: { a: Analysis; progress?: number }) {
  const W = 960, H = 620;
  const h = primaryOf(a);
  const k = h.lead.t.findIndex((t) => t >= 1.4);
  const gap = h.lead.distance_m.median[k] ?? 0;
  const rows = [
    { label: "当时车距", v: gap, lo: h.lead.distance_m.p05[k] ?? gap, hi: h.lead.distance_m.p95[k] ?? gap, color: C.accent },
    { label: "停车所需距离", v: h.stopping_distance_m.median, lo: h.stopping_distance_m.p05, hi: h.stopping_distance_m.p95, color: C.amber },
    { label: "3 秒车距（雾天建议）", v: h.recommended_gap_m.median, lo: h.recommended_gap_m.p05, hi: h.recommended_gap_m.p95, color: C.green },
  ];
  const x = (m: number) => 40 + (m / 75) * 880;
  return (
    <Frame w={W} h={H}>
      <text x={40} y={34} fill={C.muted} fontSize={26}>反应 0.8–1.5 s · 湿滑路面附着 0.4–0.6</text>
      {rows.map((r, i) => {
        const p = ease(progress * 1.6 - i * 0.25);
        const y = 90 + i * 170;
        return (
          <g key={r.label}>
            <text x={40} y={y + 30} fill={C.text} fontSize={32} fontWeight={700}>{r.label}</text>
            <rect x={40} y={y + 50} width={(x(r.v) - 40) * p} height={56} rx={10} fill={r.color} />
            <line x1={x(r.lo)} x2={x(r.hi)} y1={y + 78} y2={y + 78} stroke="#fff" strokeWidth={4} opacity={p > 0.9 ? 0.8 : 0} />
            <text x={Math.max(x(r.v) * p, 40) + 16} y={y + 92} fill={C.text} fontSize={40} fontWeight={800} opacity={p > 0.5 ? 1 : 0}>
              {r.v.toFixed(r.v < 20 ? 1 : 0)} m
            </text>
          </g>
        );
      })}
    </Frame>
  );
}

/* ---------------- 时间线 ---------------- */
export function TimelineChart({ a, progress = 1 }: { a: Analysis; progress?: number }) {
  const W = 960, H = 1020;
  const ev = a.events;
  const yi = (i: number) => 50 + (i * 920) / Math.max(1, ev.length - 1);
  const color = (k: string) => ({ measure: C.green, maneuver: C.blue, hazard: C.amber, loss: C.accent, impact: "#ff3b30", end: "#ff3b30" })[k] ?? C.muted;
  const band = (from: number, to: number) => {
    const i0 = ev.findIndex((e) => e.t >= from);
    const i1 = ev.length - 1 - [...ev].reverse().findIndex((e) => e.t <= to);
    return { y: yi(Math.max(0, i0)) - 20, h: yi(i1) - yi(Math.max(0, i0)) + 40 };
  };
  const m = band(0, 3.4), s = band(7, 13);
  return (
    <Frame w={W} h={H}>
      <line x1={150} x2={150} y1={30} y2={990} stroke={C.grid} strokeWidth={6} />
      <rect x={140} y={m.y} width={20} height={m.h} fill={C.green} opacity={0.5} rx={6} />
      <rect x={140} y={s.y} width={20} height={s.h} fill={C.violet} opacity={0.35} rx={6} />
      {ev.map((e, i) => {
        const p = ease(progress * 1.8 - i * 0.12);
        return (
          <g key={i} opacity={p}>
            <text x={120} y={yi(i) + 10} fill={C.muted} fontSize={26} textAnchor="end">{e.t.toFixed(1)}s</text>
            <circle cx={150} cy={yi(i)} r={12} fill={color(e.kind)} />
            <text x={180 + (1 - p) * 30} y={yi(i) + 11} fill={C.text} fontSize={32} fontWeight={600}>{e.label}</text>
          </g>
        );
      })}
    </Frame>
  );
}
