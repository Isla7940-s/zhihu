"""旁白合成：Piper 离线中文语音（无网络依赖）。

产物：out/narration/<shot>.wav、narration.wav（整条，含镜头间停顿）、timings.json。
镜头时长 = 本句音频 + pad；成片渲染严格按 timings.json 排时间轴。
"""
from __future__ import annotations

import subprocess
import sys
import wave
from pathlib import Path

from .case import Case
from .io import save_json
from .story import build_resolved, speak_numbers

REPO = Path(__file__).resolve().parents[1]
VOICE_DIR = REPO / "assets" / "voices"


def _wav_duration(p: Path) -> float:
    with wave.open(str(p)) as w:
        return w.getnframes() / w.getframerate()


def synthesize_line(text: str, out: Path, voice: str, length_scale: float = 0.86) -> float:
    model = VOICE_DIR / f"{voice}.onnx"
    if not model.exists():
        raise FileNotFoundError(f"缺少语音模型 {model}，先运行 scripts/fetch_voice.sh")
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, "-m", "piper", "-m", str(model), "-f", str(out), "--length-scale", str(length_scale),
                    "--sentence-silence", "0.15"], input=text.encode("utf-8"), check=True, capture_output=True)
    return _wav_duration(out)


def visual_min_duration(visual: dict) -> float:
    """有些画面自身有最短时长（例如按原速播放的证据片段），镜头不能比它短。"""
    if visual.get("type") == "evidence":
        return (visual["to"] - visual["from"]) / visual.get("rate", 1.0) + 0.3
    return 0.0


def synthesize_story(case: Case, pad: float = 0.35) -> dict:
    story = build_resolved(case)
    voice = story.get("voice", "zh_CN-huayan-medium")
    nd = case.out / "narration"
    nd.mkdir(parents=True, exist_ok=True)
    lines, t = [], 0.6  # 开头留一点空
    for shot in story["shots"]:
        wav = nd / f"{shot['id']}.wav"
        dur = synthesize_line(speak_numbers(shot["line"]), wav, voice)
        slot = max(dur + shot.get("pad", pad), visual_min_duration(shot["visual"]))
        lines.append({"id": shot["id"], "start": round(t, 3), "duration": round(dur, 3), "text": shot["line"],
                      "slot": round(slot, 3)})
        print(f"  {shot['id']:<10} {dur:5.2f}s / 镜头 {slot:5.2f}s  {shot['line'][:28]}")
        t += slot
    total = t + 0.8
    # 拼整条旁白：用 ffmpeg adelay 把每句放到它的时间点上
    inputs, filters = [], []
    for i, ln in enumerate(lines):
        inputs += ["-i", str(nd / f"{ln['id']}.wav")]
        ms = int(ln["start"] * 1000)
        filters.append(f"[{i}:a]adelay={ms}|{ms},apad[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(lines)))
    filt = ";".join(filters) + f";{mix}amix=inputs={len(lines)}:normalize=0,atrim=0:{total:.3f},loudnorm=I=-16:TP=-1.5[out]"
    subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", filt, "-map", "[out]", "-ar", "48000",
                    str(nd / "narration.wav")], check=True)
    timings = {"lines": lines, "total": round(total, 3)}
    save_json(timings, nd / "timings.json")
    print(f"旁白总长 {total:.1f}s → {nd / 'narration.wav'}")
    return timings
