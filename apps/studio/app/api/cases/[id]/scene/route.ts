import { NextResponse } from "next/server";
import { loadCase, saveScene } from "@/lib/cases";
import { SceneSpec } from "@/lib/scene";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await loadCase(id);
  return NextResponse.json(c.scene);
}

/** Studio 里编辑关键帧后保存回 cases/<id>/scene.json（先过 schema 校验） */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = SceneSpec.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  await saveScene(id, parsed.data);
  return NextResponse.json({ ok: true });
}
