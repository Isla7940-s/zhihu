"""困境 Agent（PRD 4.1 步骤 2）。

代码先按触发条件从困境卡库里选出一张卡，Agent 负责把这张通用的卡
**具体化**到玩家此刻的处境里——换成他的城市、他的家人、他的数字。

困境必须在决策之前生成：玩家带着一个已知的麻烦去做人生决策，决策才有张力。
"""

from __future__ import annotations

import random

from ..engine import dilemma_select
from ..models import DilemmaOutput, GameState, MotifCard, TurnDilemma
from . import context
from .llm import call_structured

_SYSTEM = f"""{context.SHARED_STYLE}

你是困境 Agent。你会拿到一张通用的困境卡，任务是把它**具体化**到这名玩家
此刻的处境里：换成他真实的年龄、家人的名字、他所在的城市、他账户里的数字。

具体化的标准（这是最重要的一条）：
不要停在抽象论点上，要往下沉一层，模拟一个具体到能闻到味道的场景。

反例：「你意识到没有孩子将来会孤独。」
正例：「你约老朋友出来喝一杯，他说不行，得去接孩子放学。上一个说不行的人，理由是孩子发烧。」

困境不能是纯粹的坏事降临，它必须和玩家已经得到的东西有关——
他得到了想要的，才会遇到这个困境。

场景写 80 到 140 字。解决路径提示给 4 条，每条 12 字以内，必须是真正不同的路，
而且**每条路都有代价**，不能有一条是白捡的最优解。

{context.JSON_ONLY}
输出结构：
{{
  "困境ID": "原样返回给你的困境ID",
  "困境名": "字符串，不超过 14 字，可以在原名基础上改写得更贴合",
  "具体场景": "字符串，80-140 字",
  "解决路径提示": ["", "", "", ""],
  "困境权重": 整数，在给定权重的基础上可上下浮动 3 以内
}}"""


async def generate(
    state: GameState, motif: MotifCard, rng: random.Random | None = None
) -> TurnDilemma:
    card = dilemma_select.pick(state, motif, rng)

    prompt = (
        f"{context.fact_sheet(state, motif)}\n\n"
        f"=== 素材：这个议题下的真实讨论 ===\n{context.source_material(state, limit=2)}\n\n"
        f"=== 待具体化的困境卡 ===\n"
        f"困境ID：{card.dilemma_id}\n"
        f"困境名：{card.name}\n"
        f"通用场景：{card.scene}\n"
        f"参考解决路径：{'；'.join(card.resolution_hints)}\n"
        f"基准权重：{card.weight}\n\n"
        f"请把它具体化到这名 {state.meta.age} 岁玩家此刻的处境里。"
        f"必须与不可变事实、flags、关系网络完全一致——"
        f"不要让已经离世的人出现，不要让未婚的人有配偶。"
    )

    output = await call_structured(
        schema=DilemmaOutput,
        system=_SYSTEM,
        user=prompt,
        strong=True,
        temperature=0.95,
        label="困境Agent",
    )

    weight = max(10, min(30, output.weight or card.weight))
    state.used_dilemmas.append(card.dilemma_id)

    return TurnDilemma(
        dilemma_id=card.dilemma_id,
        name=output.name or card.name,
        scene=output.scene or card.scene,
        hints=output.hints or card.resolution_hints,
        weight=weight,
        resolution=0,
    )
