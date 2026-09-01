"""决策 Agent（PRD 4.1 步骤 3）。

决策就是本回合的目标。它决定世界线走哪条分支、以及这一跳跨多少年。

每个选项必须带上 P基线、时间跨度、会种下的 flags、明示代价和结构化的代价
delta——否则代码拿到"辞职创业"四个字，不知道基础成功率该给多少。

`明示代价` 是核心理念的落地点：在玩家做选择的那一刻就把代价说出来，
不藏到结算之后。
"""

from __future__ import annotations

from ..engine import timeline
from ..models import DecisionOption, DecisionOutput, GameState, MotifCard
from . import context
from .llm import call_structured

_SYSTEM = f"""{context.SHARED_STYLE}

你是决策 Agent。你要给玩家出 3 个人生决策选项。决策即本回合的目标，
它决定世界线走哪条分支，一旦选定不可回头。

出题铁律：
1. 三个选项必须构成实质取舍，**任何一个都不能是白捡的最优解**。
2. 至少有一个选项是"看起来更聪明，但代价要很多年后才显形"。
3. 至少有一个选项是"当下更暖，但会关掉一扇门"。
4. 选项文案必须是具体的生活场景，不是抽象的价值判断。
   反例：「追求事业发展」。正例：「接下总部那个要常驻外地两年的项目」。
5. 决策必须与本回合的困境有关系——可以是正面缓解，也可以是争夺同一份精力，
   但不能完全无关。困境和目标不是纯粹的对立，解决困境有可能反过来帮到目标。

各字段的填写规则：
- P基线：这个目标本身的难度，25 到 60 之间。越激进的选项基线越低。
- 时间跨度：这个决策会影响多少年，必须落在给定的允许区间内。
- 明示代价：一句话，写清楚选了它要付出什么，必须具体（25-45 字）。
- 代价delta：结构化的代价，**无论结算成败都会扣**。从 财富/健康/心力/声望 中
  选 1 到 2 项，每项填 3 到 12 的正整数（代码会按扣减处理）。这一项不能为空。
- 新增flags：这个决策会种下的事实标记，例如 已婚/有子女/背债/创业/离异/有房。
  只在决策确实会造成该事实时才填，没有就给空数组。

{context.JSON_ONLY}
输出结构：
{{
  "选项": [
    {{
      "文案": "字符串，20-40 字的具体场景",
      "P基线": 整数 25-60,
      "时间跨度": 整数,
      "新增flags": ["可为空"],
      "明示代价": "字符串 25-45 字",
      "代价delta": {{"心力": 6}}
    }}
  ]
}}
必须恰好 3 个选项。"""


async def generate(state: GameState, motif: MotifCard) -> list[DecisionOption]:
    meta = state.meta
    low, high = timeline.allowed_span(meta.age, meta.turn, meta.total_turns, meta.life_end)
    anchor = timeline.suggested_span(meta.age, meta.turn, meta.total_turns, meta.life_end)
    is_last = meta.turn >= meta.total_turns

    prompt = (
        f"{context.fact_sheet(state, motif)}\n\n"
        f"=== 素材：这个议题下的真实讨论 ===\n{context.source_material(state, limit=3)}\n\n"
        f"=== 母题的出题约束（必须遵守）===\n{motif.question_constraint}\n\n"
        f"=== 本回合的硬性参数 ===\n"
        f"时间跨度必须落在 [{low}, {high}] 年之间，建议在 {anchor} 年附近。\n"
        f"玩家今年 {meta.age} 岁，这是第 {meta.turn}/{meta.total_turns} 回合"
        f"（{'最后一个回合，这次决策将决定他晚年的样子' if is_last else timeline.life_stage(meta.age)}）。\n"
        f"他这一回合可投入的行动点最多 {state.action_points.available_this_turn} 点"
        f"（一辈子总共 {state.action_points.total_budget} 点，已用 {state.action_points.used} 点）。\n\n"
        f"请给出 3 个决策选项。"
    )

    output = await call_structured(
        schema=DecisionOutput,
        system=_SYSTEM,
        user=prompt,
        strong=True,
        temperature=0.8,
        max_tokens=2600,
        label="决策Agent",
    )

    options: list[DecisionOption] = []
    for option in output.options[:3]:
        option.base_p = max(20, min(65, option.base_p))
        option.span = timeline.clamp_span(
            option.span, meta.age, meta.turn, meta.total_turns, meta.life_end
        )
        option.cost_delta = _sanitize_cost(option.cost_delta)
        options.append(option)

    if not options:
        raise RuntimeError("决策 Agent 没有产出任何选项")
    return options


_COST_KEYS = {"财富", "健康", "心力", "声望"}


def _sanitize_cost(raw: dict[str, int]) -> dict[str, int]:
    """代价必须存在且落在合理量级——这是"代价恒定必付"的兜底。"""
    cleaned = {
        key: max(3, min(12, abs(int(value))))
        for key, value in (raw or {}).items()
        if key in _COST_KEYS and isinstance(value, (int, float))
    }
    if not cleaned:
        cleaned = {"心力": 5}
    return dict(list(cleaned.items())[:2])
