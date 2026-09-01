"""PRD 4.3 四档结算 与 4.8 即时转长期的不对称折算。

这里是全篇最容易做错的地方：四档**不是**表现评分，而是"你得到了多少"。
代价是恒定必付的，只随档位改变轻重，不随档位消失。
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from ..models import TIER_GAIN_SCALE, GameState, Tier
from . import probability

BAND = 25  # PRD 4.4：唯一的调参旋钮
CRIT_LOW = 5  # R ≤ 5 无条件大成功
CRIT_HIGH = 96  # R ≥ 96 无条件失败

#: 代价随档位的轻重。任何一档都 > 0——代价不会因为你打得好就消失。
COST_MULTIPLIER: dict[Tier, float] = {
    Tier.GREAT: 1.0,
    Tier.SUCCESS: 1.0,
    Tier.BARELY: 1.5,
    Tier.FAIL: 1.0,
}

#: 即时状态折算进长期状态的换算率（PRD 4.8）。
FOLD_RATE = 0.25
INSTANT_BASELINE = {"energy": 60, "mood": 50, "cashflow": 0}
FOLD_TARGET = {"energy": "健康", "mood": "心力", "cashflow": "财富"}


@dataclass
class SettlementResult:
    tier: Tier
    roll: int
    final_p: int
    goal_achieved: bool
    long_term_delta: dict[str, int] = field(default_factory=dict)
    cost_applied: dict[str, int] = field(default_factory=dict)
    scar_applied: dict[str, int] = field(default_factory=dict)
    dilemma_carried: bool = False
    new_flags: list[str] = field(default_factory=list)
    breakdown: dict[str, int] = field(default_factory=dict)


def judge(p: int, roll: int) -> Tier:
    """PRD 4.4 的判定表，含固定尾巴。"""
    if roll <= CRIT_LOW:
        return Tier.GREAT
    if roll >= CRIT_HIGH:
        return Tier.FAIL
    if roll <= p - BAND:
        return Tier.GREAT
    if roll <= p:
        return Tier.SUCCESS
    if roll <= p + BAND:
        return Tier.BARELY
    return Tier.FAIL


def fold_instant_to_long_term(state: GameState, tier: Tier) -> dict[str, int]:
    """PRD 4.8：正向增益按档位缩放，负向代价全额结算。

    方向必须不对称，否则会出现"失败反而少扣"的荒谬结果。
    """
    scale = TIER_GAIN_SCALE[tier]
    delta: dict[str, int] = {}
    for field_name, baseline in INSTANT_BASELINE.items():
        raw = (getattr(state.instant, field_name) - baseline) * FOLD_RATE
        if raw > 0:
            raw *= scale
        amount = int(round(raw))
        if amount:
            delta[FOLD_TARGET[field_name]] = delta.get(FOLD_TARGET[field_name], 0) + amount
    return delta


def settle(state: GameState, rng: random.Random | None = None) -> SettlementResult:
    rng = rng or random.Random()
    goal = state.current.goal
    assert goal is not None, "结算前必须已有本回合目标"

    final_p = probability.compute_p(state)
    roll = rng.randint(1, 100)
    tier = judge(final_p, roll)
    achieved = tier is not Tier.FAIL

    result = SettlementResult(
        tier=tier,
        roll=roll,
        final_p=final_p,
        goal_achieved=achieved,
        breakdown=probability.breakdown(state),
    )

    # 1. 即时状态折算进长期
    result.long_term_delta = fold_instant_to_long_term(state, tier)

    # 2. 代价恒定必付
    multiplier = COST_MULTIPLIER[tier]
    for key, amount in goal.cost_delta.items():
        # 代价一律是扣减；即便 Agent 给成了正数也按扣减处理
        applied = -int(round(abs(amount) * multiplier))
        result.cost_applied[key] = applied

    # 3. 大成功的额外增益
    if tier is Tier.GREAT:
        result.long_term_delta["声望"] = result.long_term_delta.get("声望", 0) + 5

    # 4. 勉强：困境原封不动带进下回合
    if tier is Tier.BARELY and state.current.dilemma is not None:
        result.dilemma_carried = state.current.dilemma.resolution < 100

    # 5. 失败：困境固化为长期状态上的伤疤
    if tier is Tier.FAIL:
        result.scar_applied, result.new_flags = _apply_scar(state)

    # 落库
    state.long_term.apply(result.long_term_delta)
    state.long_term.apply(result.cost_applied)
    state.long_term.apply(result.scar_applied)
    for flag in result.new_flags:
        if flag and flag not in state.flags:
            state.flags.append(flag)

    return result


def _apply_scar(state: GameState) -> tuple[dict[str, int], list[str]]:
    """失败时，未解决的那部分困境固化下来。伤疤按未解决比例缩放。"""
    from ..content_loader import get_dilemma

    dilemma = state.current.dilemma
    if dilemma is None:
        return {}, []
    card = get_dilemma(dilemma.dilemma_id)
    if card is None:
        return {}, []

    unresolved = 1 - max(0, min(100, dilemma.resolution)) / 100
    if unresolved <= 0:
        return {}, []

    scar = {
        key: -int(round(abs(amount) * unresolved))
        for key, amount in card.unresolved.scar.items()
        if int(round(abs(amount) * unresolved)) > 0
    }
    flags = [card.unresolved.new_flag] if card.unresolved.new_flag and unresolved >= 0.5 else []

    # 关系影响同样按未解决比例生效
    if unresolved >= 0.5:
        for impact in card.unresolved.relationship_impact:
            name = impact.get("角色", "")
            target = state.relationship(name)
            if target is None:
                continue
            if impact.get("离世"):
                target.alive = False
                target.closeness = max(0, target.closeness)
                target.attitude = "已经不在了"
            else:
                delta = int(impact.get("亲密度", 0) * unresolved)
                target.closeness = max(0, min(100, target.closeness + delta))

    return scar, flags
