"""分析流水线：行车记录仪“跟车-追尾风险”类案例。

产物 out/analysis.json 是 Studio 与成片渲染的唯一数据来源，
所有数字都带 p05/p95 区间，并按“标线规格”假设分别给出。
"""
from __future__ import annotations

import numpy as np

from . import dashcam as dc
from .case import Case
from .forensics import analyze_frames
from .io import load_json, probe, read_gray, save_json


def analyze_dashcam(case: Case, verbose: bool = True) -> dict:
    ev = case.cfg["evidence"]
    ann = case.ann
    acfg = case.cfg.get("analysis", {})
    video = case.path(ev["video"])
    info = probe(video)
    fps = info["fps"]

    log = print if verbose else (lambda *a, **k: None)
    log(f"[1/5] 读取视频 {video.name}: {info}")
    small = read_gray(video, width=240).astype(np.float32)
    rep = analyze_frames(small, fps, step=1)
    del small
    w0, w1 = ev.get("measure_window", [0, info["duration"]])
    sel = (rep.unique_t >= w0) & (rep.unique_t <= w1)
    uidx = rep.unique_idx[sel]
    gray = read_gray(video, t1=w1 + 2 / fps).astype(np.float32)
    fr_sum = rep.summary()
    log(f"[2/5] 取证: {fr_sum}")
    t_jit = fr_sum["timing_uncertainty_s"] or 1.0 / fps  # 真实帧停留时长带来的时刻不确定

    # ---------- 虚线 ----------
    dcfg = ann["dashes"]
    dw0, dw1 = dcfg["window"]
    didx = uidx[(uidx / fps >= dw0) & (uidx / fps <= dw1)]
    obs = dc.detect_dashes(gray, didx, fps, tuple(dcfg["roi"]))
    tracks = dc.link_dashes(obs)
    r1, r2 = dcfg["rows"]
    cross = []
    for k, tr in enumerate(tracks):
        cross.append({
            "dash": k,
            "t_first": tr[0].t,
            "top_r1": dc.crossing_time(tr, r1, "top"), "top_r2": dc.crossing_time(tr, r2, "top"),
            "bot_r1": dc.crossing_time(tr, r1, "bottom", clip_bottom=dcfg["roi"][3] - 3),
            "bot_r2": dc.crossing_time(tr, r2, "bottom", clip_bottom=dcfg["roi"][3] - 3),
        })
    log(f"[3/5] 虚线: {len(obs)} 次检出, {len(tracks)} 段; 越线时刻 {cross}")

    # 相邻两段的周期（每行每条边各一个估计，取中位数）
    periods = []  # (t_mid, T)
    for a, b in zip(cross, cross[1:]):
        ests = [b[k] - a[k] for k in ("top_r1", "top_r2", "bot_r1", "bot_r2") if a[k] and b[k]]
        if ests:
            T = float(np.median(ests))
            periods.append((float(np.mean([a["top_r2"] or a["t_first"], b["top_r2"] or b["t_first"]])), T,
                            len(ests)))
    # 占空比：同一行上 底边→顶边 越线时间 / 周期
    duty = []
    Tmed = float(np.median([p[1] for p in periods])) if periods else float("nan")
    for c in cross:
        for row in ("r1", "r2"):
            if c[f"bot_{row}"] and c[f"top_{row}"]:
                duty.append((c[f"top_{row}"] - c[f"bot_{row}"]) / Tmed)
    duty_med = float(np.median(duty)) if duty else float("nan")

    # ---------- 前车宽度 ----------
    lv = ann["lead_vehicle"]
    lw0, lw1 = lv["window"]
    lidx = uidx[(uidx / fps >= lw0) & (uidx / fps <= lw1)]
    wobs = dc.track_dark_target(gray, lidx, fps, lv["x_start"], tuple(lv["sky_roi"]))
    wt = np.array([o.t for o in wobs])
    ww = np.array([o.width for o in wobs])
    keep = dc.reject_outliers(wt, 1 / ww, deg=2)
    wt, ww = wt[keep], ww[keep]
    wbody = np.array([o.body for o in wobs])[keep]
    wsky = float(np.median([o.sky for o in wobs]))
    log(f"[4/5] 前车宽度: {len(wobs)} 帧, 保留 {keep.sum()}, {ww.min():.0f}→{ww.max():.0f}px")

    # ---------- 蒙特卡洛 ----------
    rng = np.random.default_rng(acfg.get("seed", 0))
    N = int(acfg.get("mc_samples", 2000))
    lane = ann["lane"]
    hz = ann["horizon_y"]
    t_grid = np.round(np.arange(wt.min(), wt.max() + 1e-9, 0.1), 2)
    hyps = []
    for std in dcfg["standards"]:
        P0 = std["period_m"]
        tol = std.get("period_tol", 0.05)  # 施划误差 + 道路纵坡/弯道带来的投影误差
        ego_v, C_s, h_s, f_s = [], [], [], []
        seg_v = [[] for _ in periods]
        Z_grid, vrel_grid, ttc_grid, vtruck_grid = [], [], [], []
        vis_s, stop_s, headway_s = [], [], []
        for _ in range(N):
            P = P0 * rng.uniform(1 - tol, 1 + tol)
            yh = rng.normal(hz["value"], hz["sigma"])
            # 周期 → 速度（每个区间）
            seg = []
            for i, (tm, T, n) in enumerate(periods):
                Tj = T + rng.uniform(-t_jit, t_jit) * np.sqrt(2 / max(n, 1))
                seg.append(P / Tj)
                seg_v[i].append(P / Tj * 3.6)
            seg = np.array(seg)
            v_ref = float(np.median(seg[:3])) if len(seg) >= 3 else float(np.median(seg))
            ego_v.append(v_ref)
            # 尺度 C = f·h：同一段虚线顶边先后越过 r1、r2
            Cs = []
            for c in cross:
                if c["top_r1"] and c["top_r2"]:
                    dt = c["top_r2"] - c["top_r1"] + rng.uniform(-t_jit, t_jit)
                    if dt <= 0:
                        continue
                    du = 1 / (r1 - yh) - 1 / (r2 - yh)
                    Cs.append(v_ref * dt / du)
            if not Cs:
                continue
            C = float(np.median(Cs))
            Wl = rng.uniform(lane["width_m"]["min"], lane["width_m"]["max"])
            dx = (lane["right_x"] - lane["left_x"]) + rng.normal(0, 4)
            h = Wl * (lane["row"] - yh) / dx
            f = C / h
            C_s.append(C), h_s.append(h), f_s.append(f)
            # 前车距离
            Wt = rng.normal(lv["width_m"]["value"], lv["width_m"]["sigma"])
            wn = ww + rng.normal(0, 1.0, len(ww))
            Z = f * Wt / wn
            pz = np.polyfit(wt, Z, 2)
            Zg = np.polyval(pz, t_grid)
            vrel = -np.polyval(np.polyder(pz), t_grid)
            Z_grid.append(Zg)
            vrel_grid.append(vrel)
            ttc_grid.append(np.where(vrel > 0.2, Zg / np.maximum(vrel, 1e-3), np.nan))
            # 本车速度在网格上（区间速度线性插值）
            v_e = np.interp(t_grid, [p[0] for p in periods], seg)
            vtruck_grid.append(v_e - vrel)
            headway_s.append(np.polyval(pz, 1.5) / np.interp(1.5, [p[0] for p in periods], seg))
            # 雾能见度（Koschmieder），只做量级参考
            V, _ = dc.koschmieder_visibility(f * Wt / ww, wbody + rng.normal(0, 1.5, len(wbody)), wsky)
            vis_s.append(V)
            tr_ = rng.uniform(*acfg["reaction_s"])
            mu = rng.uniform(*acfg["mu_wet"])
            stop_s.append(dc.stopping_distance(v_ref, tr_, mu))

        def band(arr):
            a = np.array(arr)
            return {"median": np.round(np.nanmedian(a, 0), 2).tolist(),
                    "p05": np.round(np.nanpercentile(a, 5, 0), 2).tolist(),
                    "p95": np.round(np.nanpercentile(a, 95, 0), 2).tolist()}

        ego = np.array(ego_v)
        rec_gap = ego * acfg.get("recommended_headway_s", 3.0)
        hyps.append({
            "id": std["id"], "label": std["label"], "dash_m": std["dash_m"], "period_m": P0,
            "expected_duty": round(std["dash_m"] / P0, 3),
            "ego_speed_kmh": dc.summarize(ego * 3.6, 1),
            "speed_segments": [{"t": round(p[0], 3), "period_s": round(p[1], 3),
                                "kmh": dc.summarize(seg_v[i], 1)} for i, p in enumerate(periods)],
            "camera": {"height_m": dc.summarize(h_s), "focal_px": dc.summarize(f_s, 0),
                       "hfov_deg": dc.summarize(2 * np.degrees(np.arctan(info["width"] / 2 / np.array(f_s))), 1)},
            "lead": {
                "t": t_grid.tolist(),
                "distance_m": band(Z_grid),
                "closing_speed_kmh": band(np.array(vrel_grid) * 3.6),
                "lead_speed_kmh": band(np.array(vtruck_grid) * 3.6),
                "ttc_s": band(ttc_grid),
                "headway_at_1p5s": dc.summarize(headway_s),
            },
            "recommended_gap_m": dc.summarize(rec_gap, 0),
            "stopping_distance_m": dc.summarize(stop_s, 1),
            "visibility_m": dc.summarize(vis_s, 0),
        })
        log(f"  假设 {std['label']}: 本车 {hyps[-1]['ego_speed_kmh']}, h={hyps[-1]['camera']['height_m']}")

    # 占空比最接近哪个标线规格 → 主假设
    best = min(hyps, key=lambda h: abs(h["expected_duty"] - duty_med)) if np.isfinite(duty_med) else hyps[0]
    log(f"[5/5] 实测占空比 {duty_med:.3f} → 主假设 {best['label']}")

    result = {
        "case_id": case.id,
        "video": {**info, "path": ev["video"]},
        "forensics": fr_sum,
        "dashes": {
            "detections": [{"t": round(o.t, 4), "top": o.top, "bottom": o.bottom, "x": round(o.x, 1)} for o in obs],
            "crossings": cross,
            "periods": [{"t": round(p[0], 3), "T": round(p[1], 4), "n": p[2]} for p in periods],
            "duty_measured": round(duty_med, 3),
            "duty_samples": [round(x, 3) for x in duty],
        },
        "lead_track": [{"t": round(o.t, 4), "left": round(o.left, 1), "right": round(o.right, 1), "row": o.row,
                        "kept": bool(k)} for o, k in zip(wobs, keep)],
        "hypotheses": hyps,
        "primary": best["id"],
        "events": ann.get("events", []),
        "meta": {k: case.meta[k] for k in ("title", "disclaimer", "location", "outcome_known") if k in case.meta},
    }
    save_json(result, case.out / "analysis.json")
    return result


def load_analysis(case: Case) -> dict:
    return load_json(case.out / "analysis.json")
