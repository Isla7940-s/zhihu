"use client";
/**
 * 证据视频的确定性逐帧显示（预抽好的 JPG 序列），叠加分析结果：
 * 虚线检测框、前车左右边沿、事件标签。工作台和成片渲染共用。
 */
import { useEffect, useRef } from "react";
import type { Analysis } from "@/lib/analysis";

export type FrameIndex = { fps: number; count: number; width: number; height: number };

export function frameUrl(caseId: string, idx: FrameIndex, t: number) {
  const i = Math.min(idx.count, Math.max(1, Math.floor(t * idx.fps) + 1));
  return `/cases/${caseId}/frames/${String(i).padStart(5, "0")}.jpg`;
}

/** 预加载并解码，供渲染时等待 */
export function preloadFrame(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => (img.decode ? img.decode().then(() => resolve(), () => resolve()) : resolve());
    img.onerror = () => resolve();
    img.src = url;
  });
}

type Overlay = "events" | "dashes" | "lead" | "grid";

export function EvidenceFrame({ caseId, idx, analysis, t, overlays = [], style, scale = 1 }: {
  caseId: string;
  idx: FrameIndex;
  analysis: Analysis | null;
  t: number;
  overlays?: Overlay[];
  style?: React.CSSProperties;
  scale?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = idx.width, H = idx.height;
    c.width = W * scale;
    c.height = H * scale;
    const g = c.getContext("2d")!;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!analysis) return;
    const near = <T extends { t: number }>(arr: T[], tol: number) => {
      let best: T | null = null;
      let bd = tol;
      for (const x of arr) {
        const d = Math.abs(x.t - t);
        if (d <= bd) { bd = d; best = x; }
      }
      return best;
    };
    if (overlays.includes("dashes")) {
      const d = near(analysis.dashes.detections, 0.05);
      if (d) {
        const w = 26 + (d.bottom - 430) * 0.25;
        g.strokeStyle = "#22c55e";
        g.lineWidth = 4;
        g.strokeRect(d.x - w, d.top - 6, 2 * w, d.bottom - d.top + 12);
        g.fillStyle = "#22c55e";
        g.font = "bold 22px sans-serif";
        g.fillText("虚线", d.x + w + 8, d.top + 18);
      }
      // 测量行
      g.setLineDash([10, 8]);
      g.strokeStyle = "rgba(255,255,255,0.7)";
      g.lineWidth = 2;
      for (const y of [460, 500]) {
        g.beginPath();
        g.moveTo(380, y);
        g.lineTo(780, y);
        g.stroke();
      }
      g.setLineDash([]);
    }
    if (overlays.includes("lead")) {
      const o = near(analysis.lead_track.filter((x) => x.kept), 0.05);
      if (o) {
        g.strokeStyle = "#ffb020";
        g.lineWidth = 4;
        for (const x of [o.left, o.right]) {
          g.beginPath();
          g.moveTo(x, o.row - 70);
          g.lineTo(x, o.row + 140);
          g.stroke();
        }
        g.beginPath();
        g.moveTo(o.left, o.row);
        g.lineTo(o.right, o.row);
        g.stroke();
        g.fillStyle = "#ffb020";
        g.font = "bold 26px sans-serif";
        g.fillText(`${(o.right - o.left).toFixed(0)} px`, (o.left + o.right) / 2 - 36, o.row - 14);
      }
    }
    if (overlays.includes("events")) {
      const ev = [...analysis.events].reverse().find((e) => e.t <= t + 1e-6);
      if (ev) {
        const color = { impact: "#ff3b30", end: "#ff3b30", loss: "#ff4d6d", hazard: "#ffb020" }[ev.kind] ?? "#ffffff";
        g.font = "bold 30px sans-serif";
        const text = `${ev.t.toFixed(1)}s  ${ev.label}`;
        const w = g.measureText(text).width + 28;
        g.fillStyle = "rgba(0,0,0,0.65)";
        g.fillRect(20, H - 74, w, 50);
        g.fillStyle = color;
        g.fillRect(20, H - 74, 6, 50);
        g.fillStyle = "#fff";
        g.fillText(text, 36, H - 38);
      }
    }
  }, [analysis, t, overlays.join(","), idx, scale]);

  const ended = analysis?.forensics.blackout_t != null && t >= analysis.forensics.blackout_t;
  return (
    <div style={{ position: "relative", aspectRatio: `${idx.width} / ${idx.height}`, background: "#000", ...style }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={frameUrl(caseId, idx, t)} alt="" style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }} />
      <canvas ref={ref} className="overlay" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      {ended && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#ff4d6d", fontWeight: 800, fontSize: "4cqw" }}>
          画面中断
        </div>
      )}
    </div>
  );
}
