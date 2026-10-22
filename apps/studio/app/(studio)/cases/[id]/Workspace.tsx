"use client";
/**
 * 案例工作台：证据（逐帧 + 分析叠加 + 事件）、测量（图表与区间）、三维重建（时间轴 + 多机位 + 关键帧编辑）、成片（预览）。
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CaseBundle } from "@/lib/cases";
import { fmt, primaryOf } from "@/lib/analysis";
import { EvidenceFrame } from "@/components/EvidenceFrame";
import { ForensicsChart, GapChart, HypothesesChart, SpeedChart, StoppingChart, TimelineChart } from "@/components/charts";
import type { Key, SceneSpec } from "@/lib/scene";

const SceneView = dynamic(() => import("@/components/SceneView").then((m) => m.SceneView), { ssr: false });

type Tab = "evidence" | "measure" | "scene" | "story";

export function Workspace({ bundle }: { bundle: CaseBundle }) {
  const [tab, setTab] = useState<Tab>("evidence");
  const { meta, analysis } = bundle;
  return (
    <div className="page">
      <h1>{meta.title}</h1>
      <p className="sub">
        {meta.kind === "dashcam" ? "行车记录仪" : "固定机位"} · 地点 {meta.location} · 素材 {meta.source?.platform} @{meta.source?.account} ·{" "}
        <span style={{ color: "var(--warn)" }}>{meta.source?.rights}</span>
      </p>
      <div className="tabs" role="tablist">
        {([["evidence", "证据"], ["measure", "测量"], ["scene", "三维重建"], ["story", "成片"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "evidence" && <EvidenceTab bundle={bundle} />}
      {tab === "measure" && analysis && <MeasureTab bundle={bundle} />}
      {tab === "scene" && bundle.scene && <SceneTab bundle={bundle} />}
      {tab === "story" && <StoryTab bundle={bundle} />}
      {!analysis && tab !== "evidence" && <p className="sub">还没有分析结果：python -m crashlab analyze cases/{bundle.id}</p>}
    </div>
  );
}

function usePlayer(duration: number, rate = 1) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      setT((x) => {
        const n = x + ((now - last) / 1000) * rate;
        return n > duration ? 0 : n;
      });
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, rate]);
  return { t, setT, playing, setPlaying };
}

function Scrubber({ t, setT, playing, setPlaying, duration }: ReturnType<typeof usePlayer> & { duration: number }) {
  return (
    <div className="scrub">
      <button className="btn" onClick={() => setPlaying(!playing)}>{playing ? "暂停" : "播放"}</button>
      <button className="btn" onClick={() => setT(Math.max(0, t - 1 / 30))}>‹ 帧</button>
      <button className="btn" onClick={() => setT(Math.min(duration, t + 1 / 30))}>帧 ›</button>
      <input type="range" min={0} max={duration} step={1 / 60} value={t} onChange={(e) => setT(+e.target.value)} />
      <span className="mono">{t.toFixed(2)} s</span>
    </div>
  );
}

function EvidenceTab({ bundle }: { bundle: CaseBundle }) {
  const dur = bundle.analysis?.forensics.blackout_t ? bundle.analysis.forensics.blackout_t + 0.3 : 12.5;
  const p = usePlayer(dur);
  const [ov, setOv] = useState<("events" | "dashes" | "lead")[]>(["events", "dashes", "lead"]);
  if (!bundle.frames) return <p className="sub">还没有抽帧：python -m crashlab frames cases/{bundle.id}</p>;
  const events = bundle.analysis?.events ?? bundle.config.annotations?.events ?? [];
  const activeIdx = events.reduce((k: number, e: any, i: number) => (e.t <= p.t ? i : k), -1);
  return (
    <div className="ws">
      <div>
        <div className="viewer">
          <EvidenceFrame caseId={bundle.id} idx={bundle.frames} analysis={bundle.analysis} t={p.t} overlays={ov} />
        </div>
        <Scrubber {...p} duration={dur} />
        <div className="legend">
          {(["events", "dashes", "lead"] as const).map((k) => (
            <label key={k} style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={ov.includes(k)} onChange={(e) => setOv(e.target.checked ? [...ov, k] : ov.filter((x) => x !== k))} />{" "}
              {{ events: "事件", dashes: "虚线检测", lead: "前车边沿" }[k]}
            </label>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>人工标注 · 事件</h3>
        <ul className="events">
          {events.map((e: any, i: number) => (
            <li key={i} className={i === activeIdx ? "active" : ""} onClick={() => p.setT(e.t)}>
              <span className="t">{e.t.toFixed(2)}s</span>
              <span>{e.label}</span>
            </li>
          ))}
        </ul>
        {bundle.analysis && (
          <>
            <h3 style={{ marginTop: 18 }}>取证</h3>
            <dl className="kv">
              <dt>容器帧率</dt><dd className="mono">{bundle.analysis.forensics.container_fps} fps</dd>
              <dt>真实画面</dt><dd className="mono">{bundle.analysis.forensics.unique_frames} / {bundle.analysis.forensics.frames}</dd>
              <dt>时刻不确定度</dt><dd className="mono">±{(bundle.analysis.forensics.timing_uncertainty_s * 1000).toFixed(0)} ms</dd>
              <dt>画面中断</dt><dd className="mono">{bundle.analysis.forensics.blackout_t?.toFixed(2)} s</dd>
            </dl>
          </>
        )}
      </div>
    </div>
  );
}

function MeasureTab({ bundle }: { bundle: CaseBundle }) {
  const a = bundle.analysis!;
  const h = primaryOf(a);
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))" }}>
      <div className="card">
        <h3>结论（主假设：{h.label}）</h3>
        <dl className="kv">
          <dt>本车速度</dt><dd className="mono">{fmt(h.ego_speed_kmh)} km/h</dd>
          <dt>车头时距 @1.5s</dt><dd className="mono">{fmt(h.lead.headway_at_1p5s, 2)} s</dd>
          <dt>停车距离</dt><dd className="mono">{fmt(h.stopping_distance_m)} m</dd>
          <dt>相机高度</dt><dd className="mono">{fmt(h.camera.height_m, 2)} m</dd>
          <dt>水平视场角</dt><dd className="mono">{fmt(h.camera.hfov_deg)}°</dd>
          <dt>雾能见度（粗估）</dt><dd className="mono">{fmt(h.visibility_m)} m</dd>
        </dl>
      </div>
      {[["取证：重复帧", ForensicsChart], ["标线规格假设", HypothesesChart], ["本车速度", SpeedChart], ["车距", GapChart], ["停车距离", StoppingChart], ["时间线", TimelineChart]].map(([title, C]: any) => (
        <div key={title} className="card">
          <h3>{title}</h3>
          <C a={a} />
        </div>
      ))}
    </div>
  );
}

function SceneTab({ bundle }: { bundle: CaseBundle }) {
  const [scene, setScene] = useState<SceneSpec>(bundle.scene!);
  const p = usePlayer(scene.duration);
  const [cam, setCam] = useState<string>("orbit");
  const [sel, setSel] = useState(scene.actors[0].id);
  const [saved, setSaved] = useState<string>("");
  const actor = scene.actors.find((a) => a.id === sel)!;
  const labels = useMemo(() => scene.actors.map((a) => ({ id: a.id, text: a.label ?? a.id })), [scene]);

  const updateKey = (i: number, patch: Partial<Key>) => {
    setScene((s) => ({
      ...s,
      actors: s.actors.map((a) => (a.id !== sel ? a : { ...a, keys: a.keys.map((k, j) => (j === i ? { ...k, ...patch } : k)) })),
    }));
  };
  const save = async () => {
    const r = await fetch(`/api/cases/${bundle.id}/scene`, { method: "PUT", body: JSON.stringify(scene) });
    setSaved(r.ok ? "已保存到 scene.json" : `保存失败 ${r.status}`);
  };
  return (
    <div className="ws">
      <div>
        <div className="viewer" style={{ height: 560 }}>
          <SceneView spec={scene} t={p.t} camera={cam === "orbit" ? undefined : cam} orbit={cam === "orbit"} labels={labels} showEvidence />
        </div>
        <Scrubber {...p} duration={scene.duration} />
        <div className="legend">
          <span><i style={{ background: "var(--measured)" }} />实测</span>
          <span><i style={{ background: "var(--estimated)" }} />推算</span>
          <span><i style={{ background: "var(--assumed)" }} />示意推定</span>
          <span style={{ marginLeft: "auto" }}>
            机位：
            <select value={cam} onChange={(e) => setCam(e.target.value)} style={{ background: "var(--panel-2)", color: "inherit", border: "1px solid var(--line)", borderRadius: 6 }}>
              <option value="orbit">自由环绕</option>
              {scene.cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </span>
        </div>
      </div>
      <div className="card" style={{ maxHeight: 700, overflow: "auto" }}>
        <h3>关键帧</h3>
        <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ width: "100%", marginBottom: 10, background: "var(--panel-2)", color: "inherit", border: "1px solid var(--line)", borderRadius: 6, padding: 6 }}>
          {scene.actors.map((a) => <option key={a.id} value={a.id}>{a.label ?? a.id}（{a.asset}）</option>)}
        </select>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead><tr style={{ color: "var(--muted)" }}><th>t</th><th>s</th><th>d</th><th>yaw</th><th>证据</th></tr></thead>
          <tbody>
            {actor.keys.map((k, i) => (
              <tr key={i} onClick={() => p.setT(k.t)} style={{ cursor: "pointer" }}>
                <td className="mono">{k.t}</td>
                {(["s", "d", "yaw"] as const).map((f) => (
                  <td key={f}>
                    <input className="mono" style={{ width: 62, background: "transparent", color: "inherit", border: "1px solid var(--line)", borderRadius: 4 }}
                      type="number" step={f === "s" ? 0.5 : 0.1} value={k[f]} onChange={(e) => updateKey(i, { [f]: +e.target.value })} />
                  </td>
                ))}
                <td style={{ color: `var(--${k.evidence})` }}>{{ measured: "实测", estimated: "推算", assumed: "推定" }[k.evidence]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button className="btn primary" onClick={save}>保存</button>
          <span className="sub" style={{ margin: 0 }}>{saved}</span>
        </div>
        <h3 style={{ marginTop: 18 }}>说明</h3>
        <ul style={{ paddingLeft: 18, color: "var(--muted)", fontSize: 13 }}>
          {scene.notes.map((n, i) => <li key={i} style={{ color: `var(--${n.evidence})` }}>{n.text}</li>)}
        </ul>
      </div>
    </div>
  );
}

function StoryTab({ bundle }: { bundle: CaseBundle }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 420px" }}>
      <div className="card">
        <h3>分镜</h3>
        {!bundle.story ? <p className="sub">没有 story.json</p> : (
          <ol style={{ paddingLeft: 20 }}>
            {bundle.story.shots.map((s) => {
              const tm = bundle.timings?.lines.find((l) => l.id === s.id);
              return (
                <li key={s.id} style={{ marginBottom: 10 }}>
                  <span className="chip">{s.visual.type}</span>{" "}
                  {tm && <span className="mono" style={{ color: "var(--muted)" }}>{tm.start.toFixed(1)}s</span>}
                  <div>{s.line}</div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className="card">
        <h3>预览与导出</h3>
        <p className="sub">预览页按 1080×1920 渲染，随配音播放；导出由 Playwright 逐帧截图 + ffmpeg 合成。</p>
        <Link className="btn primary" href={`/render/${bundle.id}`} target="_blank">打开成片预览</Link>
        <pre className="code">{`# 一条龙
python -m crashlab all cases/${bundle.id}
cd apps/studio && npm run build && npm start &
npm run render -- ${bundle.id}`}</pre>
      </div>
    </div>
  );
}
