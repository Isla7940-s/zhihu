"""PRD 4.4 概率构成。

    P = P基线 + 长期状态修正 + 行动修正 − 困境debuff        clamp 到 [5, 95]

平衡红线：行动修正的总量必须大于状态修正加困境 debuff 的合力，但不足以
单独翻盘。下面的上下限就是这条红线的实现——行动最多 ±36，状态最多 ±15，
困境最多 −25，合力 40 > 36 意味着烂局翻不了身，而 36 > 15 + 20（典型
困境权重）意味着努力永远有意义。
"""

from __future__ import annotations

from ..models import GameState

STATE_MODIFIER_CAP = 15
ACTION_MODIFIER_MIN = -5
ACTION_MODIFIER_MAX = 12
P_FLOOR = 5
P_CEIL = 95


def state_modifier(state: GameState) -> int:
    """四个长期维度相对中位线的平均偏移，映射到 ±15。"""
    dims = state.long_term
    average = (dims.wealth + dims.health + dims.spirit + dims.reputation) / 4
    return int(round((average - 50) / 50 * STATE_MODIFIER_CAP))


def dilemma_debuff(state: GameState) -> int:
    """PRD 4.7：按解决度线性给，未解决时吃满困境权重。"""
    dilemma = state.current.dilemma
    if dilemma is None:
        return 0
    unresolved = 1 - max(0, min(100, dilemma.resolution)) / 100
    return -int(round(dilemma.weight * unresolved))


def clamp_action_modifier(value: int) -> int:
    return max(ACTION_MODIFIER_MIN, min(ACTION_MODIFIER_MAX, int(value)))


def compute_p(state: GameState) -> int:
    goal = state.current.goal
    if goal is None:
        return P_FLOOR
    raw = (
        goal.base_p
        + state_modifier(state)
        + goal.action_modifier
        + dilemma_debuff(state)
    )
    return max(P_FLOOR, min(P_CEIL, int(round(raw))))


def breakdown(state: GameState) -> dict[str, int]:
    goal = state.current.goal
    if goal is None:
        return {}
    return {
        "P基线": goal.base_p,
        "长期状态修正": state_modifier(state),
        "行动修正": goal.action_modifier,
        "困境debuff": dilemma_debuff(state),
        "当前P": compute_p(state),
    }


def hope_label(p: int) -> str:
    """PRD 4.4：概率对玩家可见，但用模糊档位而非数字。"""
    if p >= 70:
        return "很有希望"
    if p >= 50:
        return "有戏"
    if p >= 30:
        return "悬"
    return "基本没戏"
