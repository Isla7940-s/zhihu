import numpy as np
import pytest

from crashlab.forensics import analyze_frames
from crashlab.story import fill, speak_numbers
from crashlab.physics import Vehicle, collision_delta_v, simulate_chain


def test_duplicate_frames_detected():
    rng = np.random.default_rng(0)
    src = rng.uniform(0, 255, (30, 40, 40)).astype(np.float32)  # 30 个真实画面
    frames = np.repeat(src, 2, axis=0) + rng.normal(0, 0.3, (60, 40, 40))  # 补成 60 帧
    rep = analyze_frames(frames, 60.0, step=1)
    assert len(rep.unique_idx) == 30
    assert rep.summary()["hold_length_histogram"] == {2: 29}


def test_blackout_detected():
    frames = np.full((90, 20, 20), 120.0)
    frames[60:] = 0
    rep = analyze_frames(frames, 30.0, step=1)
    assert abs(rep.blackout_t - 2.0) < 1e-6


def test_speak_numbers():
    assert speak_numbers("约67公里，0.56秒，18%") == "约六十七公里，零点五六秒，百分之十八"
    assert speak_numbers("10.6米") == "十点六米"


def test_fill_requires_all_placeholders():
    assert fill("车距{gap}米", {"gap": "10.6"}) == "车距10.6米"
    with pytest.raises(KeyError):
        fill("{missing}", {})


def test_momentum_conservation():
    dv_b, dv_t = collision_delta_v(18000, 12.0, 1300, 0.0, e=0.1)
    assert abs(18000 * dv_b + 1300 * dv_t) < 1e-6


def test_chain_sim_sandwich():
    vs = [
        Vehicle("A", "truck", 15000, 12, 2.5, 3.8, (0, 0, 255), 42.0, 0, brake_mu=0.6),
        Vehicle("car", "car", 1250, 4.0, 1.7, 1.5, (255, 0, 0), 25.0, 0, brake_mu=0.7),
        Vehicle("B", "truck", 18000, 12, 2.5, 3.6, (255, 160, 0), -40.0, 12.0),
    ]
    r = simulate_chain(vs, 6.0)
    assert all(c.t_first is not None for c in r.contacts)  # 两次碰撞都发生了
    car = 1
    assert r.front(car)[-1] - r.rear(car)[-1] < 4.0  # 被压缩
