"""七回合六步状态机（PRD 4.1）。

PRD 5.2：编排层用代码，不用 Agent。回合流程是完全确定的六步，用状态机
驱动，比让 orchestrator agent 决定"下一步该干什么"可靠得多也便宜得多。

    1. 承上        叙事 Agent + 关系网络 Agent
    2. 生成困境    困境 Agent          ← 必须在决策之前
    3. 决策        决策 Agent + 玩家
    4. 行动        玩家 + 行动裁定 Agent
    5. 结算        纯代码
    6. 时间推进    纯代码
"""

from __future__ import annotations

import random
import uuid

from ..agents import adjudicator, decision, dilemma_agent, life_card, narrator
from ..agents import relationship as relationship_agent
from ..content_loader import get_motif
from ..models import (
    ActionPoints,
    ActionRecord,
    CurrentTurn,
    EventCard,
    GameState,
    Meta,
    MotifCard,
    Phase,
    Relationship,
    TreeNode,
    TurnGoal,
)
from . import probability, settlement, timeline


class GameError(RuntimeError):
    pass


def _motif(state: GameState) -> MotifCard:
    motif = get_motif(state.meta.motif_id)
    if motif is None:
        raise GameError(f"母题卡不存在：{state.meta.motif_id}")
    return motif


# --------------------------------------------------------------------------
# 第 0 步：入口（PRD 4.0）
# --------------------------------------------------------------------------


def create_session(motif_id: str, stance_id: str, identity_id: str) -> GameState:
    motif = get_motif(motif_id)
    if motif is None:
        raise GameError(f"母题卡不存在：{motif_id}")

    stance = next((item for item in motif.stances if item.stance_id == stance_id), None)
    identity = next(
        (item for item in motif.identities if item.identity_id == identity_id), None
    )
    if stance is None or identity is None:
        raise GameError("立场或身份不存在")

    state = GameState(
        session_id=uuid.uuid4().hex[:12],
        phase=Phase.CARRY_OVER,
        meta=Meta(
            motif_id=motif.motif_id,
            motif_title=motif.title,
            stance=stance.stance_id,
            stance_text=stance.text,
            identity=identity.identity_id,
            identity_text=identity.text,
            age=motif.start_age,
            turn=0,
            total_turns=motif.total_turns,
            life_end=motif.life_end,
            era=motif.era,
        ),
        action_points=ActionPoints(),
    )

    state.long_term.replace(identity.initial_long_term)
    state.flags = list(dict.fromkeys(stance.initial_flags + identity.initial_flags))
    state.relationships = [
        Relationship.model_validate(item.model_dump(by_alias=True))
        for item in identity.initial_relationships
    ]
    state.immutable_facts.append(
        f"{motif.start_age} 岁毕业时，他选择了「{stance.text}」，身份是「{identity.text}」。"
    )
    return state


# --------------------------------------------------------------------------
# 第 1、2、3 步：开一个新回合
# --------------------------------------------------------------------------


async def begin_turn(state: GameState, rng: random.Random | None = None) -> GameState:
    """承上 → 关系漂移 → 生成困境 → 出决策选项。"""
    if state.phase is Phase.ENDED:
        raise GameError("这一生已经结束了")

    motif = _motif(state)
    state.meta.turn += 1
    span = state.current.goal.span if state.current.goal else 0

    state.current = CurrentTurn()
    state.action_points.start_turn()
    # 上一幕的牌先归档再清空，否则往期就只剩一行决策文案了。
    if state.tree:
        state.tree[-1].event_cards = list(state.event_cards)
    state.event_cards = []

    # 步骤 1：承上
    narration = await narrator.carry_over(state, motif, span)
    state.event_cards.extend(narration.event_cards)
    if narration.summary:
        state.recent_summaries.append(f"{state.meta.age} 岁：{narration.summary}")

    # 步骤 1（续）：关系网络在跨越的这些年里自己漂移
    if state.meta.turn > 1 and span > 0:
        result = await relationship_agent.evolve(state, motif, span)
        for change in result.relationship_changes:
            state.event_cards.append(
                EventCard(
                    title=f"{change.name} {_delta_label(change.closeness_delta)}",
                    summary=change.new_attitude or "关系在这些年里悄悄变了",
                    icon="family",
                    kind="relationship",
                )
            )
        for person in result.new_relationships:
            state.event_cards.append(
                EventCard(
                    title=f"{person.name}进入了你的生活",
                    summary=person.attitude,
                    icon="heart",
                    kind="relationship",
                )
            )
    relationship_agent.ensure_from_flags(state)

    # 步骤 2：生成困境（必须在决策之前）
    state.phase = Phase.DILEMMA
    if state.carried_dilemma is not None:
        # 上回合结算落在"勉强"，困境原封不动压过来
        state.current.dilemma = state.carried_dilemma
        state.carried_dilemma = None
    else:
        state.current.dilemma = await dilemma_agent.generate(state, motif, rng)

    # 步骤 3：出决策选项
    state.current.pending_options = await decision.generate(state, motif)
    state.phase = Phase.DECISION
    return state


def _delta_label(delta: int) -> str:
    if delta > 6:
        return "更近了"
    if delta > 0:
        return "略近"
    if delta == 0:
        return "没什么变化"
    if delta > -8:
        return "淡了些"
    return "远了"


# --------------------------------------------------------------------------
# 第 3 步：玩家选定决策
# --------------------------------------------------------------------------


async def choose_decision(state: GameState, index: int) -> GameState:
    if state.phase is not Phase.DECISION:
        raise GameError("现在不是做决策的阶段")
    options = state.current.pending_options
    if not 0 <= index < len(options):
        raise GameError("决策选项不存在")

    motif = _motif(state)
    chosen = options[index]
    unchosen = [option.text for option in options if option is not chosen]

    state.current.goal = TurnGoal(
        text=chosen.text,
        base_p=chosen.base_p,
        current_p=chosen.base_p,
        span=chosen.span,
        explicit_cost=chosen.explicit_cost,
        cost_delta=chosen.cost_delta,
        action_modifier=0,
    )
    for flag in chosen.new_flags:
        if flag and flag not in state.flags:
            state.flags.append(flag)
    relationship_agent.ensure_from_flags(state)

    # 事件树：决策定分支，未选分支留作终局"你放弃的那些路"
    state.tree.append(
        TreeNode(
            turn=state.meta.turn,
            age=state.meta.age,
            chosen=chosen.text,
            unchosen=unchosen,
            goal_text=chosen.text,
            dilemma_name=state.current.dilemma.name if state.current.dilemma else "",
        )
    )
    state.current.pending_options = []
    state.current.goal.current_p = probability.compute_p(state)

    state.current.suggested_actions = await adjudicator.suggest_actions(state, motif)
    state.phase = Phase.ACTION
    return state


# --------------------------------------------------------------------------
# 第 4 步：行动
# --------------------------------------------------------------------------


async def take_action(state: GameState, action_text: str) -> GameState:
    if state.phase is not Phase.ACTION:
        raise GameError("现在不是行动阶段")
    if state.action_points.available_this_turn <= 0:
        raise GameError("行动点已经用完了")
    if not action_text.strip():
        raise GameError("行动内容不能为空")

    motif = _motif(state)
    output = await adjudicator.adjudicate(state, motif, action_text.strip())

    state.action_points.spend(1)
    state.current.points_spent += 1

    state.instant.apply(output.instant_delta)
    goal = state.current.goal
    assert goal is not None
    goal.action_modifier += output.goal_modifier

    dilemma = state.current.dilemma
    if dilemma is not None:
        dilemma.resolution = max(0, min(100, dilemma.resolution + output.dilemma_progress))

    for change in output.relationship_changes:
        target = state.relationship(change.name)
        if target is None or not target.alive:
            continue
        target.closeness = max(0, min(100, target.closeness + change.closeness_delta))
        if change.new_attitude:
            target.attitude = change.new_attitude

    for flag in output.new_flags:
        if flag and flag not in state.flags:
            state.flags.append(flag)
    relationship_agent.ensure_from_flags(state)

    state.current.actions.append(
        ActionRecord(
            text=action_text.strip(),
            narration=output.event_cards[0].summary if output.event_cards else "",
            goal_modifier=output.goal_modifier,
            dilemma_progress=output.dilemma_progress,
        )
    )
    state.event_cards.extend(output.event_cards)
    for change in output.relationship_changes:
        state.event_cards.append(
            EventCard(
                title=f"{change.name} {_delta_label(change.closeness_delta)}",
                summary=change.new_attitude,
                icon="family",
                kind="relationship",
            )
        )

    goal.current_p = probability.compute_p(state)
    if state.action_points.available_this_turn <= 0:
        state.phase = Phase.SETTLEMENT
    return state


async def refresh_suggestions(state: GameState) -> GameState:
    if state.phase is Phase.ACTION:
        state.current.suggested_actions = await adjudicator.suggest_actions(
            state, _motif(state)
        )
    return state


# --------------------------------------------------------------------------
# 第 5、6 步：结算与时间推进
# --------------------------------------------------------------------------


async def settle_turn(state: GameState, rng: random.Random | None = None) -> dict:
    if state.phase not in (Phase.ACTION, Phase.SETTLEMENT):
        raise GameError("现在不是结算阶段")
    goal = state.current.goal
    if goal is None:
        raise GameError("本回合还没有目标")

    motif = _motif(state)
    state.action_points.forfeit_floor()

    result = settlement.settle(state, rng)
    narration = await narrator.narrate_settlement(state, motif, result)

    state.event_cards.extend(narration.event_cards)
    state.event_cards.append(
        EventCard(
            title=f"代价 · {result.tier.value}",
            summary=narration.cost_line,
            icon="clock",
            kind="cost",
        )
    )

    dilemma = state.current.dilemma
    node = state.tree[-1]
    node.tier = result.tier
    node.cost = narration.cost_line
    node.roll = result.roll
    node.final_p = result.final_p
    node.dilemma_resolution = dilemma.resolution if dilemma else 0

    state.immutable_facts.append(
        f"{state.meta.age} 岁（第 {state.meta.turn} 回合）：{goal.text} → {result.tier.value}。"
        f"代价：{narration.cost_line}"
    )
    if narration.summary:
        state.recent_summaries.append(f"{state.meta.age} 岁结算：{narration.summary}")

    # 勉强：困境原封不动带进下回合
    if result.dilemma_carried and dilemma is not None:
        state.carried_dilemma = dilemma.model_copy(deep=True)

    # 第 6 步：时间推进
    previous_age = state.meta.age
    state.meta.age = timeline.advance(
        state.meta.age, goal.span, state.meta.turn, state.meta.total_turns, state.meta.life_end
    )
    state.instant.reset()

    payload = {
        "档位": result.tier.value,
        "骰值": result.roll,
        "结算概率": result.final_p,
        "目标达成": result.goal_achieved,
        "概率构成": result.breakdown,
        "长期状态变化": result.long_term_delta,
        "代价": result.cost_applied,
        "伤疤": result.scar_applied,
        "代价文案": narration.cost_line,
        "困境带入下回合": result.dilemma_carried,
        "年龄": {"从": previous_age, "到": state.meta.age},
    }

    if state.meta.turn >= state.meta.total_turns:
        state.phase = Phase.ENDED
        state.life_card = await life_card.generate(state, motif)
    else:
        state.phase = Phase.CARRY_OVER

    return payload


def submit_regret(state: GameState, answer: str) -> GameState:
    """PRD 7.2：轻量、自愿、可跳过。"""
    if state.life_card is None:
        raise GameError("人生卡片还没有生成")
    state.life_card.regret_answer = answer.strip()
    return state
