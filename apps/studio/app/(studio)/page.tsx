import Link from "next/link";
import { listCases, loadCase } from "@/lib/cases";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ids = await listCases();
  const cases = await Promise.all(ids.map((id) => loadCase(id)));
  return (
    <div className="page">
      <h1>案例</h1>
      <p className="sub">每个案例 = 证据视频 + 人工标注 + 分析结果 + 三维场景 + 分镜脚本。流水线：取证 → 测量 → 重建 → 审查 → 配音 → 渲染。</p>
      <div className="grid cards">
        {cases.map((c) => (
          <Link key={c.id} href={`/cases/${c.id}`} className="card">
            <h3>{c.meta.title}</h3>
            <div className="meta">
              {c.meta.kind === "dashcam" ? "行车记录仪" : "固定机位"} · 地点 {c.meta.location} · {c.meta.date}
            </div>
            <div className="chips">
              <span className={`chip ${c.analysis ? "ok" : "bad"}`}>分析 {c.analysis ? "✓" : "未运行"}</span>
              <span className={`chip ${c.scene ? "ok" : "bad"}`}>三维场景 {c.scene ? `${c.scene.actors.length} 个对象` : "无"}</span>
              <span className={`chip ${c.timings ? "ok" : "warn"}`}>配音 {c.timings ? `${c.timings.total.toFixed(0)} s` : "未生成"}</span>
              <span className={`chip ${String(c.meta.source?.rights ?? "").includes("未取得") ? "warn" : "ok"}`}>
                {String(c.meta.source?.rights ?? "").includes("未取得") ? "素材未授权 · 仅内部" : "素材已授权"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
