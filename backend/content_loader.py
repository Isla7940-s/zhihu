"""加载内容层：知乎话题、母题卡、困境卡库（PRD 第 2 节）。"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any, Optional

from .config import CONTENT_DIR
from .models import DilemmaCard, MotifCard


def _read(path) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def load_zhihu_topic() -> dict[str, Any]:
    return _read(CONTENT_DIR / "zhihu_topic.json")


@lru_cache(maxsize=1)
def load_motifs() -> dict[str, MotifCard]:
    motifs: dict[str, MotifCard] = {}
    for path in sorted((CONTENT_DIR / "motifs").glob("*.json")):
        card = MotifCard.model_validate(_read(path))
        motifs[card.motif_id] = card
    if not motifs:
        raise RuntimeError("母题卡库为空")
    return motifs


@lru_cache(maxsize=1)
def load_dilemmas() -> dict[str, DilemmaCard]:
    library: dict[str, DilemmaCard] = {}
    for path in sorted((CONTENT_DIR / "dilemmas").glob("*.json")):
        payload = _read(path)
        for raw in payload:
            card = DilemmaCard.model_validate(raw)
            if card.dilemma_id in library:
                raise RuntimeError(f"困境卡 ID 重复：{card.dilemma_id}")
            library[card.dilemma_id] = card
    if not library:
        raise RuntimeError("困境卡库为空")
    return library


def get_motif(motif_id: str) -> Optional[MotifCard]:
    return load_motifs().get(motif_id)


def get_dilemma(dilemma_id: str) -> Optional[DilemmaCard]:
    return load_dilemmas().get(dilemma_id)


def answers_for_stance(stance: str, limit: int = 3) -> list[dict[str, Any]]:
    """按立场取知乎回答作为素材。

    PRD 2.3：素材来源是一个问题下多个高赞回答的聚合，不针对单一答主画像。
    这里同时取同立场和中立/对立的回答，保证正反两面都进入 Agent 的视野。
    """
    answers = load_zhihu_topic()["answers"]
    same = [a for a in answers if a["stance"] == stance]
    other = [a for a in answers if a["stance"] != stance]
    picked = same[: max(1, limit - 1)] + other[: limit - len(same[: max(1, limit - 1)])]
    return picked[:limit] if picked else answers[:limit]
