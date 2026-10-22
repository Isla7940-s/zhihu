/**
 * 分镜脚本（story.json）。每个镜头 = 一句旁白 + 一个画面。
 * 旁白时长由 TTS 实际音频决定（out/narration/timings.json），画面跟着旁白走。
 */
export type Visual =
  | { type: "title"; kicker?: string; title: string; subtitle?: string; bg?: "evidence" | "scene"; from?: number; camera?: string }
  | { type: "evidence"; from: number; to: number; rate?: number; overlays?: ("events" | "dashes" | "lead" | "grid")[]; caption?: string; freezeAt?: number }
  | { type: "method"; steps: { title: string; desc: string }[]; active?: number }
  | { type: "stat"; items: { label: string; value: string; note?: string; tone?: "warn" | "ok" | "info" }[]; caption?: string }
  | { type: "chart"; kind: "speed" | "gap" | "duty" | "stopping" | "forensics" | "hypotheses" }
  | { type: "scene3d"; camera: string; from: number; to: number; gaps?: { from: string; to: string; label: string }[]; labels?: string[]; showEvidence?: boolean; caption?: string }
  | { type: "timeline" }
  | { type: "lesson"; items: { title: string; desc: string }[] }
  | { type: "end"; lines: string[] };

export type Shot = { id: string; line: string; visual: Visual; pad?: number };

export type Story = {
  id: string;
  title: string;
  format: { width: number; height: number; fps: number };
  voice?: string;
  shots: Shot[];
};
