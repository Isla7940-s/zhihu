#!/usr/bin/env node
/**
 * 成片导出：Playwright 打开 /render/<id>?mode=render，逐帧 seek + 截图，管道送进 ffmpeg。
 * 多 worker 并行渲染不同帧区间（各自出一段 mp4），最后无损拼接并混入旁白。
 *
 * 用法：node scripts/render-video.mjs <caseId> [--workers 3] [--from 0] [--to <s>] [--base http://localhost:3000]
 * 依赖：已运行 python -m crashlab all cases/<id>；Studio 已启动（建议 npm run build && npm start）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const args = process.argv.slice(2);
const caseId = args[0];
if (!caseId) {
  console.error("用法: node scripts/render-video.mjs <caseId> [--workers N] [--from s] [--to s]");
  process.exit(1);
}
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const base = opt("base", "http://localhost:3000");
const workers = +opt("workers", "3");
const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);

const caseDir = path.join(repo, "cases", caseId);
const outDir = path.join(caseDir, "out");
const timings = JSON.parse(fs.readFileSync(path.join(outDir, "narration", "timings.json"), "utf-8"));
const story = JSON.parse(fs.readFileSync(path.join(caseDir, "story.json"), "utf-8"));
const { width, height, fps } = story.format;
const t0 = +opt("from", "0");
const t1 = Math.min(+opt("to", String(timings.total)), timings.total);
const f0 = Math.round(t0 * fps), f1 = Math.round(t1 * fps);
const total = f1 - f0;
const tag = opt("tag", "");
const segDir = path.join(outDir, tag ? `segments_${tag}` : "segments");
fs.mkdirSync(segDir, { recursive: true });

const launchArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-vsync"];

async function renderRange(k, a, b) {
  const browser = await chromium.launch({ args: launchArgs, executablePath });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error(`[w${k}] pageerror`, e.message));
  await page.goto(`${base}/render/${caseId}?mode=render`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForFunction(() => window.__crashlab?.ready, null, { timeout: 120000 });
  const seg = path.join(segDir, `seg_${String(k).padStart(2, "0")}.mp4`);
  const ff = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(fps), seg], { stdio: ["pipe", "inherit", "inherit"] });
  const started = Date.now();
  for (let f = a; f < b; f++) {
    await page.evaluate((n) => window.__crashlab.seek(n), f);
    const buf = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if ((f - a) % 60 === 0) {
      const done = f - a + 1, rate = (Date.now() - started) / done;
      console.log(`[w${k}] ${done}/${b - a} 帧  ${(rate / 1000).toFixed(2)} s/帧  剩余约 ${(((b - f) * rate) / 60000).toFixed(1)} 分钟`);
    }
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  await browser.close();
  return seg;
}

// 按帧数平均切分（3D 镜头慢，交错切分会更均衡，但分段拼接更简单可靠）
const per = Math.ceil(total / workers);
const ranges = Array.from({ length: workers }, (_, k) => [f0 + k * per, Math.min(f1, f0 + (k + 1) * per)]).filter(([a, b]) => b > a);
console.log(`渲染 ${caseId}: ${total} 帧 @${fps}fps, ${ranges.length} 个 worker`);
const segs = await Promise.all(ranges.map(([a, b], k) => renderRange(k, a, b)));

const list = path.join(segDir, "list.txt");
fs.writeFileSync(list, segs.map((s) => `file '${s}'`).join("\n"));
const video = path.join(outDir, tag ? `${caseId}_${tag}.mp4` : `${caseId}.mp4`);
const audio = path.join(outDir, "narration", "narration.wav");
await new Promise((resolve, reject) => {
  const p = spawn("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-ss", String(t0), "-i", audio,
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", video],
    { stdio: "inherit" });
  p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg concat exit ${c}`))));
});
console.log(`完成 → ${video}`);
