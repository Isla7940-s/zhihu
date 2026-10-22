"""碰撞物理：同车道多车一维链式碰撞仿真 + 动量/能量闭式估算。

仿真用于两件事：
1. 合成情景（带真值）——给流水线做端到端回归测试和示例视频；
2. 分析阶段的交叉验证——用估出的速度、质量区间反推小车受到的速度变化 Δv。

接触模型：分段刚度的塑性压溃（吸能区 → 乘员舱），卸载斜率很陡，
因此恢复系数低、永久变形大，与实车追尾的定性特征一致。
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

G = 9.81


@dataclass
class Vehicle:
    name: str
    kind: str  # car | truck
    mass: float  # kg
    length: float
    width: float
    height: float
    color: tuple[int, int, int]
    x_front0: float  # 初始车头 x
    v0: float = 0.0  # m/s
    lane_y: float = 0.0
    brake_mu: float = 0.0  # 初始制动附着利用（0=滑行）
    brake_at: float | None = None  # 何时开始制动 (s)
    brake_decel: float = 0.0  # 制动后减速度 m/s²
    # 压溃特性（仅对小车有意义；货车视为刚性 + 防钻撞梁）
    crush_soft_len: float = 0.8  # 吸能区长度 m
    k_soft: float = 6.0e5  # N/m
    k_hard: float = 5.0e6  # N/m，乘员舱
    ground_clearance: float = 0.3

    @property
    def x_center0(self) -> float:
        return self.x_front0 - self.length / 2


@dataclass
class Contact:
    rear_idx: int  # 后车下标（撞人的）
    front_idx: int
    dmax: float = 0.0
    fmax: float = 0.0
    t_first: float | None = None
    v_rel_first: float | None = None


@dataclass
class SimResult:
    t: np.ndarray
    x: np.ndarray  # (T, N) 车辆中心
    v: np.ndarray
    a: np.ndarray
    crush_front: np.ndarray  # (T, N) 车头压缩量
    crush_rear: np.ndarray
    vehicles: list[Vehicle]
    contacts: list[Contact] = field(default_factory=list)

    def at(self, tq: float) -> dict:
        i = int(np.clip(np.searchsorted(self.t, tq), 0, len(self.t) - 1))
        return {
            "x": self.x[i], "v": self.v[i], "a": self.a[i],
            "crush_front": self.crush_front[i], "crush_rear": self.crush_rear[i],
        }

    def front(self, k: int) -> np.ndarray:
        return self.x[:, k] + self.vehicles[k].length / 2 - self.crush_front[:, k]

    def rear(self, k: int) -> np.ndarray:
        return self.x[:, k] - self.vehicles[k].length / 2 + self.crush_rear[:, k]


def _contact_force(c: Contact, delta: float, soft_len: float, k_soft: float, k_hard: float,
                   k_unload: float) -> float:
    if delta > c.dmax:
        c.dmax = delta
        if delta <= soft_len:
            f = k_soft * delta
        else:
            f = k_soft * soft_len + k_hard * (delta - soft_len)
        c.fmax = f
        return f
    return max(0.0, c.fmax - k_unload * (c.dmax - delta))


def simulate_chain(vehicles: list[Vehicle], duration: float, dt: float = 2e-4,
                   record_hz: float = 1000.0, k_unload: float = 4.0e7) -> SimResult:
    """车辆按 x 从后到前排列。只处理相邻两车的纵向接触。"""
    vs = sorted(vehicles, key=lambda v: v.x_front0)
    n = len(vs)
    m = np.array([v.mass for v in vs])
    x = np.array([v.x_center0 for v in vs], float)
    vel = np.array([v.v0 for v in vs], float)
    contacts = [Contact(i, i + 1) for i in range(n - 1)]
    steps = int(round(duration / dt))
    every = max(1, int(round(1 / (record_hz * dt))))
    rec_t, rec_x, rec_v, rec_a, rec_cf, rec_cr = [], [], [], [], [], []
    acc = np.zeros(n)
    for s in range(steps + 1):
        t = s * dt
        F = np.zeros(n)
        cf = np.zeros(n)
        cr = np.zeros(n)
        for c in contacts:
            a, b = vs[c.rear_idx], vs[c.front_idx]
            # 塑性变形全部记在小车一侧（货车刚性）
            soft_car = b if b.kind == "car" else a
            gap_geom = (x[c.front_idx] - b.length / 2) - (x[c.rear_idx] + a.length / 2)
            delta = -gap_geom
            if delta > 0 or c.dmax > 0:
                f = _contact_force(c, max(delta, 0.0), soft_car.crush_soft_len, soft_car.k_soft,
                                   soft_car.k_hard, k_unload) if delta > 0 else 0.0
                if f > 0 and c.t_first is None:
                    c.t_first = t
                    c.v_rel_first = vel[c.rear_idx] - vel[c.front_idx]
                F[c.rear_idx] -= f
                F[c.front_idx] += f
            perm = max(c.dmax - c.fmax / k_unload, 0.0)
            vis = max(delta, perm) if c.dmax > 0 else 0.0
            if b.kind == "car":
                cr[c.front_idx] = vis
            else:
                cf[c.rear_idx] = vis
        for i, v in enumerate(vs):
            if v.brake_at is not None and t >= v.brake_at:
                dec = v.brake_decel
            else:
                dec = v.brake_mu * G
            if abs(vel[i]) > 1e-4 or abs(F[i]) > dec * m[i]:
                fr = -np.sign(vel[i] if abs(vel[i]) > 1e-4 else F[i]) * dec * m[i]
            else:
                fr = -F[i]  # 静摩擦平衡
            acc[i] = (F[i] + fr) / m[i]
        if s % every == 0:
            rec_t.append(t)
            rec_x.append(x.copy())
            rec_v.append(vel.copy())
            rec_a.append(acc.copy())
            rec_cf.append(cf)
            rec_cr.append(cr)
        newv = vel + acc * dt
        # 摩擦不会让车倒着走
        for i, v in enumerate(vs):
            if vel[i] > 0 and newv[i] < 0 and F[i] <= 0:
                newv[i] = 0.0
        vel = newv
        x = x + vel * dt
    return SimResult(np.array(rec_t), np.array(rec_x), np.array(rec_v), np.array(rec_a),
                     np.array(rec_cf), np.array(rec_cr), vs, contacts)


def collision_delta_v(m_bullet: float, v_bullet: float, m_target: float, v_target: float = 0.0,
                      e: float = 0.1) -> tuple[float, float]:
    """一维碰撞：返回 (Δv_bullet, Δv_target)。e 为恢复系数。"""
    vr = v_bullet - v_target
    dv_t = (1 + e) * m_bullet / (m_bullet + m_target) * vr
    dv_b = -(1 + e) * m_target / (m_bullet + m_target) * vr
    return dv_b, dv_t


def absorbed_energy(m1: float, m2: float, v_rel: float, e: float = 0.1) -> float:
    """碰撞耗散能量 J。"""
    mu = m1 * m2 / (m1 + m2)
    return 0.5 * mu * v_rel ** 2 * (1 - e ** 2)
