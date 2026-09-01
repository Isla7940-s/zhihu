"""PRD 第 2、3、5.4 节的 schema。

内部字段用英文，序列化别名用中文：对外的 JSON、内容卡文件、以及喂给
模型的上下文都保持 PRD 里的中文契约，Python 侧则保持可读。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class Card(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    def wire(self) -> dict[str, Any]:
        """按 PRD 的中文契约导出。"""
        return self.model_dump(by_alias=True)


# --------------------------------------------------------------------------
# 结算档位（PRD 4.3）
# --------------------------------------------------------------------------


class Tier(str, Enum):
    GREAT = "大成功"
    SUCCESS = "成功"
    BARELY = "勉强"
    FAIL = "失败"


#: 4.8 正向增益的档位缩放系数。负向代价不缩放。
TIER_GAIN_SCALE: dict[Tier, float] = {
    Tier.GREAT: 1.5,
    Tier.SUCCESS: 1.0,
    Tier.BARELY: 0.5,
    Tier.FAIL: 0.2,
}


# --------------------------------------------------------------------------
# 状态（PRD 第 3 节）
# --------------------------------------------------------------------------


class LongTermState(Card):
    wealth: int = Field(50, alias="财富")
    health: int = Field(50, alias="健康")
    spirit: int = Field(50, alias="心力")
    reputation: int = Field(50, alias="声望")

    def apply(self, delta: dict[str, float]) -> None:
        for key, amount in delta.items():
            field = LONG_TERM_ALIAS.get(key, key)
            if hasattr(self, field):
                setattr(self, field, _clamp(getattr(self, field) + amount, 0, 100))

    def replace(self, values: dict[str, float]) -> None:
        """按绝对值设定（用于开局的身份初始状态，不是增量）。"""
        for key, amount in values.items():
            field = LONG_TERM_ALIAS.get(key, key)
            if hasattr(self, field):
                setattr(self, field, _clamp(amount, 0, 100))


class InstantState(Card):
    energy: int = Field(60, alias="精力")
    mood: int = Field(50, alias="情绪")
    cashflow: int = Field(0, alias="现金流")

    def apply(self, delta: dict[str, float]) -> None:
        for key, amount in delta.items():
            field = INSTANT_ALIAS.get(key, key)
            if hasattr(self, field):
                lo, hi = (-100, 100) if field == "cashflow" else (0, 100)
                setattr(self, field, _clamp(getattr(self, field) + amount, lo, hi))

    def reset(self) -> None:
        self.energy, self.mood, self.cashflow = 60, 50, 0


LONG_TERM_ALIAS = {"财富": "wealth", "健康": "health", "心力": "spirit", "声望": "reputation"}
INSTANT_ALIAS = {"精力": "energy", "情绪": "mood", "现金流": "cashflow"}


def _clamp(value: float, low: float, high: float) -> int:
    return int(round(max(low, min(high, value))))


class Relationship(Card):
    name: str = Field(alias="角色")
    kind: str = Field(alias="关系类型")
    closeness: int = Field(50, alias="亲密度")
    attitude: str = Field("", alias="态度")
    alive: bool = Field(True, alias="存活")


class ActionPoints(Card):
    """PRD 4.6：每回合保底 1 点 + 自由池 7 点，一辈子共 14 点。"""

    total_budget: int = Field(14, alias="总预算")
    used: int = Field(0, alias="已用")
    turn_floor: int = Field(1, alias="本回合保底")
    free_pool_left: int = Field(7, alias="自由池剩余")
    floor_left_this_turn: int = Field(1, alias="本回合保底剩余")

    @property
    def available_this_turn(self) -> int:
        return self.floor_left_this_turn + self.free_pool_left

    def start_turn(self) -> None:
        self.floor_left_this_turn = self.turn_floor

    def spend(self, count: int = 1) -> None:
        for _ in range(count):
            if self.floor_left_this_turn > 0:
                self.floor_left_this_turn -= 1
            elif self.free_pool_left > 0:
                self.free_pool_left -= 1
            else:
                raise ValueError("行动点已耗尽")
            self.used += 1

    def forfeit_floor(self) -> None:
        """未用完的保底点不结转，回合结束即作废。"""
        self.floor_left_this_turn = 0


class TurnGoal(Card):
    text: str = Field(alias="文案")
    base_p: int = Field(alias="P基线")
    current_p: int = Field(alias="当前P")
    span: int = Field(alias="时间跨度")
    explicit_cost: str = Field("", alias="明示代价")
    cost_delta: dict[str, int] = Field(default_factory=dict, alias="代价delta")
    action_modifier: int = Field(0, alias="行动累计修正")


class TurnDilemma(Card):
    dilemma_id: str = Field(alias="困境ID")
    name: str = Field(alias="困境名")
    scene: str = Field(alias="具体场景")
    hints: list[str] = Field(default_factory=list, alias="解决路径提示")
    weight: int = Field(20, alias="困境权重")
    resolution: int = Field(0, alias="解决度")


class ActionRecord(Card):
    text: str = Field(alias="行动")
    narration: str = Field("", alias="叙述")
    goal_modifier: int = Field(0, alias="目标概率修正")
    dilemma_progress: int = Field(0, alias="困境解决度推进")


class CurrentTurn(Card):
    goal: Optional[TurnGoal] = Field(None, alias="目标")
    dilemma: Optional[TurnDilemma] = Field(None, alias="困境")
    points_spent: int = Field(0, alias="本回合已投入行动点")
    actions: list[ActionRecord] = Field(default_factory=list, alias="已执行行动")
    pending_options: list["DecisionOption"] = Field(
        default_factory=list, alias="待选决策"
    )
    suggested_actions: list[str] = Field(default_factory=list, alias="建议行动")


class TreeNode(Card):
    """事件树的一节。未选分支是 UI 里的虚线，也是终局"你放弃的那些路"的来源。"""

    turn: int = Field(alias="回合")
    age: int = Field(alias="年龄")
    chosen: str = Field(alias="已选决策")
    unchosen: list[str] = Field(default_factory=list, alias="未选分支")
    tier: Optional[Tier] = Field(None, alias="结算档位")
    cost: str = Field("", alias="代价")
    goal_text: str = Field("", alias="目标")
    dilemma_name: str = Field("", alias="困境")
    dilemma_resolution: int = Field(0, alias="困境解决度")
    roll: Optional[int] = Field(None, alias="骰值")
    final_p: Optional[int] = Field(None, alias="结算概率")
    #: 这一幕产生的事件卡。state.event_cards 每回合会被清空，归档到这里
    #: 之后 UI 才能把往期做成可以翻回去看的牌堆。
    event_cards: list["EventCard"] = Field(default_factory=list, alias="事件卡")


class Meta(Card):
    motif_id: str = Field(alias="母题ID")
    motif_title: str = Field("", alias="母题名")
    stance: str = Field("", alias="立场")
    stance_text: str = Field("", alias="立场文案")
    identity: str = Field("", alias="身份")
    identity_text: str = Field("", alias="身份文案")
    age: int = Field(22, alias="当前年龄")
    turn: int = Field(0, alias="回合")
    total_turns: int = Field(7, alias="总回合")
    life_end: int = Field(75, alias="人生终点")
    era: str = Field("", alias="时代背景")


class Phase(str, Enum):
    SETUP = "setup"
    CARRY_OVER = "carry_over"
    DILEMMA = "dilemma"
    DECISION = "decision"
    ACTION = "action"
    SETTLEMENT = "settlement"
    ENDED = "ended"


class GameState(Card):
    session_id: str = Field(alias="会话ID")
    phase: Phase = Field(Phase.SETUP, alias="阶段")
    meta: Meta = Field(alias="meta")
    long_term: LongTermState = Field(default_factory=LongTermState, alias="长期状态")
    instant: InstantState = Field(default_factory=InstantState, alias="即时状态")
    flags: list[str] = Field(default_factory=list, alias="flags")
    relationships: list[Relationship] = Field(default_factory=list, alias="关系网络")
    action_points: ActionPoints = Field(default_factory=ActionPoints, alias="行动点")
    current: CurrentTurn = Field(default_factory=CurrentTurn, alias="本回合")
    tree: list[TreeNode] = Field(default_factory=list, alias="事件树")
    #: 结算落在"勉强"时，困境原封不动带进下回合（PRD 4.3）。
    carried_dilemma: Optional[TurnDilemma] = Field(None, alias="带入的困境")

    # 呈现层与一致性
    event_cards: list["EventCard"] = Field(default_factory=list, alias="事件卡")
    immutable_facts: list[str] = Field(default_factory=list, alias="不可变事实")
    recent_summaries: list[str] = Field(default_factory=list, alias="近期摘要")
    used_dilemmas: list[str] = Field(default_factory=list, alias="已用困境")
    life_card: Optional["LifeCard"] = Field(None, alias="人生卡片")

    def relationship(self, name: str) -> Optional[Relationship]:
        for item in self.relationships:
            if item.name == name:
                return item
        return None


# --------------------------------------------------------------------------
# 内容层（PRD 第 2 节）
# --------------------------------------------------------------------------


class StanceOption(Card):
    stance_id: str = Field(alias="立场ID")
    text: str = Field(alias="文案")
    blurb: str = Field("", alias="注解")
    initial_flags: list[str] = Field(default_factory=list, alias="初始flags")


class IdentityOption(Card):
    identity_id: str = Field(alias="身份ID")
    text: str = Field(alias="文案")
    blurb: str = Field("", alias="注解")
    initial_long_term: dict[str, int] = Field(default_factory=dict, alias="初始长期状态")
    initial_flags: list[str] = Field(default_factory=list, alias="初始flags")
    initial_relationships: list[Relationship] = Field(
        default_factory=list, alias="初始关系"
    )


class MotifCard(Card):
    motif_id: str = Field(alias="母题ID")
    title: str = Field(alias="母题名")
    source_question: str = Field("", alias="来源问题")
    era: str = Field("", alias="时代背景")
    start_age: int = Field(22, alias="入场年龄")
    life_end: int = Field(75, alias="人生终点")
    total_turns: int = Field(7, alias="总回合数")
    stances: list[StanceOption] = Field(default_factory=list, alias="立场选项")
    identities: list[IdentityOption] = Field(default_factory=list, alias="身份设定")
    tag_whitelist: list[str] = Field(default_factory=list, alias="标签白名单")
    question_constraint: str = Field("", alias="出题约束")
    ending_dimensions: list[str] = Field(default_factory=list, alias="结局评价维度")


class DilemmaTrigger(Card):
    age_range: list[int] = Field(default_factory=lambda: [0, 200], alias="年龄区间")
    state_thresholds: dict[str, str] = Field(default_factory=dict, alias="状态阈值")
    required_flags: list[str] = Field(default_factory=list, alias="必需flags")
    excluded_flags: list[str] = Field(default_factory=list, alias="排斥flags")


class DilemmaUnresolved(Card):
    scar: dict[str, int] = Field(default_factory=dict, alias="长期状态伤疤")
    new_flag: str = Field("", alias="新增flag")
    relationship_impact: list[dict[str, Any]] = Field(
        default_factory=list, alias="关系影响"
    )


class DilemmaCard(Card):
    dilemma_id: str = Field(alias="困境ID")
    name: str = Field(alias="困境名")
    trigger: DilemmaTrigger = Field(default_factory=DilemmaTrigger, alias="触发条件")
    required_tags: list[str] = Field(default_factory=list, alias="所需标签")
    scene: str = Field(alias="具体场景")
    resolution_hints: list[str] = Field(default_factory=list, alias="解决路径提示")
    weight: int = Field(20, alias="困境权重")
    unresolved: DilemmaUnresolved = Field(
        default_factory=DilemmaUnresolved, alias="未解决后果"
    )


# --------------------------------------------------------------------------
# Agent 输出契约（PRD 5.4）
# --------------------------------------------------------------------------


class EventCard(Card):
    title: str = Field(alias="标题")
    summary: str = Field(alias="摘要")
    icon: str = Field("spark", alias="图标")
    kind: str = Field("event", alias="类型")


class RelationshipChange(Card):
    name: str = Field(alias="角色")
    closeness_delta: int = Field(0, alias="亲密度delta")
    new_attitude: str = Field("", alias="新态度")
    kind: str = Field("", alias="关系类型")
    departed: bool = Field(False, alias="离世")


class AdjudicationOutput(Card):
    event_cards: list[EventCard] = Field(default_factory=list, alias="事件卡")
    relationship_changes: list[RelationshipChange] = Field(
        default_factory=list, alias="角色卡变化"
    )
    instant_delta: dict[str, int] = Field(default_factory=dict, alias="即时状态delta")
    goal_modifier: int = Field(0, alias="目标概率修正")
    dilemma_progress: int = Field(0, alias="困境解决度推进")
    new_flags: list[str] = Field(default_factory=list, alias="新增flag")


class DecisionOption(Card):
    text: str = Field(alias="文案")
    base_p: int = Field(40, alias="P基线")
    span: int = Field(5, alias="时间跨度")
    new_flags: list[str] = Field(default_factory=list, alias="新增flags")
    explicit_cost: str = Field(alias="明示代价")
    #: 无论结算落到哪一档都会扣掉的代价（PRD 4.3：代价恒定必付）。
    cost_delta: dict[str, int] = Field(default_factory=dict, alias="代价delta")


class DecisionOutput(Card):
    #: 至少一个选项。空选项要在校验层就失败，这样 llm 层能带着错误让模型自纠，
    #: 而不是把一个没有选项的回合塞进状态机。
    options: list[DecisionOption] = Field(min_length=1, alias="选项")


class SuggestionOutput(Card):
    suggestions: list[str] = Field(min_length=1, alias="行动建议")


class DilemmaOutput(Card):
    dilemma_id: str = Field("", alias="困境ID")
    name: str = Field(alias="困境名")
    scene: str = Field(min_length=20, alias="具体场景")
    hints: list[str] = Field(default_factory=list, alias="解决路径提示")
    weight: int = Field(20, alias="困境权重")


class NarrationOutput(Card):
    event_cards: list[EventCard] = Field(min_length=1, alias="事件卡")
    summary: str = Field("", alias="摘要")


class RelationshipOutput(Card):
    relationship_changes: list[RelationshipChange] = Field(
        default_factory=list, alias="角色卡变化"
    )
    new_relationships: list[Relationship] = Field(
        default_factory=list, alias="新增角色"
    )


class SettlementOutput(Card):
    """结算之后由叙事 Agent 兑现四档语义：拿到多少 + 必付的代价。"""

    event_cards: list[EventCard] = Field(min_length=1, alias="事件卡")
    #: 代价必须写出来。空代价意味着"这一档没有失去东西"，与核心理念冲突。
    cost_line: str = Field(min_length=8, alias="代价")
    summary: str = Field("", alias="摘要")


class RegretOption(Card):
    key: str = Field(alias="选项ID")
    text: str = Field(alias="文案")


class LifeCard(Card):
    title: str = Field(min_length=2, alias="标题")
    epitaph: str = Field(min_length=10, alias="墓志铭")
    major_decisions: list[str] = Field(default_factory=list, alias="重大决策")
    achievements: list[str] = Field(default_factory=list, alias="成就")
    abandoned_paths: list[str] = Field(default_factory=list, alias="放弃的那些路")
    dimension_scores: dict[str, int] = Field(default_factory=dict, alias="结局评价")
    closing_narration: list[str] = Field(min_length=3, alias="结局旁白")
    regret_options: list[RegretOption] = Field(default_factory=list, alias="后悔选项")
    regret_answer: str = Field("", alias="玩家填答")


CurrentTurn.model_rebuild()
TreeNode.model_rebuild()
GameState.model_rebuild()
