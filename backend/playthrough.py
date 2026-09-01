"""命令行完整通关，用于端到端验证六个 Agent 与七回合流程。

    python -m backend.playthrough                # 自动选择，跑完一生
    python -m backend.playthrough --seed 7       # 固定骰子，便于复现
    python -m backend.playthrough --spend 2      # 每回合额外花掉几点自由行动点
"""

from __future__ import annotations

import argparse
import asyncio
import random

from .agents.llm import aclose
from .config import AGENT_RUNTIME
from .content_loader import load_motifs
from .engine import machine, probability
from .models import GameState, Phase
from .opencode_runtime import shutdown

BAR = "─" * 72


def _hr(title: str) -> None:
    print(f"\n{BAR}\n{title}\n{BAR}")


def _status(state: GameState) -> None:
    long_term = state.long_term
    points = state.action_points
    print(
        f"  {state.meta.age} 岁 | 财富 {long_term.wealth} 健康 {long_term.health} "
        f"心力 {long_term.spirit} 声望 {long_term.reputation} | "
        f"行动点 已用 {points.used}/{points.total_budget}"
    )
    print(f"  flags: {state.flags}")
    people = "，".join(
        f"{item.name}{item.closeness}{'(已故)' if not item.alive else ''}"
        for item in state.relationships
    )
    print(f"  关系: {people}")


def _cards(state: GameState, since: int) -> None:
    for card in state.event_cards[since:]:
        print(f"  [{card.icon}] {card.title} — {card.summary}")


async def run(seed: int | None, extra_spend: int) -> GameState:
    rng = random.Random(seed)
    motif = list(load_motifs().values())[0]

    _hr(f"母题：{motif.title}")
    print(f"  {motif.era}")

    stance = motif.stances[0]
    identity = motif.identities[0]
    print(f"\n  立场：{stance.text}")
    print(f"  身份：{identity.text}")

    state = machine.create_session(motif.motif_id, stance.stance_id, identity.identity_id)
    _status(state)

    while state.phase is not Phase.ENDED:
        seen = 0
        await machine.begin_turn(state, rng)

        _hr(f"第 {state.meta.turn} / {state.meta.total_turns} 回合 · {state.meta.age} 岁")
        _cards(state, seen)
        _status(state)

        dilemma = state.current.dilemma
        assert dilemma is not None, "困境必须在决策之前生成"
        print(f"\n  ⚠ 困境：{dilemma.name}（权重 {dilemma.weight}）")
        print(f"    {dilemma.scene}")
        print(f"    可能的路：{' / '.join(dilemma.hints)}")

        print("\n  决策选项：")
        for index, option in enumerate(state.current.pending_options):
            print(f"    {index + 1}. {option.text}")
            print(
                f"       P基线 {option.base_p} · 跨度 {option.span} 年 · "
                f"flags {option.new_flags} · 代价 {option.cost_delta}"
            )
            print(f"       明示代价：{option.explicit_cost}")

        choice = rng.randrange(len(state.current.pending_options))
        await machine.choose_decision(state, choice)
        goal = state.current.goal
        assert goal is not None
        print(f"\n  → 选定：{goal.text}")
        print(f"    达成希望：{probability.hope_label(goal.current_p)}｜{probability.breakdown(state)}")

        budget = min(
            state.action_points.available_this_turn,
            state.action_points.turn_floor + max(0, extra_spend),
        )
        for step in range(budget):
            suggestions = state.current.suggested_actions
            action = (
                suggestions[step % len(suggestions)]
                if suggestions
                else "什么都没做，只是熬着"
            )
            seen = len(state.event_cards)
            await machine.take_action(state, action)
            record = state.current.actions[-1]
            print(f"\n  ▸ 行动 {step + 1}：{action}")
            print(
                f"    概率修正 {record.goal_modifier:+d}｜困境推进 +{record.dilemma_progress}"
                f"｜困境解决度 {state.current.dilemma.resolution}"
            )
            _cards(state, seen)
            await machine.refresh_suggestions(state)

        seen = len(state.event_cards)
        result = await machine.settle_turn(state, rng)
        print(f"\n  ⚖ 结算：{result['档位']}（P={result['结算概率']} 摇出 {result['骰值']}）")
        print(f"    概率构成：{result['概率构成']}")
        print(f"    长期变化 {result['长期状态变化']}｜代价 {result['代价']}｜伤疤 {result['伤疤']}")
        print(f"    代价：{result['代价文案']}")
        if result["困境带入下回合"]:
            print("    困境未解，原封不动带进下一回合")
        _cards(state, seen)
        print(f"    年龄 {result['年龄']['从']} → {result['年龄']['到']}")
        _status(state)

    card = state.life_card
    assert card is not None, "终局必须生成人生卡片"
    _hr(f"终局 · {card.title}")
    print(f"  {card.epitaph}\n")
    print(f"  结局评价：{card.dimension_scores}\n")
    print("  重大决策：")
    for item in card.major_decisions:
        print(f"    - {item}")
    print("\n  成就：")
    for item in card.achievements:
        print(f"    - {item}")
    print("\n  你放弃的那些路：")
    for item in card.abandoned_paths:
        print(f"    - {item}")
    print("\n  结局旁白（滚动字幕 + 旁白朗读）：")
    for line in card.closing_narration:
        print(f"    {line}")
    print("\n  这一生最后悔的事（可跳过）：")
    for option in card.regret_options:
        print(f"    [{option.key}] {option.text}")

    return state


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--spend", type=int, default=1, help="每回合额外投入的自由行动点")
    args = parser.parse_args()
    try:
        state = await run(args.seed, args.spend)
    finally:
        await aclose()
        shutdown()

    _hr("验收")
    print(f"  Agent 运行时：{AGENT_RUNTIME}")
    print(f"  回合数：{state.meta.turn} / {state.meta.total_turns}")
    print(f"  终年：{state.meta.age} 岁（人生终点 {state.meta.life_end}）")
    print(f"  事件树节点：{len(state.tree)}")
    print(f"  行动点：已用 {state.action_points.used} / {state.action_points.total_budget}")
    print(f"  不可变事实：{len(state.immutable_facts)} 条")
    print(f"  阶段：{state.phase.value}")


if __name__ == "__main__":
    asyncio.run(main())
