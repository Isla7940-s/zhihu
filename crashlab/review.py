"""合规审查闸门：在渲染/发布之前拦住“会出事”的内容。

拦截（error）：
  * 结果未知却在脚本里谈伤亡 / 定责
  * 绝对化、定罪式措辞
  * 旁白里写死的数字（必须来自 {占位符}，保证与分析一致）
  * 结尾缺免责声明
提示（warn）：
  * 素材未取得授权 → 只能内部演示，不能公开发布
  * 场景里存在“示意推定”段但画面没有标注
"""
from __future__ import annotations

import re

from .case import Case
from .io import load_json, save_json

BANNED = ["全责", "主责", "必然", "肯定是", "一定是", "真相是", "罪魁祸首", "活该", "该死", "找死", "作死", "惨烈", "惨不忍睹"]
OUTCOME_WORDS = ["死亡", "身亡", "遇难", "丧生", "当场", "重伤", "轻伤", "伤亡人数", "抢救无效"]
DIGIT = re.compile(r"\d")


def review_case(case: Case) -> bool:
    story = load_json(case.path("story.json"))
    errors, warns = [], []
    meta = case.meta
    rights = (meta.get("source") or {}).get("rights", "")
    publishable = bool(rights) and "未取得" not in rights
    if not publishable:
        warns.append(f"素材授权：{rights or '未填写'} → 成片仅限内部演示")
    for shot in story["shots"]:
        line = shot["line"]
        for w in BANNED:
            if w in line:
                errors.append(f"[{shot['id']}] 定罪/绝对化措辞「{w}」")
        if not meta.get("outcome_known", False):
            # “不清楚/未知/不做推测”这类否定式陈述允许出现
            for w in OUTCOME_WORDS:
                if w in line:
                    errors.append(f"[{shot['id']}] 结果未知，旁白不得提及「{w}」")
        stripped = re.sub(r"\{\w+\}", "", line)
        if DIGIT.search(stripped):
            errors.append(f"[{shot['id']}] 旁白里有写死的阿拉伯数字，请改用占位符或中文常量：{line}")
    end = story["shots"][-1]
    if "非官方" not in end["line"] and "不是官方" not in end["line"]:
        errors.append("结尾镜头缺少“非官方结论”声明")
    scene_p = case.path("scene.json")
    if scene_p.exists():
        scene = load_json(scene_p)
        assumed = any(k.get("evidence") == "assumed" for a in scene["actors"] for k in a["keys"])
        noted = any(n.get("evidence") == "assumed" for n in scene.get("notes", []))
        if assumed and not noted:
            warns.append("scene.json 有示意推定的关键帧，但 notes 里没有说明")
    report = {"ok": not errors, "publishable": publishable and not errors, "errors": errors, "warnings": warns}
    save_json(report, case.out / "review.json")
    for e in errors:
        print("✗", e)
    for w in warns:
        print("!", w)
    print("审查通过" if not errors else f"审查未通过：{len(errors)} 处问题")
    return not errors
