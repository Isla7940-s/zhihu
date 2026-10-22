/**
 * 场景规格（scene.json）——3D 重建的唯一数据源。
 *
 * 坐标：道路坐标 (s, d) —— s 沿道路中心线的里程（米），d 向左为正的横向偏移（米）。
 * 车辆轨迹用道路坐标写关键帧，曲线道路、换道、甩尾都能自然表达，
 * 由 road.ts 统一换算到 three.js 世界坐标（Y 轴向上）。
 *
 * 每个关键帧带 evidence 等级：measured（视频测得）/ estimated（由测量推算）/ assumed（示意推定）。
 * 成片里会把不同等级用不同样式标出来，避免把推定当事实。
 */
import { z } from "zod";

export const Evidence = z.enum(["measured", "estimated", "assumed"]);
export type Evidence = z.infer<typeof Evidence>;

export const Key = z.object({
  t: z.number(),
  s: z.number(),
  d: z.number().default(0),
  /** 相对道路切向的偏航角（度），0=顺行，正值=车头向左 */
  yaw: z.number().default(0),
  evidence: Evidence.default("assumed"),
  /** 0..1 车身压溃程度（示意） */
  crush: z.number().optional(),
});
export type Key = z.infer<typeof Key>;

export const Actor = z.object({
  id: z.string(),
  asset: z.string(),
  label: z.string().optional(),
  params: z.record(z.string(), z.any()).default({}),
  keys: z.array(Key).min(1),
  /** 尾灯/刹车灯/双闪等状态区间 */
  lights: z
    .array(z.object({ from: z.number(), to: z.number(), mode: z.enum(["brake", "hazard", "fog"]) }))
    .default([]),
});
export type Actor = z.infer<typeof Actor>;

export const RoadSpec = z.object({
  /** 中心线控制点（米，平面坐标 x 前 y 左），按里程顺序 */
  centerline: z.array(z.tuple([z.number(), z.number()])).min(2),
  lanes: z.number().int().min(1).default(2),
  laneWidth: z.number().default(3.75),
  /** 车道 0 为最左侧车道（靠中央分隔带） */
  dash: z.object({ line: z.number(), gap: z.number() }).default({ line: 3, gap: 9 }),
  shoulderLeft: z.number().default(0.75),
  shoulderRight: z.number().default(2.5),
  guardrailLeft: z.boolean().default(true),
  guardrailRight: z.boolean().default(true),
  surface: z.enum(["dry", "wet", "icy"]).default("wet"),
});
export type RoadSpec = z.infer<typeof RoadSpec>;

export const CameraKey = z.object({
  t: z.number(),
  /** follow 模式下相对目标车辆的偏移（车身坐标：前 x、左 y、上 z） */
  offset: z.tuple([z.number(), z.number(), z.number()]).optional(),
  /** world 模式下的绝对位置（道路坐标 s,d,高度） */
  pos: z.tuple([z.number(), z.number(), z.number()]).optional(),
  lookAt: z.tuple([z.number(), z.number(), z.number()]).optional(),
  fov: z.number().default(45),
});

export const CameraTrack = z.object({
  id: z.string(),
  label: z.string(),
  mode: z.enum(["follow", "world", "mount"]),
  target: z.string().optional(),
  keys: z.array(CameraKey).min(1),
});
export type CameraTrack = z.infer<typeof CameraTrack>;

export const SceneSpec = z.object({
  id: z.string(),
  title: z.string(),
  duration: z.number(),
  road: RoadSpec,
  environment: z
    .object({
      fogVisibility: z.number().default(200),
      timeOfDay: z.enum(["day", "dusk", "night"]).default("day"),
      ground: z.enum(["grass", "snow", "dirt"]).default("snow"),
    })
    .default({ fogVisibility: 200, timeOfDay: "day", ground: "snow" }),
  props: z
    .array(z.object({ asset: z.string(), s: z.number(), d: z.number(), yaw: z.number().default(0), params: z.record(z.string(), z.any()).default({}) }))
    .default([]),
  actors: z.array(Actor),
  cameras: z.array(CameraTrack).default([]),
  notes: z.array(z.object({ from: z.number(), to: z.number(), text: z.string(), evidence: Evidence })).default([]),
});
export type SceneSpec = z.infer<typeof SceneSpec>;

/* ---------------- 关键帧插值 ---------------- */

export type Pose = { s: number; d: number; yaw: number; crush: number; evidence: Evidence; speed: number };

/** 分段三次 Hermite（Catmull-Rom 切线），保证位置与速度连续，避免关键帧处“顿挫” */
export function sampleKeys(keys: Key[], t: number): Pose {
  if (keys.length === 1 || t <= keys[0].t) return poseOf(keys[0], 0);
  const last = keys[keys.length - 1];
  if (t >= last.t) return poseOf(last, 0);
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(i - 1, 0)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(i + 2, keys.length - 1)];
  const h = k2.t - k1.t;
  const u = (t - k1.t) / h;
  const tan = (a: Key, b: Key, c: Key, f: (k: Key) => number) => {
    const dt = c.t - a.t;
    return dt > 0 ? ((f(c) - f(a)) / dt) * h : 0;
  };
  const herm = (f: (k: Key) => number) => {
    const p1 = f(k1), p2 = f(k2);
    const m1 = tan(k0, k1, k2, f), m2 = tan(k1, k2, k3, f);
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
  };
  const dherm = (f: (k: Key) => number) => {
    const p1 = f(k1), p2 = f(k2);
    const m1 = tan(k0, k1, k2, f), m2 = tan(k1, k2, k3, f);
    const u2 = u * u;
    return ((6 * u2 - 6 * u) * p1 + (3 * u2 - 4 * u + 1) * m1 + (-6 * u2 + 6 * u) * p2 + (3 * u2 - 2 * u) * m2) / h;
  };
  // 里程单调：停车段（两帧 s 相同）用线性，避免 Hermite 过冲导致倒车
  const sLinear = Math.abs(k2.s - k1.s) < 1e-6;
  return {
    s: sLinear ? k1.s : herm((k) => k.s),
    d: herm((k) => k.d),
    yaw: k1.yaw + (k2.yaw - k1.yaw) * smooth(u),
    crush: (k1.crush ?? 0) + ((k2.crush ?? 0) - (k1.crush ?? 0)) * u,
    evidence: rank(k1.evidence) >= rank(k2.evidence) ? k1.evidence : k2.evidence,
    speed: sLinear ? 0 : Math.max(0, dherm((k) => k.s)),
  };
}

function poseOf(k: Key, speed: number): Pose {
  return { s: k.s, d: k.d, yaw: k.yaw, crush: k.crush ?? 0, evidence: k.evidence, speed };
}

const smooth = (u: number) => u * u * (3 - 2 * u);
/** 证据等级取“更弱”的那一个：assumed > estimated > measured */
const rank = (e: Evidence) => ({ measured: 0, estimated: 1, assumed: 2 })[e];

export function parseScene(json: unknown): SceneSpec {
  return SceneSpec.parse(json);
}
