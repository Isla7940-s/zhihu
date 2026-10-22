/**
 * 道路几何：中心线样条 + 道路坐标 (s, d) ⇄ three.js 世界坐标。
 * three.js 约定 Y 轴向上；平面坐标 (x 前, y 左) 映射为 (X=x, Z=-y)。
 */
import * as THREE from "three";
import type { RoadSpec } from "./scene";

export class Road {
  readonly spec: RoadSpec;
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  private table: { s: number; p: THREE.Vector3; t: THREE.Vector3 }[] = [];

  constructor(spec: RoadSpec) {
    this.spec = spec;
    this.curve = new THREE.CatmullRomCurve3(
      spec.centerline.map(([x, y]) => new THREE.Vector3(x, 0, -y)),
      false,
      "centripetal",
    );
    this.length = this.curve.getLength();
    const n = Math.max(200, Math.ceil(this.length * 2));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      this.table.push({ s: u * this.length, p: this.curve.getPointAt(u), t: this.curve.getTangentAt(u) });
    }
  }

  get width() {
    return this.spec.lanes * this.spec.laneWidth;
  }

  /** 车道 k（0=最左）中心线的横向偏移 d */
  laneCenter(k: number) {
    const { lanes, laneWidth } = this.spec;
    return ((lanes - 1) / 2 - k) * laneWidth;
  }

  frame(s: number) {
    const ss = THREE.MathUtils.clamp(s, 0, this.length);
    const f = ss / this.length * (this.table.length - 1);
    const i = Math.min(Math.floor(f), this.table.length - 2);
    const a = this.table[i], b = this.table[i + 1];
    const w = f - i;
    const p = a.p.clone().lerp(b.p, w);
    const t = a.t.clone().lerp(b.t, w).normalize();
    // 超出两端时沿切线外推，便于车辆从画外驶入
    if (s < 0) p.addScaledVector(t, s);
    if (s > this.length) p.addScaledVector(t, s - this.length);
    const left = new THREE.Vector3(0, 1, 0).cross(t).normalize();
    return { p, t, left };
  }

  /** 道路坐标 → 世界坐标 */
  toWorld(s: number, d: number, h = 0) {
    const { p, left } = this.frame(s);
    return p.addScaledVector(left, d).setY(h);
  }

  /** 道路切向的航向角（绕 Y 轴），加上相对偏航（度） */
  heading(s: number, yawDeg = 0) {
    const { t } = this.frame(s);
    return Math.atan2(-t.z, t.x) + THREE.MathUtils.degToRad(yawDeg);
  }

  /** 沿道路生成带状几何（d0→d1 横向区间），用于路面、标线、路肩 */
  ribbon(d0: number, d1: number, s0 = 0, s1 = this.length, step = 1, y = 0): THREE.BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const n = Math.max(1, Math.ceil((s1 - s0) / step));
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const a = this.toWorld(s, d0, y);
      const b = this.toWorld(s, d1, y);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      uv.push(0, s / 10, 1, s / 10);
      if (i < n) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
}
