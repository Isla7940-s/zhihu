"""PRD 5.5 事实底稿。

Demo 阶段不做 flag 硬校验，事实底稿的构造质量就是唯一防线。两条措施：

1. flags 与关系网络以 JSON 原样注入，不让模型从自然语言里推断"他好像结婚了"。
2. 每回合结算后由代码追加一条不可变事实，永远置顶。

喂给 Agent 的不是历史全文，而是压缩后的状态 + 最近两回合摘要，
因此上下文是恒定大小的，不随回合数增长。
"""

from __future__ import annotations

import json

from ..content_loader import answers_for_stance, load_zhihu_topic
from ..engine import probability, timeline
from ..models import GameState, MotifCard

RECENT_SUMMARY_WINDOW = 2

SHARED_STYLE = """你是一个严肃的人生模拟叙事系统的一部分。这不是一款娱乐游戏，
而是一个挂在知乎问题下的议题表达工具，目的是让玩家看见一件事情好的一面和坏的一面，
最后形成自己的观点。

必须遵守的三条写作原则：
1. 用具体场景代替抽象论点。不要写"没有孩子会孤独"，要写"你约兄弟出来，他说不行，要去接小孩放学"。
2. 不追求精准命中某一个人，追求触动大部分人。写共通的处境，不写猎奇的桥段。
3. 无论玩家怎么选，都会失去一些东西。取舍是双向的：得到了想要的，才会遇到困境。

文字要求：克制、具体、有画面，像好的非虚构写作。禁止煽情的形容词堆砌，
禁止说教，禁止"人生就像一场旅行"这类空话。每句话都要有实物、动作或数字。"""

JSON_ONLY = "只输出一个合法的 JSON 对象。不要 markdown 围栏，不要任何解释文字。"


def _immutable_block(state: GameState) -> str:
    if not state.immutable_facts:
        return "（暂无）"
    return "\n".join(f"- {fact}" for fact in state.immutable_facts)


def _relationship_json(state: GameState) -> str:
    return json.dumps(
        [
            {
                "角色": item.name,
                "关系类型": item.kind,
                "亲密度": item.closeness,
                "态度": item.attitude,
                "存活": item.alive,
            }
            for item in state.relationships
        ],
        ensure_ascii=False,
        indent=2,
    )


def fact_sheet(state: GameState, motif: MotifCard) -> str:
    """所有 Agent 共享的事实底稿。恒定大小。"""
    meta = state.meta
    goal = state.current.goal
    dilemma = state.current.dilemma

    recent = state.recent_summaries[-RECENT_SUMMARY_WINDOW:]
    recent_block = "\n".join(f"- {line}" for line in recent) if recent else "（这是第一个回合）"

    lines = [
        "=== 不可变事实（最高优先级，任何叙述都不得与之冲突）===",
        _immutable_block(state),
        "",
        "=== 当前 flags（结构化事实，不要从别处推断）===",
        json.dumps(state.flags, ensure_ascii=False),
        "",
        "=== 关系网络（结构化事实）===",
        _relationship_json(state),
        "",
        "=== 基本情况 ===",
        f"母题：{motif.title}",
        f"时代背景：{motif.era}",
        f"立场：{meta.stance_text}",
        f"身份：{meta.identity_text}",
        f"当前年龄：{meta.age} 岁（{timeline.life_stage(meta.age)}）",
        f"回合：第 {meta.turn} / {meta.total_turns} 回合",
        "",
        "=== 长期状态（0-100）===",
        json.dumps(state.long_term.wire(), ensure_ascii=False),
        "=== 即时状态 ===",
        json.dumps(state.instant.wire(), ensure_ascii=False),
        "",
        "=== 最近发生的事 ===",
        recent_block,
    ]

    if goal is not None:
        lines += [
            "",
            "=== 本回合目标（玩家的决策）===",
            f"{goal.text}",
            f"明示代价：{goal.explicit_cost}",
            f"达成希望：{probability.hope_label(probability.compute_p(state))}",
        ]
    if dilemma is not None:
        lines += [
            "",
            "=== 本回合困境 ===",
            f"{dilemma.name}：{dilemma.scene}",
            f"解决度：{dilemma.resolution}/100",
        ]

    return "\n".join(lines)


def source_material(state: GameState, limit: int = 3) -> str:
    """PRD 2.3：把知乎问题下多个高赞回答聚合成素材，正反两面都要进视野。"""
    topic = load_zhihu_topic()
    picked = answers_for_stance(state.meta.stance, limit=limit)
    blocks = [f"原问题：{topic['title']}"]
    for answer in picked:
        excerpt = answer["content"]
        if len(excerpt) > 700:
            excerpt = excerpt[:700] + "……"
        blocks.append(
            f"\n【{answer['author']}·{answer['upvotes']} 赞·立场 {answer['stance']}】\n{excerpt}"
        )
    return "\n".join(blocks)
