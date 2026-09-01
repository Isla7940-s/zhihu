"""PRD 4.5 时间推进。

时间跨度由决策 Agent 提议，但必须由代码约束区间，否则模型会在第三回合
就把玩家推到 70 岁。最后一回合强制推进到人生终点收尾。
"""

from __future__ import annotations

MIN_SPAN = 3
MAX_SPAN = 15


def allowed_span(age: int, turn: int, total_turns: int, life_end: int) -> tuple[int, int]:
    """返回本回合允许的时间跨度区间 [下限, 上限]。

    上限要给后面每个回合都留出至少 MIN_SPAN 年，否则人生会在中途用光。
    """
    remaining_years = life_end - age
    remaining_turns = total_turns - turn + 1

    if remaining_turns <= 1:
        span = max(MIN_SPAN, remaining_years)
        return span, span

    reserved = MIN_SPAN * (remaining_turns - 1)
    upper = min(MAX_SPAN, remaining_years - reserved)
    upper = max(MIN_SPAN, upper)
    return MIN_SPAN, upper


def clamp_span(span: int, age: int, turn: int, total_turns: int, life_end: int) -> int:
    low, high = allowed_span(age, turn, total_turns, life_end)
    return max(low, min(high, int(span)))


def suggested_span(age: int, turn: int, total_turns: int, life_end: int) -> int:
    """把剩余年数均摊到剩余回合，作为给模型的锚点。"""
    low, high = allowed_span(age, turn, total_turns, life_end)
    remaining_turns = max(1, total_turns - turn + 1)
    even = round((life_end - age) / remaining_turns)
    return max(low, min(high, int(even)))


def advance(age: int, span: int, turn: int, total_turns: int, life_end: int) -> int:
    """推进年龄。末回合直接收到人生终点。"""
    if turn >= total_turns:
        return life_end
    return min(life_end, age + span)


def life_stage(age: int) -> str:
    if age < 26:
        return "刚毕业"
    if age < 33:
        return "立足"
    if age < 42:
        return "成家"
    if age < 52:
        return "中年"
    if age < 62:
        return "转折"
    if age < 70:
        return "退休"
    return "暮年"
