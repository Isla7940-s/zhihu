"""ffmpeg 读写封装：原始帧管道进出，避免 OpenCV 依赖。"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image


def require_ffmpeg() -> None:
    for b in ("ffmpeg", "ffprobe"):
        if shutil.which(b) is None:
            raise RuntimeError(f"找不到 {b}，请先安装 ffmpeg")


def probe(path: str | Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,r_frame_rate,nb_frames:format=duration", "-of", "json", str(path)],
        check=True, capture_output=True, text=True).stdout
    j = json.loads(out)
    st = j["streams"][0]
    num, den = st["r_frame_rate"].split("/")
    return {"width": int(st["width"]), "height": int(st["height"]),
            "fps": float(num) / float(den), "duration": float(j["format"]["duration"])}


def read_frames(path: str | Path, width: int | None = None) -> np.ndarray:
    """读出全部帧 (N,H,W,3) uint8。width 给定时等比缩放。"""
    info = probe(path)
    w, h = info["width"], info["height"]
    vf = []
    if width and width != w:
        h = int(round(h * width / w / 2)) * 2
        w = width
        vf = ["-vf", f"scale={w}:{h}"]
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), *vf, "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-fps_mode", "passthrough", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)


def read_gray(path: str | Path, width: int | None = None, t0: float = 0.0,
              t1: float | None = None) -> np.ndarray:
    """读灰度帧 (N,H,W) uint8，可选时间窗与缩放。逐帧精确（不跳过重复帧）。"""
    info = probe(path)
    w, h = info["width"], info["height"]
    vf = []
    if width and width != w:
        h = int(round(h * width / w / 2)) * 2
        w = width
        vf = ["-vf", f"scale={w}:{h}"]
    tw = []
    if t1 is not None:
        tw = ["-t", str(t1 - t0)]
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t0), "-i", str(path), *tw, *vf, "-f", "rawvideo",
                          "-pix_fmt", "gray", "-fps_mode", "passthrough", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w)


class VideoWriter:
    """逐帧写 mp4（H.264, yuv420p），可选混入音轨。"""

    def __init__(self, path: str | Path, width: int, height: int, fps: float, crf: int = 20,
                 audio: str | Path | None = None):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
               "-s", f"{width}x{height}", "-r", str(fps), "-i", "-"]
        if audio:
            cmd += ["-i", str(audio), "-c:a", "aac", "-b:a", "160k", "-shortest"]
        cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", str(crf), "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", str(self.path)]
        self.size = (width, height)
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    def write(self, frame) -> None:
        if isinstance(frame, Image.Image):
            if frame.size != self.size:
                frame = frame.resize(self.size)
            frame = np.asarray(frame.convert("RGB"))
        self.proc.stdin.write(np.ascontiguousarray(frame, dtype=np.uint8).tobytes())

    def close(self) -> None:
        self.proc.stdin.close()
        if self.proc.wait() != 0:
            raise RuntimeError(f"ffmpeg 写 {self.path} 失败")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def audio_duration(path: str | Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                          "default=nw=1:nk=1", str(path)], check=True, capture_output=True, text=True).stdout
    return float(out.strip())


def save_json(obj, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)

    def conv(o):
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, (np.floating, np.integer)):
            return o.item()
        raise TypeError(type(o))

    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=conv), encoding="utf-8")


def load_json(path: str | Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))
