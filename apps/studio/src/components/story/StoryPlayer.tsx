"use client";
/**
 * 成片播放器：按 timings.json 把镜头排成时间轴，确定性地渲染任意时刻 t。
 * 导出脚本通过 window.__crashlab.seek(frame) 逐帧推进并截图（见 scripts/render-video.mjs）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "@/lib/analysis";
import type { SceneSpec } from "@/lib/scene";
import type { Shot, Story } from "@/lib/story";
import { EvidenceFrame, frameUrl, preloadFrame, type FrameIndex } from "../EvidenceFrame";
import { SceneView } from "../SceneView";
import { ForensicsChart, GapChart, HypothesesChart, SpeedChart, StoppingChart, TimelineChart } from "../charts";

export type Timings = { lines: { id: string; start: number; duration: number; slot: number; text: string }[]; total: number };

type Props = {
  caseId: string;
  story: Story;
  timings: Timings;
  analysis: Analysis;
  scene: SceneSpec;
  frames: FrameIndex;
  meta: Record<string, any>;
  mode: "preview" | "render";
};

declare global {
  interface Window {
    __crashlab?: { ready: boolean; duration: number; fps: number; seek: (frame: number) => Promise<void> };
  }
}

const W = 1080, H = 1920;
const VIS_TOP = 210, VIS_H = 1290;

export function StoryPlayer({ caseId, story, timings, analysis, scene, frames, meta, mode }: Props) {
  const [t, setT] = useState(0);
  // seek 到与当前相同的时刻不会触发重渲染；用序号强制走一遍等待逻辑
  const [seq, setSeq] = useState(0);
  const waiters = useRef<(() => void)[]>([]);
  const fps = story.format.fps;
  const duration = timings.total;

  const shots = useMemo(() => {
    const byId = Object.fromEntries(story.shots.map((s) => [s.id, s]));
    return timings.lines.map((l) => ({ ...l, shot: byId[l.id] as Shot }));
  }, [story, timings]);

  const cur = useMemo(() => {
    let k = shots.findIndex((s) => t < s.start + s.slot);
    if (k < 0) k = shots.length - 1;
    return { ...shots[k], index: k };
  }, [shots, t]);
  const local = Math.max(0, t - cur.start);

  // 证据帧需要的图片 URL（用于导出时等待解码）
  const evidenceT = evidenceTime(cur.shot, local, cur.slot);
  const needUrl = evidenceT != null ? frameUrl(caseId, frames, evidenceT) : null;

  // 3D 镜头首次挂载要编译着色器，导出时必须等它真正画出第一帧；之后每次 seek 等它画完新的一帧
  const sceneReady = useRef(false);
  const sceneFrame = useRef(0);
  const sceneInvalidate = useRef<(() => void) | null>(null);
  const is3d = cur.shot.visual.type === "scene3d";
  useEffect(() => {
    if (!is3d) {
      sceneReady.current = false;
      sceneFrame.current = 0;
    }
  }, [is3d]);

  useEffect(() => {
    if (!waiters.current.length) return;
    const list = waiters.current.splice(0);
    const done = () => list.forEach((f) => f());
    const raf3 = () => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)));
    const wait = needUrl ? preloadFrame(needUrl) : Promise.resolve();
    wait.then(() => {
      if (!is3d) return raf3();
      const poll = () => {
        if (!sceneReady.current) return setTimeout(poll, 30);
        const before = sceneFrame.current;
        sceneInvalidate.current?.();
        const waitFrame = () => (sceneFrame.current > before ? requestAnimationFrame(() => requestAnimationFrame(done)) : setTimeout(waitFrame, 10));
        waitFrame();
      };
      poll();
    });
  }, [t, seq, needUrl, is3d]);

  const seek = useCallback((frame: number) => new Promise<void>((resolve) => {
    waiters.current.push(resolve);
    setT(frame / fps);
    setSeq((n) => n + 1);
  }), [fps]);

  useEffect(() => {
    window.__crashlab = { ready: true, duration, fps, seek };
    return () => { delete window.__crashlab; };
  }, [duration, fps, seek]);

  // 预览模式：随音频播放
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (mode !== "preview") return;
    let raf = 0;
    const tick = () => {
      if (audioRef.current && !audioRef.current.paused) setT(audioRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  const fadeIn = Math.min(1, local / 0.25);

  return (
    <div style={{ width: W, height: H, position: "relative", overflow: "hidden", background: "radial-gradient(120% 60% at 50% 0%, #1a1f2b 0%, #0b0d12 60%)", color: "#e8ebf1", fontFamily: "'Noto Sans SC','WenQuanYi Zen Hei',sans-serif" }}>
      <Header title={story.title} />
      <div style={{ position: "absolute", left: 0, top: VIS_TOP, width: W, height: VIS_H, opacity: fadeIn }}>
        <Visual shot={cur.shot} local={local} slot={cur.slot} caseId={caseId} analysis={analysis} scene={scene} frames={frames} mode={mode}
          onSceneReady={() => { sceneReady.current = true; }}
          onSceneFrame={(n) => { sceneFrame.current = n; }}
          registerInvalidate={(fn) => { sceneInvalidate.current = fn; }} />
      </div>
      <Subtitle text={cur.text} local={local} speech={cur.duration} />
      <Footer meta={meta} t={t} duration={duration} chapter={chapterOf(cur.shot.id)} />
      {mode === "preview" && (
        <div style={{ position: "absolute", left: 20, right: 20, bottom: 96, display: "flex", gap: 12, alignItems: "center" }}>
          <audio ref={audioRef} src={`/cases/${caseId}/narration.wav`} controls style={{ width: "100%" }} />
        </div>
      )}
    </div>
  );
}

function chapterOf(id: string) {
  if (["forensics"].includes(id)) return "1/4 取证";
  if (["dash", "duty", "decel"].includes(id)) return "2/4 测速";
  if (["lead", "gap", "headway", "stopping"].includes(id)) return "3/4 测距";
  if (id.startsWith("recon") || id === "timeline") return "4/4 重建";
  return "";
}

function evidenceTime(shot: Shot, local: number, slot: number): number | null {
  const v = shot.visual;
  if (v.type === "evidence") {
    const tt = v.from + local * (v.rate ?? 1);
    return Math.min(v.freezeAt ?? v.to, Math.min(v.to, tt));
  }
  if (v.type === "title" && v.bg === "evidence") return (v.from ?? 0) + Math.min(local, slot) * 0.6;
  return null;
}

function Header({ title }: { title: string }) {
  return (
    <div style={{ position: "absolute", top: 54, left: 0, width: W, textAlign: "center" }}>
      <div style={{ display: "inline-block", fontSize: 24, color: "#aab2c2", border: "1px solid #2c3240", borderRadius: 999, padding: "6px 18px", letterSpacing: 2 }}>
        事故重建 · Accident Reconstruction
      </div>
      <div style={{ fontSize: 50, fontWeight: 900, marginTop: 18, letterSpacing: 1 }}>
        {title.split("，").map((p, i) => (
          <span key={i} style={{ color: i === 1 ? "#ff4d6d" : "#fff" }}>{i ? "，" : ""}{p}</span>
        ))}
      </div>
    </div>
  );
}

/** 字幕：按标点切块，按字数比例分配时长，只显示当前块 */
function Subtitle({ text, local, speech }: { text: string; local: number; speech: number }) {
  const chunks = useMemo(() => {
    const parts = text.split(/(?<=[，。；：？！,;:?!])/).map((s) => s.trim()).filter(Boolean);
    const merged: string[] = [];
    for (const p of parts) {
      if (merged.length && (merged[merged.length - 1] + p).length <= 16) merged[merged.length - 1] += p;
      else merged.push(p);
    }
    const total = merged.reduce((s, p) => s + p.length, 0);
    let acc = 0;
    return merged.map((p) => {
      const start = (acc / total) * speech;
      acc += p.length;
      return { text: p.replace(/[，。；：,;:]$/, ""), start };
    });
  }, [text, speech]);
  const cur = [...chunks].reverse().find((c) => local >= c.start) ?? chunks[0];
  return (
    <div style={{ position: "absolute", top: 1530, left: 60, width: W - 120, height: 230, display: "grid", placeItems: "center", textAlign: "center" }}>
      <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.3, textShadow: "0 4px 18px rgba(0,0,0,0.6)" }}>
        {highlightNumbers(cur?.text ?? "")}
      </div>
    </div>
  );
}

function highlightNumbers(s: string) {
  const parts = s.split(/(\d+(?:\.\d+)?%?)/);
  return parts.map((p, i) => (/^\d/.test(p) ? <span key={i} style={{ color: "#ffb020" }}>{p}</span> : <span key={i}>{p}</span>));
}

function Footer({ meta, t, duration, chapter }: { meta: Record<string, any>; t: number; duration: number; chapter: string }) {
  return (
    <div style={{ position: "absolute", left: 0, bottom: 0, width: W, height: 130 }}>
      <div style={{ position: "absolute", left: 60, right: 60, top: 18, display: "flex", justifyContent: "space-between", fontSize: 22, color: "#7d8597" }}>
        <span>{meta.disclaimer}</span>
        <span style={{ color: "#ffb020" }}>{chapter}</span>
      </div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 56, fontSize: 20, color: "#5d6577" }}>
        素材：{meta.source?.platform} @{meta.source?.account} · 地点未核实 · 结果未知
      </div>
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: `${(t / duration) * 100}%`, background: "#ff4d6d" }} />
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "rgba(20,24,33,0.92)", border: "1px solid #262b37", borderRadius: 28, padding: 40, ...style }}>{children}</div>
  );
}

function Caption({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div style={{ position: "absolute", left: 60, top: 18, zIndex: 3, fontSize: 28, background: "rgba(0,0,0,0.6)", padding: "8px 18px", borderRadius: 12, borderLeft: "6px solid #ffb020" }}>
      {text}
    </div>
  );
}

function EvidenceLegend() {
  const items = [["实测", "#22c55e"], ["推算", "#f59e0b"], ["示意推定", "#a78bfa"]];
  return (
    <div style={{ position: "absolute", right: 40, bottom: 30, display: "flex", gap: 18, fontSize: 24, background: "rgba(0,0,0,0.55)", padding: "8px 16px", borderRadius: 12 }}>
      {items.map(([l, c]) => (
        <span key={l}><i style={{ display: "inline-block", width: 16, height: 16, background: c, borderRadius: 4, marginRight: 8, verticalAlign: -1 }} />{l}</span>
      ))}
    </div>
  );
}

function Visual({ shot, local, slot, caseId, analysis, scene, frames, mode, onSceneReady, onSceneFrame, registerInvalidate }: {
  shot: Shot; local: number; slot: number; caseId: string; analysis: Analysis; scene: SceneSpec; frames: FrameIndex; mode: string;
  onSceneReady: () => void;
  onSceneFrame: (n: number) => void;
  registerInvalidate: (fn: () => void) => void;
}) {
  const v = shot.visual;
  const progress = Math.min(1, local / Math.max(0.8, slot * 0.7));
  switch (v.type) {
    case "title": {
      const et = evidenceTime(shot, local, slot) ?? 0;
      return (
        <div style={{ position: "absolute", inset: 0 }}>
          <div style={{ position: "absolute", left: 40, right: 40, top: 40, borderRadius: 28, overflow: "hidden", filter: "brightness(0.55) saturate(0.9)" }}>
            <EvidenceFrame caseId={caseId} idx={frames} analysis={null} t={et} />
          </div>
          <div style={{ position: "absolute", left: 60, right: 60, top: 860, whiteSpace: "pre-line" }}>
            <div style={{ fontSize: 30, color: "#ffb020", fontWeight: 700, marginBottom: 18 }}>{v.kicker}</div>
            <div style={{ fontSize: 92, fontWeight: 900, lineHeight: 1.12 }}>{v.title}</div>
            {v.subtitle && <div style={{ fontSize: 34, color: "#aab2c2", marginTop: 24 }}>{v.subtitle}</div>}
          </div>
        </div>
      );
    }
    case "evidence": {
      const et = evidenceTime(shot, local, slot) ?? v.from;
      return (
        <div style={{ position: "absolute", inset: 0, display: "grid", alignContent: "center" }}>
          <div style={{ position: "relative", margin: "0 40px", borderRadius: 24, overflow: "hidden", border: "1px solid #262b37" }}>
            <Caption text={v.caption} />
            <EvidenceFrame caseId={caseId} idx={frames} analysis={analysis} t={et} overlays={v.overlays} />
            <div style={{ position: "absolute", right: 20, top: 18, fontSize: 30, fontFamily: "monospace", background: "rgba(0,0,0,0.6)", padding: "6px 14px", borderRadius: 10 }}>
              t = {et.toFixed(2)} s{(v.rate ?? 1) !== 1 ? `  ×${v.rate}` : ""}
            </div>
          </div>
        </div>
      );
    }
    case "method":
      return (
        <div style={{ position: "absolute", inset: "120px 60px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30 }}>
          {v.steps.map((s, i) => {
            const p = Math.min(1, Math.max(0, local * 2.2 - i * 0.45));
            return (
              <Card key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px)`, display: "grid", alignContent: "center" }}>
                <div style={{ fontSize: 30, color: "#ffb020", fontWeight: 800 }}>第 {i + 1} 步</div>
                <div style={{ fontSize: 76, fontWeight: 900, margin: "12px 0" }}>{s.title}</div>
                <div style={{ fontSize: 32, color: "#aab2c2" }}>{s.desc}</div>
              </Card>
            );
          })}
        </div>
      );
    case "stat":
      return (
        <div style={{ position: "absolute", inset: "100px 60px", display: "grid", gap: 30, alignContent: "center" }}>
          {v.items.map((it, i) => {
            const p = Math.min(1, Math.max(0, local * 2 - i * 0.4));
            const color = { warn: "#ff4d6d", ok: "#22c55e", info: "#38bdf8" }[it.tone ?? "info"];
            return (
              <Card key={i} style={{ opacity: p, display: "flex", justifyContent: "space-between", alignItems: "center", borderLeft: `10px solid ${color}` }}>
                <div>
                  <div style={{ fontSize: 44, fontWeight: 800 }}>{it.label}</div>
                  {it.note && <div style={{ fontSize: 28, color: "#8b93a5", marginTop: 8 }}>{it.note}</div>}
                </div>
                <div style={{ fontSize: 110, fontWeight: 900, color }}>{it.value}</div>
              </Card>
            );
          })}
          {v.caption && <div style={{ fontSize: 30, color: "#8b93a5", textAlign: "center" }}>{v.caption}</div>}
        </div>
      );
    case "chart": {
      const C = { forensics: ForensicsChart, hypotheses: HypothesesChart, speed: SpeedChart, gap: GapChart, stopping: StoppingChart, duty: HypothesesChart }[v.kind];
      return (
        <div style={{ position: "absolute", inset: "60px 40px", display: "grid", alignContent: "center" }}>
          <Card style={{ padding: 40 }}>
            <C a={analysis} progress={progress} />
          </Card>
        </div>
      );
    }
    case "timeline":
      return (
        <div style={{ position: "absolute", inset: "40px 40px", display: "grid", alignContent: "center" }}>
          <Card style={{ padding: 40 }}>
            <TimelineChart a={analysis} progress={Math.min(1, local / Math.max(1, slot * 0.6))} />
          </Card>
        </div>
      );
    case "scene3d": {
      const u = Math.min(1, local / slot);
      const st = v.from + (v.to - v.from) * u;
      const labels = (v.labels ?? []).map((id) => {
        const a = scene.actors.find((x) => x.id === id);
        return { id, text: a?.label ?? id };
      });
      const note = scene.notes.find((n) => st >= n.from && st < n.to);
      return (
        <div style={{ position: "absolute", inset: 0 }}>
          <SceneView spec={scene} t={st} camera={v.camera} gaps={v.gaps} labels={labels} showEvidence={v.showEvidence}
            dpr={1} preserveDrawingBuffer={mode === "render"} onReady={onSceneReady} quality={mode === "render" ? "render" : "preview"}
            frameloop={mode === "render" ? "demand" : "always"} onFrame={onSceneFrame} registerInvalidate={registerInvalidate} />
          <Caption text={v.caption} />
          <div style={{ position: "absolute", right: 40, top: 18, fontSize: 30, fontFamily: "monospace", background: "rgba(0,0,0,0.55)", padding: "6px 14px", borderRadius: 10 }}>
            t = {st.toFixed(2)} s
          </div>
          {note && (
            <div style={{ position: "absolute", left: 40, bottom: 90, fontSize: 26, background: "rgba(0,0,0,0.55)", padding: "8px 16px", borderRadius: 10 }}>
              {note.text}
            </div>
          )}
          {v.showEvidence && <EvidenceLegend />}
        </div>
      );
    }
    case "lesson":
      return (
        <div style={{ position: "absolute", inset: "80px 60px", display: "grid", gap: 30, alignContent: "center" }}>
          {v.items.map((it, i) => {
            const p = Math.min(1, Math.max(0, local * 1.6 - i * 0.6));
            return (
              <Card key={i} style={{ opacity: p, transform: `translateX(${(1 - p) * 60}px)`, display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center" }}>
                <div style={{ fontSize: 96, fontWeight: 900, color: "#ffb020" }}>{i + 1}</div>
                <div>
                  <div style={{ fontSize: 52, fontWeight: 900 }}>{it.title}</div>
                  <div style={{ fontSize: 30, color: "#aab2c2", marginTop: 10 }}>{it.desc}</div>
                </div>
              </Card>
            );
          })}
        </div>
      );
    case "end":
      return (
        <div style={{ position: "absolute", inset: "200px 60px", display: "grid", alignContent: "center", gap: 28, textAlign: "center" }}>
          {v.lines.map((l, i) => (
            <div key={i} style={{ fontSize: i === 0 ? 46 : 32, fontWeight: i === 0 ? 900 : 500, color: i === 0 ? "#fff" : "#8b93a5" }}>{l}</div>
          ))}
        </div>
      );
  }
}
