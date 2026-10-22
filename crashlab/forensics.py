"""视频取证：重复帧/真实帧率、黑场（画面中断）检测。

平台转码常把 25/30fps 的原片补成 60fps，补出来的是重复帧。重复帧不携带新信息，
测速时必须剔除，否则会把同一位置算两次、把速度“压扁”。
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class FrameReport:
    container_fps: float
    unique_idx: np.ndarray  # 真实（非重复）帧下标
    unique_t: np.ndarray
    diffs: np.ndarray
    dup_threshold: float
    blackout_t: float | None  # 画面变黑（中断）的时刻

    @property
    def effective_fps(self) -> float:
        if len(self.unique_t) < 2:
            return 0.0
        return (len(self.unique_t) - 1) / (self.unique_t[-1] - self.unique_t[0])

    def summary(self) -> dict:
        runs = np.diff(self.unique_idx)
        hist = {int(k): int(v) for k, v in zip(*np.unique(runs, return_counts=True))}
        return {
            "container_fps": self.container_fps,
            "frames": int(len(self.diffs) + 1),
            "unique_frames": int(len(self.unique_idx)),
            "effective_fps": round(self.effective_fps, 2),
            "hold_length_histogram": hist,  # 每个真实帧被重复显示几次
            "dup_threshold": round(self.dup_threshold, 3),
            "blackout_t": None if self.blackout_t is None else round(self.blackout_t, 3),
            # 一个真实帧在屏上停留的时长（95 分位）的一半 = 单次时刻读数的不确定度
            "timing_uncertainty_s": round(0.5 * float(np.percentile(runs, 95)) / self.container_fps, 4)
            if len(runs) else 0.0,
        }


def frame_diffs(gray: np.ndarray, step: int = 4) -> np.ndarray:
    g = gray[:, ::step, ::step].astype(np.float32)
    return np.abs(np.diff(g, axis=0)).mean(axis=(1, 2))


def analyze_frames(gray: np.ndarray, fps: float, dup_threshold: float | None = None,
                   black_level: float = 12.0, step: int = 4) -> FrameReport:
    """gray: (N,H,W) 灰度帧。重复帧阈值缺省时自动取差值分布的“谷”。"""
    d = frame_diffs(gray, step)
    if dup_threshold is None:
        # 重复帧差值≈编码噪声，真实帧差值高一个量级。运动强度随时间变化，所以用局部参考：
        # 与邻域内“真实帧”的典型差值（滑窗 90 分位）相比，低于其 25% 判为重复。
        half = 15
        pad = np.pad(d, half, mode="edge")
        ref = np.array([np.percentile(pad[i:i + 2 * half + 1], 90) for i in range(len(d))])
        is_new = d > 0.25 * ref
        dup_threshold = float(np.median(0.25 * ref))
    else:
        is_new = d > dup_threshold
    unique = np.r_[0, np.nonzero(is_new)[0] + 1]
    means = gray[:, ::2 * step, ::2 * step].mean(axis=(1, 2))
    dark = np.nonzero(means < black_level)[0]
    blackout = None
    if len(dark):
        # 第一段持续 ≥0.3s 的黑场
        run_start = dark[0]
        for i in range(1, len(dark)):
            if dark[i] != dark[i - 1] + 1:
                run_start = dark[i]
            if (dark[i] - run_start) / fps >= 0.3:
                blackout = run_start / fps
                break
    return FrameReport(fps, unique, unique / fps, d, dup_threshold, blackout)
