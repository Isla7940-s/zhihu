"use client";
/**
 * 资产共用零件：材质、车轮、灯具、侧面轮廓挤出。
 * 所有车辆资产的约定：原点在车辆中心正下方的地面，车头朝 +X，车宽沿 Z。
 */
import * as THREE from "three";
import { useMemo } from "react";

export type LightState = { brake?: boolean; hazard?: boolean; hazardOn?: boolean; head?: boolean };

const cache = new Map<string, THREE.Material>();
function memo<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

export const mat = {
  paint: (color: string, rough = 0.32) =>
    memo(`paint:${color}:${rough}`, () =>
      new THREE.MeshPhysicalMaterial({ color, metalness: 0.35, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.18 })),
  matte: (color: string, rough = 0.75) =>
    memo(`matte:${color}:${rough}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: rough })),
  metal: (color = "#b9bec6", rough = 0.25) =>
    memo(`metal:${color}:${rough}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: rough })),
  glass: () =>
    memo("glass", () =>
      new THREE.MeshPhysicalMaterial({ color: "#0f1a24", metalness: 0.1, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.6 })),
  rubber: () => memo("rubber", () => new THREE.MeshStandardMaterial({ color: "#151517", roughness: 0.92 })),
  plastic: () => memo("plastic", () => new THREE.MeshStandardMaterial({ color: "#1d1f22", roughness: 0.6 })),
  lamp: (color: string, on: boolean, power = 3) =>
    memo(`lamp:${color}:${on}:${power}`, () =>
      new THREE.MeshStandardMaterial({
        color: on ? color : new THREE.Color(color).multiplyScalar(0.35),
        emissive: color,
        emissiveIntensity: on ? power : 0.08,
        roughness: 0.3,
      })),
  reflector: (color: string) =>
    memo(`refl:${color}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.4 })),
};

export function Box({ size, position, material, rotation, castShadow = true }: {
  size: [number, number, number];
  position: [number, number, number];
  material: THREE.Material;
  rotation?: [number, number, number];
  castShadow?: boolean;
}) {
  return (
    <mesh position={position} rotation={rotation} material={material} castShadow={castShadow} receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  );
}

/** 圆角盒：用于驾驶室、厢体，边缘高光让模型不那么“白模” */
export function RBox({ size, position, material, radius = 0.06, rotation }: {
  size: [number, number, number];
  position: [number, number, number];
  material: THREE.Material;
  radius?: number;
  rotation?: [number, number, number];
}) {
  const geo = useMemo(() => roundedBoxGeometry(size[0], size[1], size[2], radius), [size[0], size[1], size[2], radius]);
  return <mesh geometry={geo} position={position} rotation={rotation} material={material} castShadow receiveShadow />;
}

export function roundedBoxGeometry(w: number, h: number, d: number, r: number, seg = 3) {
  // 与 drei RoundedBox 同法：内矩形 (w-2r, h-2r) 挤出 d-2r，倒角 r 补回外形 —— 外形尺寸严格等于 w×h×d
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const eps = 1e-5;
  const shape = new THREE.Shape();
  const iw = w - 2 * rr, ih = h - 2 * rr;
  shape.absarc(eps, eps, eps, -Math.PI / 2, -Math.PI, true);
  shape.absarc(eps, ih - 2 * eps, eps, Math.PI, Math.PI / 2, true);
  shape.absarc(iw - 2 * eps, ih - 2 * eps, eps, Math.PI / 2, 0, true);
  shape.absarc(iw - 2 * eps, eps, eps, 0, -Math.PI / 2, true);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d - 2 * rr,
    bevelEnabled: true,
    bevelSize: rr - eps,
    bevelThickness: rr,
    bevelSegments: seg * 2,
    curveSegments: seg * 2,
  });
  g.center();
  g.computeVertexNormals();
  return g;
}

/** 侧面轮廓（x,y 点列）沿 Z 挤出，带倒角 —— 小车车身的主体做法 */
export function ProfileBody({ profile, width, material, bevel = 0.06 }: {
  profile: [number, number][];
  width: number;
  material: THREE.Material;
  bevel?: number;
}) {
  const geo = useMemo(() => {
    const s = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, {
      depth: width - 2 * bevel,
      bevelEnabled: true,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 4,
      curveSegments: 8,
    });
    g.translate(0, 0, -(width - 2 * bevel) / 2);
    g.computeVertexNormals();
    return g;
  }, [JSON.stringify(profile), width, bevel]);
  return <mesh geometry={geo} material={material} castShadow receiveShadow />;
}

/** 侧窗：在车身两侧贴一层玻璃多边形 */
export function SideGlass({ outline, z }: { outline: [number, number][]; z: number }) {
  const geo = useMemo(() => new THREE.ShapeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))),
    [JSON.stringify(outline)]);
  return (
    <group>
      <mesh geometry={geo} position={[0, 0, z]} material={mat.glass()} />
      <mesh geometry={geo} position={[0, 0, -z]} rotation={[0, Math.PI, 0]} scale={[-1, 1, 1]} material={mat.glass()} />
    </group>
  );
}

/** 两点间的平板（挡风玻璃、后窗） */
export function Panel({ a, b, width, material, inset = 0 }: {
  a: [number, number];
  b: [number, number];
  width: number;
  material: THREE.Material;
  inset?: number;
}) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const nx = -Math.sin(ang) * inset, ny = Math.cos(ang) * inset;
  return (
    <mesh position={[(a[0] + b[0]) / 2 + nx, (a[1] + b[1]) / 2 + ny, 0]} rotation={[0, 0, ang]} material={material}>
      <boxGeometry args={[len, 0.02, width]} />
    </mesh>
  );
}

export function Wheel({ x, z, r = 0.33, w = 0.22, dual = false, rimColor = "#c7ccd3" }: {
  x: number;
  z: number;
  r?: number;
  w?: number;
  dual?: boolean;
  rimColor?: string;
}) {
  const side = Math.sign(z) || 1;
  const tires = dual ? [0, -side * (w + 0.02)] : [0];
  return (
    <group position={[x, r, z]}>
      {tires.map((dz, i) => (
        <group key={i} position={[0, 0, dz]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={mat.rubber()} castShadow>
            <cylinderGeometry args={[r, r, w, 28]} />
          </mesh>
          {i === 0 && (
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, side * (w / 2 + 0.003)]} material={mat.metal(rimColor, 0.35)}>
              <cylinderGeometry args={[r * 0.62, r * 0.62, 0.012, 24]} />
            </mesh>
          )}
          {i === 0 && (
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, side * (w / 2 + 0.012)]} material={mat.metal("#8a9099", 0.4)}>
              <cylinderGeometry args={[r * 0.2, r * 0.2, 0.02, 12]} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

/** 灯：发光盒。hazard 闪烁由外部传入 hazardOn */
export function Lamp({ position, size, color, on, power }: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  on: boolean;
  power?: number;
}) {
  return (
    <mesh position={position} material={mat.lamp(color, on, power)}>
      <boxGeometry args={size} />
    </mesh>
  );
}

/** 尾灯组合（左右对称），根据灯光状态点亮 */
export function TailLights({ x, y, zHalf, size, lights, fog = true }: {
  x: number;
  y: number;
  zHalf: number;
  size: [number, number, number];
  lights: LightState;
  fog?: boolean;
}) {
  const turn = !!(lights.hazard && lights.hazardOn);
  return (
    <group>
      {[1, -1].map((s) => (
        <group key={s}>
          <Lamp position={[x, y, s * zHalf]} size={size} color="#ff2a1a" on={!!lights.brake || fog} power={lights.brake ? 6 : 1.6} />
          <Lamp position={[x, y - size[1] * 0.9, s * zHalf]} size={[size[0], size[1] * 0.6, size[2]]} color="#ffa21a" on={turn} power={5} />
        </group>
      ))}
    </group>
  );
}
