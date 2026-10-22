"use client";
/** 道路设施资产：红绿灯、路灯、锥桶、三角牌、护栏段；以及按 RoadSpec 生成的整条道路。 */
import * as THREE from "three";
import { useMemo } from "react";
import { Box, Lamp, mat } from "./parts";
import { Road } from "@/lib/road";

/* ------------------------------ 红绿灯（悬臂式） ------------------------------ */
export function TrafficLight({ params = {} }: { params?: Record<string, any> }) {
  const state: "red" | "yellow" | "green" | "off" = params.state ?? "red";
  const arm = params.arm ?? 5.5;
  const poleH = params.height ?? 6.2;
  const heads = params.heads ?? 2;
  const pole = mat.metal("#7b828b", 0.45);
  const housing = mat.matte("#1b1d20", 0.5);
  const colors = { red: "#ff2b1c", yellow: "#ffb000", green: "#19e07a" } as const;
  return (
    <group>
      <mesh position={[0, poleH / 2, 0]} material={pole} castShadow>
        <cylinderGeometry args={[0.13, 0.17, poleH, 16]} />
      </mesh>
      <mesh position={[0, poleH - 0.25, -arm / 2]} rotation={[Math.PI / 2, 0, 0]} material={pole} castShadow>
        <cylinderGeometry args={[0.08, 0.1, arm, 12]} />
      </mesh>
      <Box size={[0.6, 0.3, 0.5]} position={[0, 0.15, 0]} material={mat.matte("#8e949b", 0.8)} />
      {Array.from({ length: heads }, (_, i) => -arm + 0.8 + i * 1.6).map((z) => (
        <group key={z} position={[0.12, poleH - 0.95, z]}>
          <Box size={[0.3, 1.15, 0.42]} position={[0, 0, 0]} material={housing} />
          {(["red", "yellow", "green"] as const).map((c, k) => (
            <group key={c} position={[0.16, 0.36 - k * 0.36, 0]}>
              <mesh rotation={[0, 0, Math.PI / 2]} material={mat.lamp(colors[c], state === c, 7)}>
                <cylinderGeometry args={[0.13, 0.13, 0.03, 20]} />
              </mesh>
              <Box size={[0.18, 0.03, 0.34]} position={[0.08, 0.15, 0]} material={housing} />
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

/* ------------------------------ 路灯 ------------------------------ */
export function StreetLamp({ params = {} }: { params?: Record<string, any> }) {
  const H = params.height ?? 9;
  const on = params.on ?? false;
  const pole = mat.metal("#8b9199", 0.4);
  return (
    <group>
      <mesh position={[0, H / 2, 0]} material={pole} castShadow>
        <cylinderGeometry args={[0.07, 0.12, H, 12]} />
      </mesh>
      <Box size={[0.12, 0.12, 1.8]} position={[0, H, -0.9]} material={pole} />
      <Box size={[0.4, 0.12, 0.7]} position={[0, H - 0.06, -1.7]} material={pole} />
      <Lamp position={[0, H - 0.13, -1.7]} size={[0.34, 0.02, 0.6]} color="#fff2cc" on={on} power={4} />
    </group>
  );
}

/* ------------------------------ 锥桶、三角警示牌 ------------------------------ */
export function TrafficCone() {
  return (
    <group>
      <mesh position={[0, 0.36, 0]} material={mat.matte("#ff5a14", 0.5)} castShadow>
        <coneGeometry args={[0.17, 0.7, 20]} />
      </mesh>
      <mesh position={[0, 0.42, 0]} material={mat.reflector("#f5f5f5")}>
        <cylinderGeometry args={[0.095, 0.115, 0.12, 20, 1, true]} />
      </mesh>
      <Box size={[0.42, 0.04, 0.42]} position={[0, 0.02, 0]} material={mat.matte("#222", 0.8)} />
    </group>
  );
}

export function WarningTriangle() {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-0.22, 0);
    s.lineTo(0.22, 0);
    s.lineTo(0, 0.4);
    s.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-0.13, 0.05);
    hole.lineTo(0.13, 0.05);
    hole.lineTo(0, 0.28);
    hole.closePath();
    s.holes.push(hole);
    return new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false });
  }, []);
  return (
    <group rotation={[0, Math.PI / 2, 0]}>
      <mesh geometry={shape} position={[0, 0.05, 0]} rotation={[-0.25, 0, 0]} material={mat.reflector("#ff2414")} castShadow />
      <Box size={[0.3, 0.02, 0.2]} position={[0, 0.01, 0]} material={mat.matte("#333", 0.7)} />
    </group>
  );
}

/* ------------------------------ 波形护栏（独立一段） ------------------------------ */
export function GuardrailSegment({ params = {} }: { params?: Record<string, any> }) {
  const len = params.length ?? 12;
  const spacing = params.postSpacing ?? 4;
  const steel = mat.metal("#aeb4bb", 0.35);
  return (
    <group>
      <Box size={[len, 0.31, 0.06]} position={[0, 0.6, 0]} material={steel} />
      {Array.from({ length: Math.floor(len / spacing) + 1 }, (_, i) => -len / 2 + i * spacing).map((x) => (
        <Box key={x} size={[0.12, 0.75, 0.12]} position={[x, 0.375, 0.12]} material={mat.metal("#8c929a", 0.5)} />
      ))}
    </group>
  );
}

/* ------------------------------ 整条道路 ------------------------------ */
export function RoadMesh({ road }: { road: Road }) {
  const { spec } = road;
  const geos = useMemo(() => {
    const half = road.width / 2;
    const L = road.length;
    const out: { g: THREE.BufferGeometry; m: THREE.Material; key: string }[] = [];
    const wet = spec.surface !== "dry";
    // 湿路面：低粗糙度 + 环境反射；不用 clearcoat（占屏面积大，CPU 渲染时代价高）
    const asphalt = new THREE.MeshStandardMaterial({
      color: wet ? "#2f3337" : "#3c3f43",
      roughness: wet ? 0.38 : 0.85,
      metalness: wet ? 0.12 : 0.02,
      side: THREE.DoubleSide,
    });
    const paint = new THREE.MeshStandardMaterial({ color: "#e9ece6", roughness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const shoulder = new THREE.MeshStandardMaterial({ color: "#3a3d40", roughness: 0.8, side: THREE.DoubleSide });
    out.push({ key: "asphalt", g: road.ribbon(-half - spec.shoulderRight, half + spec.shoulderLeft, -60, L + 60, 1, 0), m: asphalt });
    // 边线
    out.push({ key: "edgeL", g: road.ribbon(half - 0.05, half + 0.15, -60, L + 60, 1, 0.012), m: paint });
    out.push({ key: "edgeR", g: road.ribbon(-half - 0.15, -half + 0.05, -60, L + 60, 1, 0.012), m: paint });
    // 车道虚线
    for (let k = 1; k < spec.lanes; k++) {
      const d = half - k * spec.laneWidth;
      for (let s = -60; s < L + 60; s += spec.dash.line + spec.dash.gap) {
        out.push({ key: `dash${k}_${s}`, g: road.ribbon(d - 0.075, d + 0.075, s, s + spec.dash.line, 0.5, 0.012), m: paint });
      }
    }
    return out;
  }, [road]);

  const rails = useMemo(() => {
    const items: { pos: THREE.Vector3; rot: number }[] = [];
    const half = road.width / 2;
    const sides: number[] = [];
    if (spec.guardrailLeft) sides.push(half + spec.shoulderLeft + 0.2);
    if (spec.guardrailRight) sides.push(-half - spec.shoulderRight - 0.2);
    const beams: { g: THREE.BufferGeometry }[] = [];
    for (const d of sides) {
      for (let s = -60; s < road.length + 60; s += 4) items.push({ pos: road.toWorld(s, d + Math.sign(d) * 0.15, 0.375), rot: road.heading(s) });
      // 波形梁：两条带状面拼成竖直板
      const g = new THREE.BufferGeometry();
      const pos: number[] = [];
      const idx: number[] = [];
      const n = Math.ceil((road.length + 120) / 1);
      for (let i = 0; i <= n; i++) {
        const s = -60 + i;
        const a = road.toWorld(s, d, 0.45);
        const b = road.toWorld(s, d, 0.76);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      beams.push({ g });
    }
    return { items, beams };
  }, [road]);

  const postGeo = useMemo(() => new THREE.BoxGeometry(0.12, 0.75, 0.12), []);
  const postMat = mat.metal("#8c929a", 0.5);
  const beamMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#b8bec5", metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide }), []);

  return (
    <group>
      {geos.map(({ g, m, key }) => (
        <mesh key={key} geometry={g} material={m} receiveShadow />
      ))}
      {rails.beams.map(({ g }, i) => (
        <mesh key={i} geometry={g} material={beamMat} castShadow />
      ))}
      <instancedMesh
        args={[postGeo, postMat, rails.items.length]}
        castShadow
        ref={(im) => {
          if (!im) return;
          const m = new THREE.Matrix4();
          rails.items.forEach((it, i) => {
            m.makeRotationY(it.rot).setPosition(it.pos);
            im.setMatrixAt(i, m);
          });
          im.instanceMatrix.needsUpdate = true;
        }}
      />
    </group>
  );
}
