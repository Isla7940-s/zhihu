"""相机几何：平面单应、针孔相机、单视图标定、像素反投影。

世界坐标约定：x 沿道路前进方向，y 指向左侧，z 竖直向上，单位米。
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares


def _normalize(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Hartley 归一化：平移到质心、平均距离缩放到 sqrt(2)。"""
    c = pts.mean(axis=0)
    d = np.sqrt(((pts - c) ** 2).sum(axis=1)).mean()
    s = np.sqrt(2) / max(d, 1e-12)
    T = np.array([[s, 0, -s * c[0]], [0, s, -s * c[1]], [0, 0, 1]])
    ph = np.c_[pts, np.ones(len(pts))] @ T.T
    return ph, T


def fit_homography(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """归一化 DLT，返回 H 使 dst ~ H @ src（齐次）。至少 4 对点。"""
    src = np.asarray(src, float)
    dst = np.asarray(dst, float)
    if len(src) < 4 or len(src) != len(dst):
        raise ValueError("需要至少 4 对一一对应的点")
    s, Ts = _normalize(src)
    d, Td = _normalize(dst)
    rows = []
    for (x, y, w), (u, v, q) in zip(s, d):
        rows.append([0, 0, 0, -q * x, -q * y, -q * w, v * x, v * y, v * w])
        rows.append([q * x, q * y, q * w, 0, 0, 0, -u * x, -u * y, -u * w])
    _, _, vt = np.linalg.svd(np.asarray(rows))
    Hn = vt[-1].reshape(3, 3)
    H = np.linalg.inv(Td) @ Hn @ Ts
    return H / H[2, 2]


def apply_h(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    pts = np.atleast_2d(np.asarray(pts, float))
    ph = np.c_[pts, np.ones(len(pts))] @ H.T
    return ph[:, :2] / ph[:, 2:3]


def rodrigues(rvec: np.ndarray) -> np.ndarray:
    rvec = np.asarray(rvec, float)
    th = np.linalg.norm(rvec)
    if th < 1e-12:
        return np.eye(3)
    k = rvec / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(th) * K + (1 - np.cos(th)) * K @ K


def rot_to_rvec(R: np.ndarray) -> np.ndarray:
    th = np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))
    if th < 1e-12:
        return np.zeros(3)
    w = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])
    return w / (2 * np.sin(th)) * th


@dataclass
class Camera:
    """针孔相机：x_img ~ K (R X + t)。"""

    f: float
    cx: float
    cy: float
    R: np.ndarray
    t: np.ndarray
    width: int
    height: int

    @property
    def K(self) -> np.ndarray:
        return np.array([[self.f, 0, self.cx], [0, self.f, self.cy], [0, 0, 1.0]])

    @property
    def center(self) -> np.ndarray:
        return -self.R.T @ self.t

    @classmethod
    def look_at(cls, eye, target, fov_deg: float, width: int, height: int, up=(0, 0, 1)) -> "Camera":
        eye = np.asarray(eye, float)
        fwd = np.asarray(target, float) - eye
        fwd /= np.linalg.norm(fwd)
        right = np.cross(fwd, up)
        right /= np.linalg.norm(right)
        down = np.cross(fwd, right)
        R = np.stack([right, down, fwd])  # 行向量：相机 x 右、y 下、z 前
        f = 0.5 * width / np.tan(np.radians(fov_deg) / 2)
        return cls(f, width / 2, height / 2, R, -R @ eye, width, height)

    def to_cam(self, X: np.ndarray) -> np.ndarray:
        return np.atleast_2d(X) @ self.R.T + self.t

    def project(self, X: np.ndarray) -> np.ndarray:
        Xc = self.to_cam(X)
        z = np.maximum(Xc[:, 2:3], 1e-6)
        return np.c_[self.f * Xc[:, 0:1] / z + self.cx, self.f * Xc[:, 1:2] / z + self.cy]

    def ground_homography(self) -> np.ndarray:
        """z=0 平面 (x,y) → 像素 的单应。"""
        H = self.K @ np.c_[self.R[:, 0], self.R[:, 1], self.t]
        return H / H[2, 2]

    def backproject_to_plane(self, uv: np.ndarray, z: float | np.ndarray = 0.0) -> np.ndarray:
        """像素反投影到水平面 z=h，返回世界坐标 (N,3)。"""
        uv = np.atleast_2d(np.asarray(uv, float))
        rays_c = np.c_[(uv[:, 0] - self.cx) / self.f, (uv[:, 1] - self.cy) / self.f, np.ones(len(uv))]
        rays_w = rays_c @ self.R  # R^T * ray
        C = self.center
        lam = (np.asarray(z, float) - C[2]) / rays_w[:, 2]
        return C + lam[:, None] * rays_w

    def with_resolution(self, width: int, height: int) -> "Camera":
        s = width / self.width
        return Camera(self.f * s, self.cx * s, self.cy * s, self.R, self.t, width, height)


@dataclass
class CalibrationResult:
    camera: Camera
    homography: np.ndarray
    rms_px: float
    residuals_px: np.ndarray

    def summary(self) -> dict:
        C = self.camera.center
        return {
            "focal_px": round(float(self.camera.f), 1),
            "camera_xyz_m": [round(float(v), 2) for v in C],
            "camera_height_m": round(float(C[2]), 2),
            "rms_reprojection_px": round(self.rms_px, 2),
            "max_reprojection_px": round(float(np.abs(self.residuals_px).max()), 2),
        }


def calibrate_from_ground(img_pts, world_xy, width: int, height: int) -> CalibrationResult:
    """单视图标定：地面已知点 → 焦距 + 相机位姿。

    假设方像素、主点在画面中心、无畸变。先用单应的正交约束闭式求 f，
    再对 (f, R, t) 做重投影误差最小化。
    """
    img_pts = np.asarray(img_pts, float)
    world_xy = np.asarray(world_xy, float)
    H = fit_homography(world_xy, img_pts)
    cx, cy = width / 2, height / 2
    Hc = np.array([[1, 0, -cx], [0, 1, -cy], [0, 0, 1.0]]) @ H
    h1, h2 = Hc[:, 0], Hc[:, 1]
    cands = []
    den = h1[2] * h2[2]
    if abs(den) > 1e-12:
        cands.append(-(h1[0] * h2[0] + h1[1] * h2[1]) / den)
    den = h2[2] ** 2 - h1[2] ** 2
    if abs(den) > 1e-12:
        cands.append((h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2) / den)
    cands = [c for c in cands if c > 0]
    f0 = float(np.sqrt(np.median(cands))) if cands else float(width)

    Kinv = np.linalg.inv(np.array([[f0, 0, 0], [0, f0, 0], [0, 0, 1.0]]))
    B = Kinv @ Hc
    lam = 2.0 / (np.linalg.norm(B[:, 0]) + np.linalg.norm(B[:, 1]))
    r1, r2, t = lam * B[:, 0], lam * B[:, 1], lam * B[:, 2]
    if t[2] < 0:
        r1, r2, t = -r1, -r2, -t
    R0 = np.c_[r1, r2, np.cross(r1, r2)]
    U, _, Vt = np.linalg.svd(R0)
    R0 = U @ Vt
    if np.linalg.det(R0) < 0:
        R0 = U @ np.diag([1, 1, -1]) @ Vt

    X = np.c_[world_xy, np.zeros(len(world_xy))]

    def resid(p):
        cam = Camera(p[0], cx, cy, rodrigues(p[1:4]), p[4:7], width, height)
        return (cam.project(X) - img_pts).ravel()

    p0 = np.r_[f0, rot_to_rvec(R0), t]
    sol = least_squares(resid, p0, method="lm" if len(img_pts) >= 4 else "trf")
    p = sol.x
    cam = Camera(p[0], cx, cy, rodrigues(p[1:4]), p[4:7], width, height)
    r = resid(p).reshape(-1, 2)
    rms = float(np.sqrt((r ** 2).sum(axis=1).mean()))
    return CalibrationResult(cam, cam.ground_homography(), rms, np.linalg.norm(r, axis=1))
