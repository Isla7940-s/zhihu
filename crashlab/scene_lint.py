"""scene.json 体检：在道路坐标里检查车辆包络是否互相穿插（碰撞时刻之外不应重叠）。

用线性插值近似前端的 Hermite 插值，只做预警，不替代肉眼复核。
"""
from __future__ import annotations

import numpy as np

# 与 apps/studio/src/assets3d/registry.ts 的 dims 保持一致（长、宽）
ASSET_DIMS = {
    "sedan": (4.6, 1.8), "van": (4.9, 1.85), "box-truck": (6.0, 2.2),
    "dump-truck": (9.8, 2.5), "flat-nose-truck": (9.6, 2.5),
}


def _pose(keys: list[dict], t: float) -> tuple[float, float, float]:
    ts = [k["t"] for k in keys]
    if t <= ts[0]:
        k = keys[0]
        return k["s"], k.get("d", 0.0), k.get("yaw", 0.0)
    if t >= ts[-1]:
        k = keys[-1]
        return k["s"], k.get("d", 0.0), k.get("yaw", 0.0)
    i = int(np.searchsorted(ts, t)) - 1
    a, b = keys[i], keys[i + 1]
    u = (t - a["t"]) / (b["t"] - a["t"])
    lerp = lambda f, d=0.0: a.get(f, d) + (b.get(f, d) - a.get(f, d)) * u  # noqa: E731
    return lerp("s"), lerp("d"), lerp("yaw")


def _corners(s, d, yaw, L, W):
    c, sn = np.cos(np.radians(yaw)), np.sin(np.radians(yaw))
    pts = np.array([[L / 2, W / 2], [L / 2, -W / 2], [-L / 2, -W / 2], [-L / 2, W / 2]])
    R = np.array([[c, -sn], [sn, c]])
    return pts @ R.T + np.array([s, d])


def _sat_overlap(A, B) -> bool:
    for P in (A, B):
        for i in range(4):
            e = P[(i + 1) % 4] - P[i]
            n = np.array([-e[1], e[0]])
            pa, pb = A @ n, B @ n
            if pa.max() < pb.min() or pb.max() < pa.min():
                return False
    return True


def lint_scene(scene: dict, impact_times: list[float], window: float = 0.6, step: float = 0.1) -> list[str]:
    actors = [a for a in scene["actors"] if a["asset"] in ASSET_DIMS]
    found: dict[tuple[str, str], list[float]] = {}
    for t in np.arange(0, scene["duration"] + 1e-9, step):
        if any(abs(t - ti) <= window for ti in impact_times):
            continue
        boxes = []
        for a in actors:
            L, W = ASSET_DIMS[a["asset"]]
            L = a.get("params", {}).get("length", L)
            s, d, yaw = _pose(a["keys"], float(t))
            boxes.append((a["id"], _corners(s, d, yaw, L, W)))
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                if _sat_overlap(boxes[i][1], boxes[j][1]):
                    found.setdefault((boxes[i][0], boxes[j][0]), []).append(round(float(t), 2))
    return [f"{a} 与 {b} 在 {ts[0]}–{ts[-1]} s 包络重叠（非碰撞时刻）" for (a, b), ts in found.items()]
