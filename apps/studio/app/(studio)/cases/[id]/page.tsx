import { notFound } from "next/navigation";
import { loadCase } from "@/lib/cases";
import { Workspace } from "./Workspace";

export const dynamic = "force-dynamic";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await loadCase(id).catch(() => null);
  if (!c) notFound();
  return <Workspace bundle={JSON.parse(JSON.stringify(c))} />;
}
