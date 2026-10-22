"""案例目录约定与配置加载。

cases/<id>/
  case.yaml        案例配置：元信息、证据、人工标注、分析参数
  evidence/        输入证据（视频等，不入库）
  scene.json       3D 重建场景（Studio 编辑 / 流水线生成）
  story.json       解说分镜脚本
  out/             流水线产物：analysis.json、narration/、成片
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass
class Case:
    root: Path
    cfg: dict

    @classmethod
    def load(cls, path: str | Path) -> "Case":
        p = Path(path)
        if p.is_dir():
            p = p / "case.yaml"
        cfg = yaml.safe_load(p.read_text(encoding="utf-8"))
        return cls(p.parent.resolve(), cfg)

    def path(self, rel: str) -> Path:
        return self.root / rel

    @property
    def id(self) -> str:
        return self.cfg["case"]["id"]

    @property
    def out(self) -> Path:
        d = self.root / "out"
        d.mkdir(exist_ok=True)
        return d

    @property
    def meta(self) -> dict:
        return self.cfg["case"]

    @property
    def ann(self) -> dict:
        return self.cfg.get("annotations", {})
