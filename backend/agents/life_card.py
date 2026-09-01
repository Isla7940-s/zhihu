"""人生卡片 Agent（PRD 第 7 节）。

分工很清楚：能确定性算出来的，代码算；只有真正主观的部分才交给模型。

"你放弃的那些路"直接取自事件树的未选分支——放弃了什么是确定性可知的，
不需要任何归因逻辑。这是砍掉自动归因之后仍然能自动生成的部分。
"""

from __future__ import annotations

from ..models import GameState, LifeCard, MotifCard, RegretOption
from . import context
from .llm import call_structured

_SYSTEM = f"""{context.SHARED_STYLE}

你是人生卡片 Agent。玩家刚刚走完了一生，你要为这一生写一张卡片。

这张卡片会汇流到知乎社区展示，所以它必须**诚实**：既写他得到的，也写他失去的。
禁止把结局写成励志故事，也禁止写成悲剧控诉。这一生就是这一生。

字段要求：
- 标题：6 到 14 字，概括这一生。可以带一点反讽或留白，不要用"辉煌人生"这类词。
- 墓志铭：一句话，30 到 50 字。写他这一生最本质的那个取舍，必须具体。
- 成就：3 到 4 条，每条不超过 20 字。必须从他实际的状态和关系里来，不许凭空编。
- 结局旁白：6 到 9 条，每条 25 到 45 字。这些会像电影字幕一样滚动播放并配音朗读，
  所以要一句一句能独立成立，连起来又是一段完整的回望。
  最后一条要落在这个议题本身上，但不要给结论，把问题还给读者。
- 后悔选项：4 条，每条不超过 18 字。这些是给玩家点选"这一生最后悔的事"用的，
  必须**从他实际走过的路里生成**，是他真的可能后悔的那几件事，不是通用选项。

{context.JSON_ONLY}
输出结构：
{{
  "标题": "",
  "墓志铭": "",
  "重大决策": [],
  "成就": [],
  "放弃的那些路": [],
  "结局评价": {{}},
  "结局旁白": ["", ""],
  "后悔选项": [{{"选项ID": "r1", "文案": ""}}]
}}
"重大决策"、"放弃的那些路"、"结局评价" 三个字段给空数组或空对象即可，代码会自己填。"""


def major_decisions(state: GameState) -> list[str]:
    return [f"{node.age} 岁 · {node.chosen}" for node in state.tree]


def abandoned_paths(state: GameState) -> list[str]:
    """从事件树的未选分支直接取——确定性可知，无需归因。"""
    paths: list[str] = []
    for node in state.tree:
        for branch in node.unchosen:
            paths.append(f"{node.age} 岁那年，你没有选择「{branch}」")
    return paths


def dimension_scores(state: GameState, motif: MotifCard) -> dict[str, int]:
    long_term = state.long_term
    alive = [item for item in state.relationships if item.alive]
    closeness = sum(item.closeness for item in alive) / len(alive) if alive else 0.0
    lost = len([item for item in state.relationships if not item.alive])

    scars = len(
        [flag for flag in state.flags if flag.startswith(("缺席", "未与", "错过", "老无", "亏欠"))]
    )

    values = {
        "世俗成就": (long_term.wealth + long_term.reputation) / 2,
        "亲密关系": max(0.0, closeness - lost * 4),
        "内心安宁": max(0.0, (long_term.spirit + long_term.health) / 2 - scars * 5),
    }
    names = motif.ending_dimensions or list(values)
    return {name: int(round(values.get(name, 50.0))) for name in names}


async def generate(state: GameState, motif: MotifCard) -> LifeCard:
    decisions = major_decisions(state)
    abandoned = abandoned_paths(state)
    scores = dimension_scores(state, motif)

    journey = "\n".join(
        f"- 第 {node.turn} 回合（{node.age} 岁）：选择「{node.chosen}」，"
        f"目标「{node.goal_text}」结算为 {node.tier.value if node.tier else '未结算'}。"
        f"困境「{node.dilemma_name}」解决度 {node.dilemma_resolution}。代价：{node.cost}"
        for node in state.tree
    )
    given_up = "\n".join(f"- {item}" for item in abandoned) or "（他每一次都没得选）"
    people = "\n".join(
        f"- {item.name}（{item.kind}）亲密度 {item.closeness}"
        f"{'，已经不在了' if not item.alive else ''}：{item.attitude}"
        for item in state.relationships
    )

    prompt = (
        f"{context.fact_sheet(state, motif)}\n\n"
        f"=== 这一生走过的路 ===\n{journey}\n\n"
        f"=== 他放弃过的路 ===\n{given_up}\n\n"
        f"=== 最终身边的人 ===\n{people}\n\n"
        f"=== 最终评价（代码算出，仅供你把握语气）===\n{scores}\n\n"
        f"他终年 {state.meta.age} 岁。请为这一生写一张人生卡片。"
    )

    card = await call_structured(
        schema=LifeCard,
        system=_SYSTEM,
        user=prompt,
        strong=True,
        temperature=0.95,
        max_tokens=4000,
        label="人生卡片Agent",
    )

    card.major_decisions = decisions
    card.abandoned_paths = abandoned
    card.dimension_scores = scores
    if not card.regret_options:
        card.regret_options = _fallback_regrets(state)
    for index, option in enumerate(card.regret_options):
        option.key = option.key or f"r{index + 1}"
    card.regret_options.append(RegretOption(key="none", text="没什么好后悔的"))
    return card


def _fallback_regrets(state: GameState) -> list[RegretOption]:
    options: list[RegretOption] = []
    for index, node in enumerate(state.tree[:4]):
        if node.unchosen:
            options.append(
                RegretOption(
                    key=f"r{index + 1}", text=f"{node.age} 岁没有选择{node.unchosen[0]}"
                )
            )
    return options
