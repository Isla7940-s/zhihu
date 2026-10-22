import numpy as np

from crashlab.geometry import Camera, apply_h, calibrate_from_ground, fit_homography


def test_homography_roundtrip():
    rng = np.random.default_rng(0)
    H = np.array([[1.2, 0.1, 30], [-0.05, 0.9, 12], [1e-4, 2e-4, 1]])
    src = rng.uniform(0, 100, (12, 2))
    dst = apply_h(H, src)
    H2 = fit_homography(src, dst)
    assert np.allclose(apply_h(H2, src), dst, atol=1e-6)


def test_single_view_calibration_recovers_camera():
    cam = Camera.look_at((2, -20, 8), (15, 1, 0), 60, 960, 540)
    world = np.array([[x, y] for x in (0, 6, 15, 21, 30, 36) for y in (-1.75, 1.75, 5.25)], float)
    img = cam.project(np.c_[world, np.zeros(len(world))])
    img += np.random.default_rng(1).normal(0, 0.5, img.shape)
    res = calibrate_from_ground(img, world, 960, 540)
    assert res.rms_px < 1.0
    assert abs(res.camera.f - cam.f) / cam.f < 0.03
    assert np.linalg.norm(res.camera.center - cam.center) < 0.5


def test_backproject_to_plane():
    cam = Camera.look_at((0, -10, 6), (10, 0, 0), 55, 800, 600)
    X = np.array([[12.0, 1.0, 0.4]])
    uv = cam.project(X)
    back = cam.backproject_to_plane(uv, 0.4)
    assert np.allclose(back, X, atol=1e-6)
