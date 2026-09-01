"""困境卡的筛选（PRD 2.2 触发条件 + 4.5 按年龄而非回合号）。

标签白名单是防串味的关键：母题声明它接受哪些标签，困境声明它需要哪些
标签，取交集。否则小镇做题家的人生里会突然弹出家族企业继承权之争。
"""

from __future__ import annotations

import random
import re
from typing import Optional

from ..content_loader import load_dilemmas
from ..models import DilemmaCard, GameState, MotifCard

_THRESHOLD = re.compile(r"^\s*(<=|>=|<|>|==|=)?\s*(-?\d+)\s*$")

_STATE_READERS = {
    "财富": lambda s: s.long_term.wealth,
    "健康": lambda s: s.long_term.health,
    "心力": lambda s: s.long_term.spirit,
    "声望": lambda s: s.long_term.reputation,
    "精力": lambda s: s.instant.energy,
    "情绪": lambda s: s.instant.mood,
    "现金流": lambda s: s.instant.cashflow,
    "年龄": lambda s: s.meta.age,
}


def _threshold_ok(expression: str, value: int) -> bool:
    match = _THRESHOLD.match(str(expression))
    if not match:
        return True
    op, number = match.group(1) or "==", int(match.group(2))
    if op == "<":
        return value < number
    if op == "<=":
        return value <= number
    if op == ">":
        return value > number
    if op == ">=":
        return value >= number
    return value == number


def _tags_ok(card: DilemmaCard, motif: MotifCard) -> bool:
    if not card.required_tags:
        return True
    whitelist = set(motif.tag_whitelist)
    return all(tag in whitelist for tag in card.required_tags)


def _flags_ok(card: DilemmaCard, state: GameState) -> bool:
    flags = set(state.flags)
    if any(flag not in flags for flag in card.trigger.required_flags):
        return False
    if any(flag in flags for flag in card.trigger.excluded_flags):
        return False
    return True


def _age_ok(card: DilemmaCard, state: GameState) -> bool:
    span = card.trigger.age_range
    low, high = (span + [0, 200])[:2] if len(span) < 2 else (span[0], span[1])
    return low <= state.meta.age <= high


def _thresholds_ok(card: DilemmaCard, state: GameState) -> bool:
    for key, expression in card.trigger.state_thresholds.items():
        reader = _STATE_READERS.get(key)
        if reader is None:
            continue
        if not _threshold_ok(expression, reader(state)):
            return False
    return True


def candidates(state: GameState, motif: MotifCard) -> list[DilemmaCard]:
    """按严格程度逐级放宽，保证任何回合都一定能取到一张卡。"""
    library = [
        card
        for card in load_dilemmas().values()
        if card.dilemma_id not in state.used_dilemmas
    ]

    strict = [
        card
        for card in library
        if _tags_ok(card, motif)
        and _flags_ok(card, state)
        and _age_ok(card, state)
        and _thresholds_ok(card, state)
    ]
    if strict:
        return strict

    # 放宽一：忽略数值阈值
    loose = [
        card
        for card in library
        if _tags_ok(card, motif) and _flags_ok(card, state) and _age_ok(card, state)
    ]
    if loose:
        return loose

    # 放宽二：忽略年龄区间，但 flag 硬约束必须守住（否则会出现死者复活）
    looser = [card for card in library if _tags_ok(card, motif) and _flags_ok(card, state)]
    if looser:
        return looser

    # 放宽三：允许重复使用，仍然守住 flag
    return [
        card
        for card in load_dilemmas().values()
        if _tags_ok(card, motif) and _flags_ok(card, state)
    ] or list(load_dilemmas().values())


def pick(
    state: GameState, motif: MotifCard, rng: Optional[random.Random] = None
) -> DilemmaCard:
    rng = rng or random.Random()
    pool = candidates(state, motif)
    # 年龄贴合度优先：区间中点离当前年龄越近越优先
    def distance(card: DilemmaCard) -> float:
        low, high = card.trigger.age_range[0], card.trigger.age_range[1]
        return abs((low + high) / 2 - state.meta.age)

    pool.sort(key=distance)
    head = pool[: max(1, min(4, len(pool)))]
    return rng.choice(head)
