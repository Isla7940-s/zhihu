"use client";
/**
 * 车辆资产。全部参数化（尺寸、颜色、涂装），由 registry.ts 登记默认值。
 * 约定：原点在车辆几何中心正下方地面，车头朝 +X。
 */
import * as THREE from "three";
import { useMemo } from "react";
import { Box, Lamp, Panel, RBox, SideGlass, TailLights, Wheel, mat, type LightState } from "./parts";

export type VehicleProps = { params?: Record<string, any>; lights?: LightState };

function useShapeGeo(build: (s: THREE.Shape) => void, width: number, bevel: number, deps: unknown[]) {
  return useMemo(() => {
    const s = new THREE.Shape();
    build(s);
    const g = new THREE.ExtrudeGeometry(s, {
      depth: width - 2 * bevel,
      bevelEnabled: true,
      // bevelSize 会把轮廓向外扩，取小值保证外形尺寸≈参数；bevelThickness 给出侧面圆润的边
      bevelSize: bevel * 0.35,
      bevelThickness: bevel,
      bevelSegments: 4,
      curveSegments: 10,
    });
    g.translate(0, 0, -(width - 2 * bevel) / 2);
    g.computeVertexNormals();
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** 底边带轮拱的侧面轮廓 */
function profileWithArches(s: THREE.Shape, pts: [number, number][], arches: { x: number; r: number }[], base: number) {
  // pts 从车尾底部开始，顺时针经车顶到车头底部；最后沿底边回到起点并开出轮拱
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
  const sorted = [...arches].sort((a, b) => b.x - a.x);
  for (const a of sorted) {
    s.lineTo(a.x + a.r, base);
    s.absarc(a.x, base - 0.02, a.r, 0, Math.PI, false);
  }
  s.lineTo(pts[0][0], base);
  s.closePath();
}

/* ------------------------------ 小车（三厢轿车） ------------------------------ */
export function Sedan({ params = {}, lights = {} }: VehicleProps) {
  const L = params.length ?? 4.6;
  const W = params.width ?? 1.8;
  const H = params.height ?? 1.45;
  const color = params.color ?? "#c8ccd2";
  const h = L / 2;
  const wr = 0.33;
  const wx = [h - 0.95, -h + 1.0];
  const prof: [number, number][] = [
    [-h, 0.32], [-h, 0.78], [-h + 0.12, 0.95], [-h + 0.85, 1.0], [-h + 1.45, H], [h - 1.95, H],
    [h - 1.2, 0.98], [h - 0.15, 0.8], [h, 0.64], [h, 0.32],
  ];
  const geo = useShapeGeo((s) => profileWithArches(s, prof, wx.map((x) => ({ x, r: wr + 0.06 })), 0.32), W, 0.07,
    [L, W, H]);
  const body = mat.paint(color);
  return (
    <group>
      <mesh geometry={geo} material={body} castShadow receiveShadow />
      <SideGlass z={W / 2 + 0.002} outline={[[-h + 0.98, 1.03], [-h + 1.5, H - 0.06], [-0.05, H - 0.06], [-0.05, 1.03]]} />
      <SideGlass z={W / 2 + 0.002} outline={[[0.05, 1.03], [0.05, H - 0.06], [h - 1.98, H - 0.06], [h - 1.3, 1.01]]} />
      <Panel a={[h - 1.2, 0.98]} b={[h - 1.95, H]} width={W - 0.22} material={mat.glass()} inset={0.012} />
      <Panel a={[-h + 0.85, 1.0]} b={[-h + 1.45, H]} width={W - 0.26} material={mat.glass()} inset={0.012} />
      {/* 保险杠、牌照 */}
      <Box size={[0.08, 0.18, W - 0.1]} position={[h + 0.01, 0.42, 0]} material={mat.plastic()} />
      <Box size={[0.08, 0.18, W - 0.1]} position={[-h - 0.01, 0.42, 0]} material={mat.plastic()} />
      <Box size={[0.02, 0.12, 0.44]} position={[h + 0.06, 0.45, 0]} material={mat.matte("#e8eef5", 0.5)} />
      <Box size={[0.02, 0.12, 0.44]} position={[-h - 0.06, 0.6, 0]} material={mat.matte("#e8eef5", 0.5)} />
      {/* 灯 */}
      {[1, -1].map((s) => (
        <Lamp key={s} position={[h + 0.005, 0.68, s * (W / 2 - 0.26)]} size={[0.04, 0.1, 0.34]} color="#f4f7ff" on={lights.head ?? true} power={2.2} />
      ))}
      <TailLights x={-h - 0.005} y={0.86} zHalf={W / 2 - 0.22} size={[0.04, 0.1, 0.32]} lights={lights} />
      {/* 后视镜 */}
      {[1, -1].map((s) => (
        <Box key={s} size={[0.12, 0.1, 0.16]} position={[h - 1.3, 1.02, s * (W / 2 + 0.07)]} material={body} />
      ))}
      {wx.map((x) => [1, -1].map((s) => <Wheel key={`${x}${s}`} x={x} z={s * (W / 2 - 0.13)} r={wr} w={0.21} />))}
    </group>
  );
}

/* ------------------------------ 面包车 / MPV ------------------------------ */
export function Van({ params = {}, lights = {} }: VehicleProps) {
  const L = params.length ?? 4.9;
  const W = params.width ?? 1.85;
  const H = params.height ?? 2.0;
  const color = params.color ?? "#9aa1a9";
  const h = L / 2;
  const wr = 0.34;
  const wx = [h - 0.85, -h + 0.95];
  const prof: [number, number][] = [
    [-h, 0.35], [-h, H - 0.12], [-h + 0.12, H], [h - 1.25, H], [h - 0.45, 1.12], [h - 0.05, 0.98], [h, 0.85], [h, 0.35],
  ];
  const geo = useShapeGeo((s) => profileWithArches(s, prof, wx.map((x) => ({ x, r: wr + 0.06 })), 0.35), W, 0.08,
    [L, W, H]);
  const body = mat.paint(color, 0.4);
  return (
    <group>
      <mesh geometry={geo} material={body} castShadow receiveShadow />
      <SideGlass z={W / 2 + 0.002} outline={[[-h + 0.2, 1.2], [-h + 0.2, H - 0.12], [h - 1.32, H - 0.12], [h - 0.62, 1.2]]} />
      <Panel a={[h - 0.45, 1.12]} b={[h - 1.25, H]} width={W - 0.2} material={mat.glass()} inset={0.012} />
      <Box size={[0.02, 0.6, W - 0.3]} position={[-h - 0.012, 1.5, 0]} material={mat.glass()} />
      <Box size={[0.08, 0.2, W - 0.06]} position={[h + 0.01, 0.48, 0]} material={mat.plastic()} />
      <Box size={[0.08, 0.2, W - 0.06]} position={[-h - 0.01, 0.48, 0]} material={mat.plastic()} />
      {[1, -1].map((s) => (
        <Lamp key={s} position={[h + 0.005, 0.82, s * (W / 2 - 0.25)]} size={[0.04, 0.12, 0.3]} color="#f4f7ff" on={lights.head ?? true} power={2} />
      ))}
      <TailLights x={-h - 0.005} y={0.95} zHalf={W / 2 - 0.12} size={[0.04, 0.22, 0.12]} lights={lights} />
      {[1, -1].map((s) => (
        <Box key={s} size={[0.12, 0.16, 0.14]} position={[h - 0.6, 1.25, s * (W / 2 + 0.07)]} material={mat.plastic()} />
      ))}
      {wx.map((x) => [1, -1].map((s) => <Wheel key={`${x}${s}`} x={x} z={s * (W / 2 - 0.14)} r={wr} w={0.22} />))}
    </group>
  );
}

/* ------------------------------ 平头驾驶室（重卡共用） ------------------------------ */
function CabOver({ x0, W, color, stripe, lights, height = 2.55, length = 2.25, floor = 1.05 }: {
  x0: number; // 驾驶室前脸 x
  W: number;
  color: string;
  stripe?: string;
  lights: LightState;
  height?: number;
  length?: number;
  floor?: number;
}) {
  const cx = x0 - length / 2;
  const top = floor + height;
  const paint = mat.paint(color, 0.38);
  return (
    <group>
      <RBox size={[length, height, W]} position={[cx, floor + height / 2, 0]} material={paint} radius={0.14} />
      {/* 挡风玻璃（略后倾） */}
      <Box size={[0.04, 0.95, W - 0.3]} position={[x0 + 0.005, top - 0.75, 0]} rotation={[0, 0, -0.08]} material={mat.glass()} />
      {/* 遮阳板 */}
      <Box size={[0.32, 0.08, W - 0.1]} position={[x0 + 0.06, top - 0.2, 0]} material={paint} />
      {/* 侧窗 */}
      {[1, -1].map((s) => (
        <Box key={s} size={[0.9, 0.75, 0.02]} position={[x0 - 0.62, top - 0.78, s * (W / 2 + 0.002)]} material={mat.glass()} />
      ))}
      {/* 格栅 + 保险杠 */}
      <Box size={[0.03, 0.55, W - 0.6]} position={[x0 + 0.01, floor + 0.75, 0]} material={mat.plastic()} />
      {Array.from({ length: 5 }, (_, i) => (
        <Box key={i} size={[0.035, 0.035, W - 0.66]} position={[x0 + 0.02, floor + 0.55 + i * 0.1, 0]} material={mat.metal("#9ca3ab")} />
      ))}
      <Box size={[0.28, 0.42, W]} position={[x0 + 0.02, floor - 0.12, 0]} material={mat.matte("#2a2d31", 0.6)} />
      {[1, -1].map((s) => (
        <Lamp key={s} position={[x0 + 0.17, floor - 0.06, s * (W / 2 - 0.32)]} size={[0.02, 0.16, 0.38]} color="#f4f7ff" on={lights.head ?? true} power={2.4} />
      ))}
      {/* 涂装条纹 */}
      {stripe && (
        <>
          {[1, -1].map((s) => (
            <group key={s}>
              <Box size={[length - 0.2, 0.16, 0.012]} position={[cx, floor + 0.55, s * (W / 2 + 0.004)]} material={mat.matte(stripe, 0.5)} />
              <Box size={[length - 0.5, 0.08, 0.012]} position={[cx - 0.1, floor + 0.32, s * (W / 2 + 0.004)]} material={mat.matte(stripe, 0.5)} />
            </group>
          ))}
          <Box size={[0.012, 0.14, W - 0.4]} position={[x0 + 0.03, floor + 0.38, 0]} material={mat.matte(stripe, 0.5)} />
        </>
      )}
      {/* 后视镜支架 + 镜面 */}
      {[1, -1].map((s) => (
        <group key={s}>
          <Box size={[0.05, 0.05, 0.3]} position={[x0 - 0.15, top - 0.55, s * (W / 2 + 0.15)]} material={mat.plastic()} />
          <Box size={[0.08, 0.5, 0.2]} position={[x0 - 0.15, top - 0.8, s * (W / 2 + 0.32)]} material={mat.plastic()} />
        </group>
      ))}
      {/* 踏步 */}
      {[1, -1].map((s) => (
        <Box key={s} size={[0.5, 0.06, 0.18]} position={[x0 - 0.75, floor - 0.25, s * (W / 2 - 0.05)]} material={mat.metal("#666b72")} />
      ))}
    </group>
  );
}

function Chassis({ x0, x1, y = 0.95 }: { x0: number; x1: number; y?: number }) {
  return (
    <group>
      {[0.45, -0.45].map((z) => (
        <Box key={z} size={[x1 - x0, 0.28, 0.12]} position={[(x0 + x1) / 2, y, z]} material={mat.matte("#202225", 0.6)} />
      ))}
      <Box size={[0.2, 0.3, 2.3]} position={[x0 + 0.1, y - 0.05, 0]} material={mat.matte("#202225", 0.6)} />
    </group>
  );
}

/* ------------------------------ 自卸车（8×4） ------------------------------ */
export function DumpTruck({ params = {}, lights = {} }: VehicleProps) {
  const L = params.length ?? 9.8;
  const W = params.width ?? 2.5;
  const cabColor = params.cabColor ?? "#d9dde2";
  const bodyColor = params.bodyColor ?? "#4b5560";
  const h = L / 2;
  const cabFront = h;
  const bodyX0 = -h, bodyX1 = h - 2.6;
  const floor = 1.55, wallH = 1.55;
  const bodyMat = mat.paint(bodyColor, 0.55);
  const r = 0.52;
  const axles = [h - 1.45, h - 3.1, -h + 2.95, -h + 1.55];
  return (
    <group>
      <CabOver x0={cabFront} W={W} color={cabColor} lights={lights} />
      <Chassis x0={-h + 0.2} x1={h - 0.4} />
      {/* 货厢：底板 + 四壁（开口），侧面加强筋 */}
      <Box size={[bodyX1 - bodyX0, 0.14, W]} position={[(bodyX0 + bodyX1) / 2, floor, 0]} material={bodyMat} />
      {[1, -1].map((s) => (
        <Box key={s} size={[bodyX1 - bodyX0, wallH, 0.08]} position={[(bodyX0 + bodyX1) / 2, floor + wallH / 2, s * (W / 2 - 0.04)]} material={bodyMat} />
      ))}
      <Box size={[0.1, wallH + 0.25, W]} position={[bodyX1 - 0.05, floor + (wallH + 0.25) / 2, 0]} material={bodyMat} />
      <Box size={[0.12, wallH, W]} position={[bodyX0 + 0.06, floor + wallH / 2, 0]} material={bodyMat} />
      {/* 防护顶檐（伸到驾驶室上方） */}
      <Box size={[0.9, 0.08, W]} position={[bodyX1 + 0.4, floor + wallH + 0.2, 0]} material={bodyMat} />
      {Array.from({ length: 6 }, (_, i) => bodyX0 + 0.5 + (i * (bodyX1 - bodyX0 - 1)) / 5).map((x) =>
        [1, -1].map((s) => (
          <Box key={`${x}${s}`} size={[0.1, wallH, 0.06]} position={[x, floor + wallH / 2, s * (W / 2 + 0.01)]} material={bodyMat} />
        )),
      )}
      {[1, -1].map((s) => (
        <Box key={s} size={[bodyX1 - bodyX0, 0.1, 0.1]} position={[(bodyX0 + bodyX1) / 2, floor + wallH, s * (W / 2)]} material={mat.paint("#5b6570", 0.5)} />
      ))}
      {/* 货物（砂石） */}
      <Box size={[bodyX1 - bodyX0 - 0.3, 0.05, W - 0.3]} position={[(bodyX0 + bodyX1) / 2, floor + wallH * 0.82, 0]} material={mat.matte("#6e6253", 0.95)} castShadow={false} />
      {/* 反光贴：红白相间 */}
      {Array.from({ length: 10 }, (_, i) => bodyX0 + 0.3 + i * ((bodyX1 - bodyX0 - 0.6) / 9)).map((x, i) =>
        [1, -1].map((s) => (
          <Box key={`${i}${s}`} size={[0.35, 0.06, 0.01]} position={[x, floor + 0.1, s * (W / 2 + 0.03)]} material={mat.reflector(i % 2 ? "#f2f2f2" : "#e0261a")} castShadow={false} />
        )),
      )}
      {/* 尾部：防钻撞梁、尾灯 */}
      <Box size={[0.1, 0.12, W - 0.2]} position={[-h + 0.05, 0.55, 0]} material={mat.reflector("#e0261a")} />
      <TailLights x={-h - 0.01} y={0.95} zHalf={W / 2 - 0.3} size={[0.04, 0.12, 0.3]} lights={lights} />
      {/* 油箱、挡泥板 */}
      <Box size={[0.9, 0.5, 0.5]} position={[h - 2.4, 0.85, W / 2 - 0.3]} material={mat.metal("#a7adb5", 0.35)} />
      {axles.map((x) => [1, -1].map((s) => (
        <Box key={`${x}${s}`} size={[1.15, 0.05, 0.6]} position={[x, 2 * r + 0.08, s * (W / 2 - 0.3)]} material={mat.plastic()} />
      )))}
      {axles.map((x, i) => [1, -1].map((s) => <Wheel key={`${x}${s}`} x={x} z={s * (W / 2 - 0.2)} r={r} w={0.3} dual={i >= 2} />))}
    </group>
  );
}

/* ------------------------------ 平头厢式货车（6×2） ------------------------------ */
export function FlatNoseTruck({ params = {}, lights = {} }: VehicleProps) {
  const L = params.length ?? 9.6;
  const W = params.width ?? 2.5;
  const cabColor = params.cabColor ?? "#f2f3f4";
  const boxColor = params.boxColor ?? "#eef0f2";
  const livery = params.livery ?? "#d8361f";
  const h = L / 2;
  const boxX0 = -h, boxX1 = h - 2.45;
  const boxFloor = 1.25, boxH = 2.6;
  const r = 0.5;
  const axles = [h - 1.4, -h + 2.6, -h + 1.3];
  const boxMat = mat.matte(boxColor, 0.55);
  return (
    <group>
      <CabOver x0={h} W={W} color={cabColor} stripe={livery} lights={lights} height={2.6} />
      <Chassis x0={-h + 0.2} x1={h - 0.4} />
      <RBox size={[boxX1 - boxX0, boxH, W]} position={[(boxX0 + boxX1) / 2, boxFloor + boxH / 2, 0]} material={boxMat} radius={0.05} />
      {/* 厢体涂装：斜向色带 */}
      {[1, -1].map((s) => (
        <group key={s} position={[0, 0, s * (W / 2 + 0.006)]}>
          {[0, 1, 2].map((k) => (
            <Box key={k} size={[boxX1 - boxX0 - 0.4, 0.22, 0.01]} position={[(boxX0 + boxX1) / 2, boxFloor + 0.55 + k * 0.42, 0]}
              rotation={[0, 0, 0.12 - k * 0.02]} material={mat.matte(livery, 0.45)} castShadow={false} />
          ))}
        </group>
      ))}
      <Box size={[0.02, boxH - 0.2, W - 0.2]} position={[boxX0 - 0.01, boxFloor + boxH / 2, 0]} material={mat.matte("#d5d8dc", 0.5)} />
      <Box size={[0.03, boxH - 0.2, 0.04]} position={[boxX0 - 0.02, boxFloor + boxH / 2, 0]} material={mat.metal("#9aa0a8")} />
      <Box size={[0.1, 0.12, W - 0.2]} position={[-h + 0.05, 0.55, 0]} material={mat.reflector("#e0261a")} />
      <TailLights x={-h - 0.01} y={0.95} zHalf={W / 2 - 0.3} size={[0.04, 0.12, 0.3]} lights={lights} />
      {axles.map((x) => [1, -1].map((s) => (
        <Box key={`${x}${s}`} size={[1.1, 0.05, 0.6]} position={[x, 2 * r + 0.08, s * (W / 2 - 0.3)]} material={mat.plastic()} />
      )))}
      {axles.map((x, i) => [1, -1].map((s) => <Wheel key={`${x}${s}`} x={x} z={s * (W / 2 - 0.2)} r={r} w={0.3} dual={i >= 1} />))}
    </group>
  );
}

/* ------------------------------ 轻型厢式货车 ------------------------------ */
export function BoxTruck({ params = {}, lights = {} }: VehicleProps) {
  const L = params.length ?? 6.0;
  const W = params.width ?? 2.2;
  const cabColor = params.cabColor ?? "#e9ecef";
  const boxColor = params.boxColor ?? "#e6b422";
  const h = L / 2;
  const boxX0 = -h, boxX1 = h - 1.95;
  const r = 0.38;
  return (
    <group>
      <CabOver x0={h} W={W - 0.1} color={cabColor} lights={lights} height={1.75} length={1.7} floor={0.85} />
      <Chassis x0={-h + 0.2} x1={h - 0.4} y={0.7} />
      <RBox size={[boxX1 - boxX0, 2.1, W]} position={[(boxX0 + boxX1) / 2, 1.0 + 1.05, 0]} material={mat.matte(boxColor, 0.5)} radius={0.04} />
      <TailLights x={-h - 0.01} y={0.75} zHalf={W / 2 - 0.25} size={[0.04, 0.12, 0.26]} lights={lights} />
      {[h - 1.0, -h + 1.4].map((x, i) => [1, -1].map((s) => (
        <Wheel key={`${x}${s}`} x={x} z={s * (W / 2 - 0.18)} r={r} w={0.24} dual={i === 1} />
      )))}
    </group>
  );
}
