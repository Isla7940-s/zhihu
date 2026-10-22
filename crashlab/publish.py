"""给 Studio / 成片准备静态资源：证据视频抽帧（去水印区域打码）、旁白音频。"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .case import Case
from .io import probe, save_json

REPO = Path(__file__).resolve().parents[1]
PUBLIC = REPO / "apps" / "studio" / "public" / "cases"


def export_frames(case: Case, fps: int = 30, quality: int = 3) -> dict:
    ev = case.cfg["evidence"]
    video = case.path(ev["video"])
    info = probe(video)
    end = (case.cfg.get("analysis_end") or info["duration"])
    dst = PUBLIC / case.id / "frames"
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    # 平台水印区域打码：delogo 需要框完全在画面内
    vf = [f"fps={fps}"]
    for x0, y0, x1, y1 in ev.get("watermark_boxes", []):
        x0, y0 = max(1, x0), max(1, y0)
        x1, y1 = min(info["width"] - 2, x1), min(info["height"] - 2, y1)
        vf.append(f"delogo=x={x0}:y={y0}:w={x1 - x0}:h={y1 - y0}")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-t", str(end), "-vf", ",".join(vf),
                    "-q:v", str(quality), str(dst / "%05d.jpg")], check=True)
    count = len(list(dst.glob("*.jpg")))
    index = {"fps": fps, "count": count, "width": info["width"], "height": info["height"],
             "pattern": "%05d.jpg", "first": 1}
    save_json(index, dst / "index.json")
    print(f"抽帧 {count} 张 → {dst}")
    return index


def export_audio(case: Case) -> Path | None:
    src = case.out / "narration" / "narration.wav"
    if not src.exists():
        return None
    dst = PUBLIC / case.id / "narration.wav"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, dst)
    return dst
