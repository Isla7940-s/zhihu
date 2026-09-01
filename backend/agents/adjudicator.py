"""行动裁定 Agent（PRD 4.1 步骤 4，5.4 的核心契约）。

这是调用最频繁、契约最关键的一个。输出必须是结构化的卡片数组，
不能是一段散文——因为呈现层是卡片，不是文章。

行动可以指向目标、指向困境，或者两者兼顾。三者之间的分配就是这套机制
真正的张力来源。
"""

from __future__ import annotations

from ..engine import probability
from ..models import AdjudicationOutput, GameState, MotifCard, SuggestionOutput
from . import context
from .llm import call_structured

_SYSTEM = f"""{context.SHARED_STYLE}

你是行动裁定 Agent。玩家花掉了一点宝贵的行动值去做一件事，
你要判定这件事的效果，并把它变成卡片。

判定原则：
1. 行动可以推进目标、化解困境，或者两者兼顾。**兼顾的效果要打折**，
   一件事很难同时把两边都办得漂亮。
2. 行动一定有副作用。推进了目标往往消耗精力或情绪，化解了困境往往花钱或耽误正事。
   但副作用要写进「即时状态delta」和事件卡里，**不要用「目标概率修正」来表达代价**。
   这两个字段问的是两件不同的事：一个问"他付出了什么"，一个问"事情有没有往前走"。
   一件让人心力交瘁但确实推进了目标的事，应该是「概率修正为正、即时状态为负」。
3. 玩家花掉了一点一辈子只有十几点的行动值。只要他做的事方向对、够具体，
   就必须给出正的目标概率修正——这是这套机制的底线：努力永远有意义。
   负值只留给两种情况：行动本身跑偏（去做了与目标无关甚至相悖的事），
   或者脱离现实（例如"我中了彩票""我掏出一把核弹"）。后者要裁定成一次徒劳的
   尝试，并在叙述里写出现实是怎么把他挡回来的。
4. 关系变化只能针对已经存在于关系网络里的角色，或者由这次行动自然引入的新角色。
   已经离世的人不能再有变化。

各字段的填写规则：
- 目标概率修正：-5 到 +12 的整数。真正切中要害的行动给 8 到 12，
  常规努力给 3 到 7，方向不对给 -5 到 0。
- 困境解决度推进：0 到 40 的整数。完全针对困境的行动给 25 到 40，
  顺带缓解给 8 到 20，无关给 0。
- 即时状态delta：从 精力/情绪/现金流 里选，数值 -30 到 +20。
- 事件卡：1 到 2 张。标题不超过 12 字，摘要 30 到 60 字。
- 角色卡变化：0 到 2 条。亲密度delta 在 -25 到 +20 之间，新态度写成一句具体的话。
- 新增flag：只在这次行动确实造成了不可逆的事实时才填，否则给空数组。

{context.JSON_ONLY}
输出结构：
{{
  "事件卡": [{{"标题": "", "摘要": "", "图标": "house/work/family/health/money/travel/heart/clock/spark 之一"}}],
  "角色卡变化": [{{"角色": "必须是已存在的角色名", "亲密度delta": 整数, "新态度": "一句具体的话"}}],
  "即时状态delta": {{"精力": -15, "情绪": 5}},
  "目标概率修正": 整数,
  "困境解决度推进": 整数,
  "新增flag": []
}}"""


async def adjudicate(
    state: GameState, motif: MotifCard, action_text: str
) -> AdjudicationOutput:
    goal = state.current.goal
    dilemma = state.current.dilemma
    assert goal is not None

    done = "；".join(record.text for record in state.current.actions) or "（本回合还没有行动过）"
    points = state.action_points

    prompt = (
        f"{context.fact_sheet(state, motif)}\n\n"
        f"=== 本回合已经做过的事 ===\n{done}\n\n"
        f"=== 行动点消耗情况 ===\n"
        f"这是本回合第 {len(state.current.actions) + 1} 次行动，"
        f"他一辈子还剩 {points.available_this_turn - 1} 点可用"
        f"（总共 {points.total_budget} 点）。行动点越稀缺，每一次行动越应该被认真对待。\n\n"
        f"=== 玩家这次的行动 ===\n{action_text}\n\n"
        f"当前目标达成概率的构成：{probability.breakdown(state)}\n"
        f"（这只是背景信息。当前 P 低说明他处境艰难，不是让你压低这次行动的修正——"
        f"处境越难，一次对路的行动越该被记上一笔。）\n"
        f"请判定这次行动的效果。"
    )

    output = await call_structured(
        schema=AdjudicationOutput,
        system=_SYSTEM,
        user=prompt,
        temperature=0.85,
        label="行动裁定Agent",
    )

    # PRD 5.3：数值由 Agent 提议，由代码裁决
    output.goal_modifier = probability.clamp_action_modifier(output.goal_modifier)
    output.dilemma_progress = max(0, min(40, int(output.dilemma_progress)))
    output.instant_delta = {
        key: max(-30, min(20, int(value)))
        for key, value in (output.instant_delta or {}).items()
        if key in {"精力", "情绪", "现金流"}
    }
    alive = {item.name for item in state.relationships if item.alive}
    output.relationship_changes = [
        change
        for change in output.relationship_changes
        if change.name in alive
    ]
    for change in output.relationship_changes:
        change.closeness_delta = max(-25, min(20, int(change.closeness_delta)))
    return output


_SUGGEST_SYSTEM = f"""{context.SHARED_STYLE}

你要给玩家 3 个行动建议。行动不是决策——决策已经定了，方向不能改；
行动是在这个方向下，他这一步具体做什么。

三个建议要覆盖不同的取向：一个主要推进目标，一个主要化解困境，
一个试图两头兼顾（但玩家应当能看出兼顾意味着两边都不彻底）。
每条 15 到 28 字，必须是具体动作，不是抽象方针。

{context.JSON_ONLY}
输出结构：{{"行动建议": ["第一条", "第二条", "第三条"]}}"""


async def suggest_actions(state: GameState, motif: MotifCard) -> list[str]:
    done = "；".join(record.text for record in state.current.actions) or "（还没有行动过）"
    prompt = (
        f"{context.fact_sheet(state, motif)}\n\n"
        f"本回合已经做过的事：{done}\n\n"
        f"请给出 3 条行动建议。"
    )
    output = await call_structured(
        schema=SuggestionOutput,
        system=_SUGGEST_SYSTEM,
        user=prompt,
        temperature=0.95,
        label="行动建议",
    )
    return [text for text in output.suggestions[:3] if text]
