/** 服务端：读取仓库根目录 cases/ 下的案例数据（只在 Server Component / Route Handler 中使用）。 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { parseScene, type SceneSpec } from "./scene";
import type { Analysis } from "./analysis";
import type { Story } from "./story";

export const CASES_DIR = path.resolve(process.cwd(), "../../cases");

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

export type CaseBundle = {
  id: string;
  meta: Record<string, any>;
  config: Record<string, any>;
  analysis: Analysis | null;
  scene: SceneSpec | null;
  story: Story | null;
  timings: { lines: { id: string; start: number; duration: number }[]; total: number } | null;
  frames: { fps: number; count: number; width: number; height: number } | null;
};

export async function listCases(): Promise<string[]> {
  const ents = await fs.readdir(CASES_DIR, { withFileTypes: true });
  const ids: string[] = [];
  for (const e of ents) {
    if (e.isDirectory()) {
      try {
        await fs.access(path.join(CASES_DIR, e.name, "case.yaml"));
        ids.push(e.name);
      } catch {}
    }
  }
  return ids.sort();
}

export async function loadCase(id: string): Promise<CaseBundle> {
  if (!/^[\w-]+$/.test(id)) throw new Error("bad case id");
  const dir = path.join(CASES_DIR, id);
  const config = YAML.parse(await fs.readFile(path.join(dir, "case.yaml"), "utf-8"));
  const sceneJson = await readJson<unknown>(path.join(dir, "scene.json"));
  return {
    id,
    meta: config.case,
    config,
    analysis: await readJson<Analysis>(path.join(dir, "out", "analysis.json")),
    scene: sceneJson ? parseScene(sceneJson) : null,
    story: (await readJson<Story>(path.join(dir, "out", "story.resolved.json"))) ?? (await readJson<Story>(path.join(dir, "story.json"))),
    timings: await readJson(path.join(dir, "out", "narration", "timings.json")),
    frames: await readJson(path.join(process.cwd(), "public", "cases", id, "frames", "index.json")),
  };
}

export async function saveScene(id: string, scene: SceneSpec) {
  if (!/^[\w-]+$/.test(id)) throw new Error("bad case id");
  await fs.writeFile(path.join(CASES_DIR, id, "scene.json"), JSON.stringify(scene, null, 1), "utf-8");
}
