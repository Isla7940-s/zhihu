/**
 * 资产注册表：scene.json 里用 asset id 引用，Studio 资产库页面按这里的元数据展示。
 * 新增资产 = 写一个组件 + 在这里登记一行。
 */
import type { ComponentType } from "react";
import type { LightState } from "./parts";
import { BoxTruck, DumpTruck, FlatNoseTruck, Sedan, Van } from "./vehicles";
import { GuardrailSegment, StreetLamp, TrafficCone, TrafficLight, WarningTriangle } from "./infrastructure";

export type AssetMeta = {
  id: string;
  name: string;
  category: "vehicle" | "infrastructure";
  /** 长 × 宽 × 高（米），用于碰撞包络、标注、相机取景 */
  dims: [number, number, number];
  defaults: Record<string, any>;
  /** 可调参数说明，资产库页面生成控件用 */
  knobs?: { key: string; label: string; type: "color" | "number" | "select"; options?: string[]; min?: number; max?: number; step?: number }[];
  description: string;
  component: ComponentType<{ params?: Record<string, any>; lights?: LightState }>;
};

const colorKnob = (key: string, label: string) => ({ key, label, type: "color" as const });
const lenKnob = (key: string, label: string, min: number, max: number) => ({ key, label, type: "number" as const, min, max, step: 0.05 });

export const ASSETS: AssetMeta[] = [
  {
    id: "sedan", name: "小车（三厢轿车）", category: "vehicle", dims: [4.6, 1.8, 1.45],
    defaults: { color: "#c8ccd2" },
    knobs: [colorKnob("color", "车身色"), lenKnob("length", "车长", 3.8, 5.2), lenKnob("width", "车宽", 1.6, 2.0)],
    description: "紧凑/中型轿车。侧面轮廓挤出 + 轮拱 + 玻璃面，适合作为“本车”或第三方小车。",
    component: Sedan,
  },
  {
    id: "van", name: "面包车 / MPV", category: "vehicle", dims: [4.9, 1.85, 2.0],
    defaults: { color: "#9aa1a9" },
    knobs: [colorKnob("color", "车身色"), lenKnob("length", "车长", 4.2, 5.6)],
    description: "单厢车型，用于面包车、商务车、轻客。",
    component: Van,
  },
  {
    id: "box-truck", name: "轻型厢式货车", category: "vehicle", dims: [6.0, 2.2, 3.1],
    defaults: { boxColor: "#e6b422", cabColor: "#e9ecef" },
    knobs: [colorKnob("boxColor", "厢体色"), colorKnob("cabColor", "驾驶室色"), lenKnob("length", "车长", 5, 7.5)],
    description: "4.2 m 厢货一类的轻卡，平头驾驶室。",
    component: BoxTruck,
  },
  {
    id: "dump-truck", name: "自卸车（8×4）", category: "vehicle", dims: [9.8, 2.5, 3.6],
    defaults: { cabColor: "#d9dde2", bodyColor: "#4b5560" },
    knobs: [colorKnob("cabColor", "驾驶室色"), colorKnob("bodyColor", "货厢色"), lenKnob("length", "车长", 8, 11)],
    description: "平头重卡底盘 + 开口货厢，四轴（后两轴双胎），带红白反光贴与防钻撞梁。",
    component: DumpTruck,
  },
  {
    id: "flat-nose-truck", name: "平头货车（厢式 6×2）", category: "vehicle", dims: [9.6, 2.5, 3.9],
    defaults: { cabColor: "#f2f3f4", boxColor: "#eef0f2", livery: "#d8361f" },
    knobs: [colorKnob("cabColor", "驾驶室色"), colorKnob("boxColor", "厢体色"), colorKnob("livery", "涂装色"), lenKnob("length", "车长", 7, 12)],
    description: "平头驾驶室 + 封闭厢体，带斜向色带涂装。",
    component: FlatNoseTruck,
  },
  {
    id: "traffic-light", name: "红绿灯（悬臂式）", category: "infrastructure", dims: [0.6, 5.5, 6.2],
    defaults: { state: "red", heads: 2, arm: 5.5 },
    knobs: [{ key: "state", label: "灯色", type: "select", options: ["red", "yellow", "green", "off"] }, lenKnob("arm", "悬臂长", 3, 9)],
    description: "立柱 + 悬臂 + 三色灯头，灯色可按时间轴切换。",
    component: TrafficLight,
  },
  {
    id: "street-lamp", name: "路灯", category: "infrastructure", dims: [0.4, 1.8, 9],
    defaults: { on: false }, description: "单臂路灯，夜景可点亮。", component: StreetLamp,
  },
  {
    id: "guardrail", name: "波形护栏（一段）", category: "infrastructure", dims: [12, 0.3, 0.76],
    defaults: { length: 12, postSpacing: 4 }, description: "三波/两波护栏的简化。整条路的护栏由道路生成器自动布设。",
    component: GuardrailSegment,
  },
  {
    id: "traffic-cone", name: "锥桶", category: "infrastructure", dims: [0.42, 0.42, 0.7],
    defaults: {}, description: "事故现场摆放示意。", component: TrafficCone,
  },
  {
    id: "warning-triangle", name: "三角警示牌", category: "infrastructure", dims: [0.44, 0.2, 0.4],
    defaults: {}, description: "高速停车后应在来车方向 150 m 外摆放。", component: WarningTriangle,
  },
];

export const ASSET_MAP = Object.fromEntries(ASSETS.map((a) => [a.id, a])) as Record<string, AssetMeta>;
