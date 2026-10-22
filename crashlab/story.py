"""分镜脚本：占位符取值、数字读法。

脚本里的数字一律写成 {占位符}，由 analysis.json 填充 —— 改了分析参数，旁白和字幕自动跟着变，
不会出现“画面说 67、配音说 70”这种事故。
"""
from __future__ import annotations

import copy
import re

from .case import Case
from .io import load_json, save_json


def story_vars(analysis: dict) -> dict[str, str]:
    hyps = {h["id"]: h for h in analysis["hypotheses"]}
    p = hyps[analysis["primary"]]
    alt = next(h for h in analysis["hypotheses"] if h["id"] != analysis["primary"])
    lead = p["lead"]
    t = lead["t"]
    i14 = min(range(len(t)), key=lambda k: abs(t[k] - 1.4))
    segs = p["speed_segments"]
    periods = [s["period_s"] for s in segs[:3]]
    fr = analysis["forensics"]
    unique_per_s = round(60 / max(1.0, _typical_hold(fr["hold_length_histogram"])))
    return {
        "fps_real": str(unique_per_s),
        "period": f"{sum(periods) / len(periods):.2f}",
        "duty_pct": f"{round(analysis['dashes']['duty_measured'] * 100)}%",
        "ego": f"{p['ego_speed_kmh']['median']:.0f}",
        "ego_lo": f"{p['ego_speed_kmh']['p05']:.0f}",
        "ego_hi": f"{p['ego_speed_kmh']['p95']:.0f}",
        "ego_alt": f"{alt['ego_speed_kmh']['median']:.0f}",
        "ego_late": f"{segs[-1]['kmh']['median']:.0f}",
        "gap": f"{lead['distance_m']['median'][i14]:.1f}",
        "gap_lo": f"{lead['distance_m']['p05'][i14]:.1f}",
        "gap_hi": f"{lead['distance_m']['p95'][i14]:.1f}",
        "closing": f"{lead['closing_speed_kmh']['median'][i14]:.0f}",
        "lead_kmh": f"{lead['lead_speed_kmh']['median'][i14]:.0f}",
        "ttc": f"{lead['ttc_s']['median'][i14]:.1f}",
        "headway": f"{lead['headway_at_1p5s']['median']:.2f}",
        "headway_lo": f"{lead['headway_at_1p5s']['p05']:.2f}",
        "headway_hi": f"{lead['headway_at_1p5s']['p95']:.2f}",
        "stop": f"{p['stopping_distance_m']['median']:.0f}",
        "rec_gap": f"{p['recommended_gap_m']['median']:.0f}",
        "vis": f"{p['visibility_m']['median']:.0f}",
    }


def _typical_hold(hist: dict) -> float:
    items = sorted(((int(k), v) for k, v in hist.items()), key=lambda kv: -kv[1])
    return float(items[0][0]) if items else 1.0


def fill(text: str, v: dict[str, str]) -> str:
    def rep(m):
        k = m.group(1)
        if k not in v:
            raise KeyError(f"脚本占位符 {{{k}}} 没有对应的数据")
        return v[k]
    return re.sub(r"\{(\w+)\}", rep, text)


def resolve_story(story: dict, v: dict[str, str]) -> dict:
    """递归替换脚本里所有字符串的占位符。"""
    def walk(o):
        if isinstance(o, str):
            return fill(o, v)
        if isinstance(o, list):
            return [walk(x) for x in o]
        if isinstance(o, dict):
            return {k: walk(x) for k, x in o.items()}
        return o
    return walk(copy.deepcopy(story))


# ---------------- 数字 → 中文读法（给 TTS） ----------------
_D = "零一二三四五六七八九"


def _int_cn(n: int) -> str:
    if n == 0:
        return "零"
    if n >= 10000:
        hi, lo = divmod(n, 10000)
        return _int_cn(hi) + "万" + ("零" if 0 < lo < 1000 else "") + (_int_cn(lo) if lo else "")
    out, units, zero = "", ["千", "百", "十", ""], False
    for i, base in enumerate((1000, 100, 10, 1)):
        d = n // base % 10
        if d:
            if zero:
                out += "零"
                zero = False
            out += _D[d] + units[i]
        elif out:
            zero = True
    if out.startswith("一十"):
        out = out[1:]
    return out


def speak_numbers(text: str) -> str:
    text = text.replace("km/h", "公里每小时")
    text = re.sub(r"(\d+(?:\.\d+)?)%", r"百分之\1", text)

    def rep(m):
        s = m.group(0)
        if "." in s:
            a, b = s.split(".")
            return _int_cn(int(a)) + "点" + "".join(_D[int(c)] for c in b)
        return _int_cn(int(s))
    return re.sub(r"\d+(?:\.\d+)?", rep, text)


def build_resolved(case: Case) -> dict:
    analysis = load_json(case.out / "analysis.json")
    story = load_json(case.path("story.json"))
    v = story_vars(analysis)
    resolved = resolve_story(story, v)
    resolved["vars"] = v
    save_json(resolved, case.out / "story.resolved.json")
    return resolved
