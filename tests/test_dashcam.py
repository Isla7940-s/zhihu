"""虚线测速 / 前车测距的几何在合成数据上能还原真值。"""
import numpy as np

from crashlab import dashcam as dc


def synth_dash_tracks(v=18.0, P=12.0, dash=3.0, C=640.0, yh=360.0, fps=30.0, T=3.0):
    """地面虚线经透视投影后的上下边沿行坐标随时间变化。"""
    obs = []
    t = np.arange(0, T, 1 / fps)
    starts = np.arange(5.0, 200.0, P)  # 每段虚线近端到相机的初始距离
    for ti in t:
        best = None
        for s0 in starts:
            near = s0 - v * ti
            far = near + dash
            if near < 2.8 or far > 60:
                continue
            bottom = yh + C / near
            top = yh + C / far
            if top < 430 or bottom > 590:
                continue
            best = (top, bottom)
            break
        if best:
            obs.append(dc.DashObs(ti, best[0], best[1], 600.0))
    return obs


def test_dash_period_gives_speed():
    obs = synth_dash_tracks()
    tracks = dc.link_dashes(obs)
    assert len(tracks) >= 3
    cross = [dc.crossing_time(tr, 460, "top") for tr in tracks]
    cross = [c for c in cross if c is not None]
    T = np.median(np.diff(cross))
    assert abs(12.0 / T - 18.0) < 0.6


def test_stopping_distance_monotonic():
    assert dc.stopping_distance(20, 1.0, 0.5) > dc.stopping_distance(15, 1.0, 0.5)
    assert abs(dc.stopping_distance(10, 0.0, 0.5) - 10 ** 2 / (2 * 0.5 * 9.81)) < 1e-9


def test_koschmieder_recovers_visibility():
    sigma = 3.912 / 150.0
    Z = np.linspace(5, 40, 30)
    L = 200 + (80 - 200) * np.exp(-sigma * Z)
    V, s = dc.koschmieder_visibility(Z, L, 200)
    assert abs(V - 150) < 1


def test_summarize():
    s = dc.summarize(np.arange(101))
    assert s["median"] == 50 and s["p05"] == 5 and s["p95"] == 95
