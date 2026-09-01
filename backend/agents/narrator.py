"""叙事 Agent（PRD 4.1 步骤 1 与步骤 5 的兑现）。

承上：把跨过去的那些年翻译成事件卡，而不是一段散文——呈现层是卡片。
结算：兑现四档语义。四档只决定"你得到了多少"，代价恒定必付。
"""

from __future__ import annotations

from ..engine.settlement import SettlementResult
from ..models import GameState, MotifCard, NarrationOutput, SettlementOutput, Tier
from . import context
from .llm import call_structured

_CARRY_SYSTEM = f"""{context.SHARED_STYLE}

你负责"承上"：玩家刚刚跨过了若干年，你要把这几年浓缩成 2 到 4 张事件卡。

事件卡不是小说段落，是玩家瞥一眼就能知道"这几年我过成了什么样"的短卡片。
每张卡：标题不超过 12 字，摘要 30 到 60 字，必须有具体的物、动作或数字。

{context.JSON_ONLY}
输出结构：
{{
  "事件卡": [
    {{"标题": "字符串", "摘要": "字符串", "图标": "从 house/work/family/health/money/travel/heart/clock/spark 中选一个"}}
  ],
  "摘要": "一句话概括这几年，20 到 40 字，将作为后续回合的记忆"
}}"""

_SETTLEMENT_SYSTEM = f"""{context.SHARED_STYLE}

你负责结算叙事。这里有一条铁律：

**四档只决定玩家"得到了多少"，代价是恒定必付的。**
- 大成功：拿到了目标，代价是他预料之中的那个
- 成功：拿到了目标，代价如期而至
- 勉强：拿到了目标，但代价比他以为的更重
- 失败：没拿到目标，代价照付

所以即便是大成功，你也**必须**写出他失去了什么。禁止写出"一切都很圆满"这类叙述。
"代价"字段要写成一个具体的场景或事实，不是抽象的评论。

{context.JSON_ONLY}
输出结构：
{{
  "事件卡": [
    {{"标题": "字符串（不超过12字）", "摘要": "字符串（30-60字）", "图标": "house/work/family/health/money/travel/heart/clock/spark 之一"}}
  ],
  "代价": "一句话，写出这一回合他实际失去的东西，必须具体（30-60字）",
  "摘要": "一句话概括本回合结果，20-40字，将作为后续回合的记忆"
}}"""


async def carry_over(state: GameState, motif: MotifCard, span: int) -> NarrationOutput:
    if state.meta.turn <= 1:
        prompt = (
            f"{context.fact_sheet(state, motif)}\n\n"
            f"玩家刚刚做完开局选择，正式开始这段人生。请写 2 到 3 张事件卡，"
            f"交代他此刻的处境：他在哪、靠什么过活、身边有谁、心里在盘算什么。"
            f"不要写未来，只写此刻。"
        )
    else:
        prompt = (
            f"{context.fact_sheet(state, motif)}\n\n"
            f"玩家刚刚跨过了 {span} 年，现在 {state.meta.age} 岁。"
            f"请写 2 到 4 张事件卡，交代这 {span} 年里发生了什么，"
            f"以及他现在过成了什么样。必须与上面的不可变事实、flags、关系网络完全一致。"
        )
    return await call_structured(
        schema=NarrationOutput,
        system=_CARRY_SYSTEM,
        user=prompt,
        temperature=0.9,
        label="叙事Agent-承上",
    )


async def narrate_settlement(
    state: GameState, motif: MotifCard, result: SettlementResult
) -> SettlementOutput:
    goal = state.current.goal
    dilemma = state.current.dilemma
    assert goal is not None

    tier_hint = {
        Tier.GREAT: "他不但拿到了目标，还超出了预期。但预料之中的那份代价照样发生了。",
        Tier.SUCCESS: "他拿到了目标，代价如期而至，不多不少。",
        Tier.BARELY: "他拿到了目标，但代价比他以为的重得多，而且困境还压在那里没解开。",
        Tier.FAIL: "他没能拿到目标。代价照付，而且困境固化下来，变成了往后一直带着的东西。",
    }[result.tier]

    dilemma_line = (
        f"本回合困境「{dilemma.name}」最终解决度 {dilemma.resolution}/100。"
        if dilemma
        else "本回合没有困境。"
    )
    actions = "；".join(record.text for record in state.current.actions) or "他这一回合什么都没做"

    prompt = (
        f"{context.fact_sheet(state, motif)}\n\n"
        f"=== 本回合结算 ===\n"
        f"目标：{goal.text}\n"
        f"他明知的代价：{goal.explicit_cost}\n"
        f"他这一回合做过的事：{actions}\n"
        f"{dilemma_line}\n"
        f"结算档位：{result.tier.value}。{tier_hint}\n\n"
        f"请写 2 到 3 张事件卡呈现结果，并写出这一回合他实际失去的东西。"
    )
    return await call_structured(
        schema=SettlementOutput,
        system=_SETTLEMENT_SYSTEM,
        user=prompt,
        temperature=0.9,
        label="叙事Agent-结算",
    )
