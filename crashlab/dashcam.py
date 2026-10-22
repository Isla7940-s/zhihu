"""行车记录仪（运动相机）测量：车道虚线测本车速度、前车宽度测距离/TTC、雾能见度粗估。

核心几何（平直路面、相机光轴近似水平）：
    地面点距离  Z(y) = C / (y - y_h)      C = f·h（焦距×相机高度，单位 px·m）
    横向尺寸    Δx_px = f·W / Z            → 同一行上 W/h = Δx_px / (y - y_h)
所以：
  * 虚线“线段+间隔”的周期 P 是唯一需要的绝对尺度：v = P / T（T 为同一行被相邻两段虚线扫过的时间差）
  * 同一段虚线先后扫过两行 r1、r2 的时间差给出 C
  * 车道宽给出相机高度 h，于是 f = C / h，前车距离 Z = f·W_车 / w_px
每一步的输入不确定度都进蒙特卡洛。
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage as ndi

# ---------------- 虚线检测 ----------------


@dataclass
class DashObs:
    t: float
    top: float
    bottom: float
    x: float


def detect_dashes(gray: np.ndarray, frame_idx: np.ndarray, fps: float, roi: tuple[int, int, int, int],
                  contrast: float = 14.0, min_px: int = 60) -> list[DashObs]:
    """在 ROI(x0,y0,x1,y1) 内找最显著的一段竖长亮条（车道虚线）。"""
    x0, y0, x1, y1 = roi
    out = []
    for fi in frame_idx:
        g = gray[fi].astype(np.float32)
        h = g - ndi.uniform_filter(g, 31)
        m = np.zeros(g.shape, bool)
        m[y0:y1, x0:x1] = h[y0:y1, x0:x1] > contrast
        m = ndi.binary_opening(m, iterations=1)
        lab, n = ndi.label(m)
        best = None
        for idx, sl in enumerate(ndi.find_objects(lab), start=1):
            cnt = int((lab[sl] == idx).sum())
            hgt, wid = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
            if hgt < 6 or cnt < min_px:
                continue
            if hgt < 1.2 * wid and cnt < 200:  # 横向的亮斑（尾灯倒影等）
                continue
            if best is None or cnt > best[0]:
                ys, xs = np.nonzero(lab[sl] == idx)
                best = (cnt, sl[0].start, sl[0].stop, xs.mean() + sl[1].start)
        if best:
            out.append(DashObs(fi / fps, best[1], best[2], best[3]))
    return out


def link_dashes(obs: list[DashObs], jump: float = 15.0, min_len: int = 4) -> list[list[DashObs]]:
    """虚线在画面里只会往下走；顶端突然上跳说明换成了下一段。"""
    tracks: list[list[DashObs]] = []
    for o in obs:
        if tracks and o.top >= tracks[-1][-1].top - jump:
            tracks[-1].append(o)
        else:
            tracks.append([o])
    return [t for t in tracks if len(t) >= min_len]


def crossing_time(track: list[DashObs], row: float, edge: str = "top", clip_bottom: float = 1e9) -> float | None:
    """该段虚线的某条边（top/bottom）向下越过 row 的时刻（线性插值）。"""
    pts = [(o.t, getattr(o, edge)) for o in track if getattr(o, edge) < clip_bottom]
    for (ta, ya), (tb, yb) in zip(pts, pts[1:]):
        if ya < row <= yb and yb > ya:
            return ta + (row - ya) / (yb - ya) * (tb - ta)
    return None


# ---------------- 前车宽度 ----------------


@dataclass
class WidthObs:
    t: float
    left: float
    right: float
    row: int
    body: float  # 车身亮度
    sky: float  # 背景（雾/天空）亮度

    @property
    def width(self) -> float:
        return self.right - self.left


def track_dark_target(gray: np.ndarray, frame_idx: np.ndarray, fps: float, x_start: float,
                      sky_roi: tuple[int, int, int, int], search_rows: tuple[int, int] = (150, 420),
                      below_top: int = 20, darker_by: float = 40.0) -> list[WidthObs]:
    """雾中深色车厢：先沿中心列找车顶，再在车顶下方一行用半高法求左右边沿（亚像素）。"""
    sx0, sy0, sx1, sy1 = sky_roi
    xc = int(x_start)
    out = []
    W = gray.shape[2]
    for fi in frame_idx:
        g = ndi.gaussian_filter(gray[fi].astype(np.float32), 1.0)
        sky = float(np.median(g[sy0:sy1, sx0:sx1]))
        col = g[search_rows[0]:search_rows[1], max(xc - 4, 0):xc + 5].mean(axis=1)
        hit = np.nonzero(col < sky - darker_by)[0]
        if not len(hit):
            break
        row = search_rows[0] + int(hit[0]) + below_top
        prof = g[row - 3:row + 4].mean(axis=0)
        body = float(np.median(prof[max(xc - 10, 0):xc + 10]))
        half = (sky + body) / 2
        xl = xc
        while xl > 0 and prof[xl] < half:
            xl -= 1
        xr = xc
        while xr < W - 1 and prof[xr] < half:
            xr += 1
        if xl <= 0 or xr >= W - 1:
            break  # 目标出画
        fl = xl + (half - prof[xl]) / (prof[xl + 1] - prof[xl] + 1e-9)
        fr = xr - 1 + (half - prof[xr - 1]) / (prof[xr] - prof[xr - 1] + 1e-9)
        out.append(WidthObs(fi / fps, fl, fr, row, body, sky))
        xc = int((fl + fr) / 2)
    return out


def reject_outliers(t: np.ndarray, y: np.ndarray, deg: int = 2, k: float = 3.0) -> np.ndarray:
    """多项式残差的 MAD 剔除，返回保留掩码。"""
    keep = np.ones(len(t), bool)
    for _ in range(3):
        p = np.polyfit(t[keep], y[keep], deg)
        r = y - np.polyval(p, t)
        mad = np.median(np.abs(r[keep] - np.median(r[keep]))) * 1.4826 + 1e-9
        keep = np.abs(r) < k * mad
    return keep


# ---------------- 物理换算 ----------------


def stopping_distance(v: float, reaction_s: float = 1.0, mu: float = 0.5, g: float = 9.81) -> float:
    return v * reaction_s + v * v / (2 * mu * g)


def koschmieder_visibility(Z: np.ndarray, L: np.ndarray, L_sky: float) -> tuple[float, float]:
    """L(Z) = L_sky + (L0 - L_sky)·exp(-σZ) 的对数线性拟合，返回 (能见度 m, σ)。"""
    c = np.log(np.maximum(L_sky - L, 1e-3))
    p = np.polyfit(Z, c, 1)
    sigma = max(-p[0], 1e-6)
    return 3.912 / sigma, sigma


def summarize(samples: np.ndarray, digits: int = 2) -> dict:
    s = np.asarray(samples, float)
    s = s[np.isfinite(s)]
    return {
        "median": round(float(np.median(s)), digits),
        "p05": round(float(np.percentile(s, 5)), digits),
        "p95": round(float(np.percentile(s, 95)), digits),
        "n": int(len(s)),
    }
