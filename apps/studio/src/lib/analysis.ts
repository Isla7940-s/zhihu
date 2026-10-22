/** out/analysis.json 的类型（由 crashlab/pipeline.py 生成） */
export type Summary = { median: number; p05: number; p95: number; n: number };
export type Band = { median: (number | null)[]; p05: (number | null)[]; p95: (number | null)[] };

export type Hypothesis = {
  id: string;
  label: string;
  dash_m: number;
  period_m: number;
  expected_duty: number;
  ego_speed_kmh: Summary;
  speed_segments: { t: number; period_s: number; kmh: Summary }[];
  camera: { height_m: Summary; focal_px: Summary; hfov_deg: Summary };
  lead: {
    t: number[];
    distance_m: Band;
    closing_speed_kmh: Band;
    lead_speed_kmh: Band;
    ttc_s: Band;
    headway_at_1p5s: Summary;
  };
  recommended_gap_m: Summary;
  stopping_distance_m: Summary;
  visibility_m: Summary;
};

export type Analysis = {
  case_id: string;
  video: { width: number; height: number; fps: number; duration: number; path: string };
  forensics: {
    container_fps: number;
    frames: number;
    unique_frames: number;
    effective_fps: number;
    hold_length_histogram: Record<string, number>;
    blackout_t: number | null;
    timing_uncertainty_s: number;
  };
  dashes: {
    detections: { t: number; top: number; bottom: number; x: number }[];
    periods: { t: number; T: number; n: number }[];
    duty_measured: number;
  };
  lead_track: { t: number; left: number; right: number; row: number; kept: boolean }[];
  hypotheses: Hypothesis[];
  primary: string;
  events: { t: number; kind: string; label: string }[];
  meta: Record<string, any>;
};

export const primaryOf = (a: Analysis) => a.hypotheses.find((h) => h.id === a.primary) ?? a.hypotheses[0];

export const fmt = (s: Summary, digits = 0) =>
  `${s.median.toFixed(digits)}（${s.p05.toFixed(digits)}–${s.p95.toFixed(digits)}）`;

/** 线性插值取带状序列在时刻 t 的值 */
export function bandAt(t: number[], b: Band, q: number) {
  const key = "median" as const;
  void key;
  let i = t.findIndex((x) => x >= q);
  if (i <= 0) i = 1;
  const u = (q - t[i - 1]) / (t[i] - t[i - 1]);
  const pick = (arr: (number | null)[]) => (arr[i - 1] ?? 0) + ((arr[i] ?? 0) - (arr[i - 1] ?? 0)) * u;
  return { median: pick(b.median), p05: pick(b.p05), p95: pick(b.p95) };
}
