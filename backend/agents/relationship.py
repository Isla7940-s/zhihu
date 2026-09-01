"""关系网络 Agent（PRD 4.1 步骤 1，与叙事 Agent 一同承上）。

分工：行动裁定 Agent 给的是单次行动的即时关系变化；这个 Agent 处理的是
时间跳跃期间、那些年里关系自己发生的漂移——人会老、会走、会疏远，
也会有新的人进来。

姚智超一开始就想专门搞一个处理这些状态的 Agent，这就是它。
"""

from __future__ import annotations

from ..models import GameState, MotifCard, Relationship, RelationshipOutput
from . import context
from .llm import call_structured

_SYSTEM = f"""{context.SHARED_STYLE}

你是关系网络 Agent。玩家刚刚跨过了若干年，你要判定这些年里他身边的人
发生了什么变化。

判定原则：
1. 关系会自然漂移。长期不见面的人会变淡，一起扛过事的人会变紧。
   不需要有戏剧性事件，日子本身就会改变亲密度。
2. 人会衰老、生病、离开。父母的年龄大致比玩家大 26 到 30 岁，
   跨度很大时要如实反映衰老，必要时让人离世——但只在 flags 允许的情况下。
3. 新角色要合理引入：结婚会有配偶，生育会有子女，工作会有同事和朋友。
   **只有在 flags 里确实出现了对应事实时**，才引入相应的新角色。
4. 已经离世的人不能再有任何变化，也不能重新出现。
5. 态度要写成一句具体的话，不是形容词。
   反例：「关系冷淡」。正例：「过年打电话，聊了四分钟就说要去做饭」。

{context.JSON_ONLY}
输出结构：
{{
  "角色卡变化": [
    {{"角色": "已存在的角色名", "亲密度delta": 整数 -30 到 20, "新态度": "一句具体的话", "离世": false}}
  ],
  "新增角色": [
    {{"角色": "名字", "关系类型": "配偶/子女/朋友/同事/亲戚 之一", "亲密度": 整数 0-100, "态度": "一句具体的话", "存活": true}}
  ]
}}
没有变化就给空数组。"""


async def evolve(state: GameState, motif: MotifCard, span: int) -> RelationshipOutput:
    prompt = (
        f"{context.fact_sheet(state, motif)}\n\n"
        f"玩家刚刚跨过了 {span} 年，现在 {state.meta.age} 岁。\n"
        f"请判定这 {span} 年里他的关系网络发生了什么变化。\n"
        f"跨度越长，变化应该越明显；但一切都必须与上面的 flags 和不可变事实一致。"
    )
    output = await call_structured(
        schema=RelationshipOutput,
        system=_SYSTEM,
        user=prompt,
        temperature=0.85,
        label="关系网络Agent",
    )
    return _apply(state, output)


def _apply(state: GameState, output: RelationshipOutput) -> RelationshipOutput:
    """PRD 5.3：Agent 提议，代码落库。"""
    alive = {item.name for item in state.relationships if item.alive}
    applied = []

    for change in output.relationship_changes:
        target = state.relationship(change.name)
        if target is None or not target.alive:
            continue
        change.closeness_delta = max(-30, min(20, int(change.closeness_delta)))
        target.closeness = max(0, min(100, target.closeness + change.closeness_delta))
        if change.new_attitude:
            target.attitude = change.new_attitude
        if change.departed:
            target.alive = False
            target.attitude = change.new_attitude or "已经不在了"
            flag = f"{target.name}已故"
            if flag not in state.flags:
                state.flags.append(flag)
            state.immutable_facts.append(
                f"{state.meta.age} 岁时，{target.name}离世。"
            )
        applied.append(change)

    added = []
    for person in output.new_relationships:
        if not person.name or person.name in alive:
            continue
        person.closeness = max(0, min(100, person.closeness))
        person.alive = True
        state.relationships.append(person)
        added.append(person)

    output.relationship_changes = applied
    output.new_relationships = added
    return output


def ensure_from_flags(state: GameState) -> list[Relationship]:
    """flag 与关系网络的兜底对齐。

    决策可能种下"已婚""有子女"这类 flag，但关系 Agent 要到下一次时间跳跃
    才会补人。这里立刻补上占位角色，保证 UI 的星图和后续 prompt 不出现
    "有 flag 却没有人"的矛盾。
    """
    created: list[Relationship] = []
    existing = {item.kind for item in state.relationships}

    if "已婚" in state.flags and "配偶" not in existing:
        spouse = state.relationship("周雨桐")
        if spouse is not None and spouse.alive:
            spouse.kind = "配偶"
        else:
            created.append(
                Relationship(
                    name="配偶", kind="配偶", closeness=70, attitude="刚刚成为一家人", alive=True
                )
            )
    if "有子女" in state.flags and "子女" not in existing:
        created.append(
            Relationship(name="孩子", kind="子女", closeness=75, attitude="还很小，认人", alive=True)
        )

    state.relationships.extend(created)
    return created
