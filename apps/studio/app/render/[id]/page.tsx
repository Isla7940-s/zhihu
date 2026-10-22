import { notFound } from "next/navigation";
import { loadCase } from "@/lib/cases";
import { RenderClient } from "./RenderClient";

export const dynamic = "force-dynamic";

export default async function RenderPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { id } = await params;
  const { mode } = await searchParams;
  const c = await loadCase(id).catch(() => null);
  if (!c || !c.story || !c.timings || !c.analysis || !c.scene || !c.frames) {
    return (
      <pre style={{ color: "#fff", padding: 24 }}>
        缺少渲染所需数据：{JSON.stringify({ story: !!c?.story, timings: !!c?.timings, analysis: !!c?.analysis, scene: !!c?.scene, frames: !!c?.frames })}
        {"\n"}先运行 python -m crashlab all cases/{id}
      </pre>
    );
  }
  if (!c) notFound();
  return (
    <RenderClient caseId={id} story={c.story} timings={c.timings as any} analysis={c.analysis} scene={c.scene}
      frames={c.frames} meta={c.meta} mode={mode === "render" ? "render" : "preview"} />
  );
}
