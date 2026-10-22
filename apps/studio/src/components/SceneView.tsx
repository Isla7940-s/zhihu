"use client";
/**
 * 由 SceneSpec + 时间 t 确定性地渲染一帧。
 * 交互预览（OrbitControls）和逐帧导出（frameloop="demand" + 外部推进 t）共用这一个组件。
 */
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { TextSprite } from "./TextSprite";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { ASSET_MAP } from "@/assets3d/registry";
import { RoadMesh } from "@/assets3d/infrastructure";
import { Road } from "@/lib/road";
import { sampleKeys, type Actor, type CameraTrack, type SceneSpec } from "@/lib/scene";

export type GapOverlay = { from: string; to: string; label: string; color?: string };
export type ActorLabel = { id: string; text: string; color?: string };

export type SceneViewProps = {
  spec: SceneSpec;
  t: number;
  camera?: string; // cameras[].id；缺省时使用自由视角
  orbit?: boolean;
  gaps?: GapOverlay[];
  labels?: ActorLabel[];
  showEvidence?: boolean;
  onReady?: () => void;
  children?: ReactNode;
  dpr?: number;
  preserveDrawingBuffer?: boolean;
  quality?: "preview" | "render";
  /** 导出模式用 demand：只在 seek 时渲染一帧，避免 CPU 渲染器空转 */
  frameloop?: "always" | "demand";
  /** 每渲染一帧回调（导出时据此确认画面已更新） */
  onFrame?: (n: number) => void;
  registerInvalidate?: (fn: () => void) => void;
};

export function SceneView(props: SceneViewProps) {
  const { orbit, dpr = 1.5, preserveDrawingBuffer = false, frameloop = "always" } = props;
  const fogColor = "#c7ced6";
  return (
    <Canvas
      shadows
      dpr={dpr}
      frameloop={frameloop}
      gl={{ antialias: true, preserveDrawingBuffer, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{ position: [-30, 18, 25], fov: 45, near: 0.1, far: 2000 }}
      style={{ background: fogColor }}
    >
      <World {...props} fogColor={fogColor} />
      {orbit && <OrbitControls makeDefault target={[20, 0, 0]} />}
    </Canvas>
  );
}

function World({ spec, t, camera, orbit, gaps = [], labels = [], showEvidence, onReady, onFrame, registerInvalidate, children, fogColor, quality = "preview" }: SceneViewProps & { fogColor: string }) {
  const road = useMemo(() => new Road(spec.road), [spec.road]);
  const { scene } = useThree();
  useEffect(() => {
    const V = spec.environment.fogVisibility;
    scene.fog = new THREE.FogExp2(fogColor, 1.98 / V);
    scene.background = new THREE.Color(fogColor);
  }, [scene, spec.environment.fogVisibility, fogColor]);
  // 第一帧真正画完之后才算就绪（导出时据此等待着色器编译）
  const frames = useRef(0);
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => {
    registerInvalidate?.(() => invalidate());
  }, [invalidate, registerInvalidate]);
  useEffect(() => {
    invalidate();
  }, [t, invalidate]);
  useFrame(() => {
    frames.current += 1;
    onFrame?.(frames.current);
    if (frames.current === 2) onReady?.();
    if (frames.current < 3) invalidate(); // 首次挂载多画两帧，确保阴影与环境贴图就绪
  });

  const poses = useMemo(() => Object.fromEntries(spec.actors.map((a) => [a.id, sampleKeys(a.keys, t)])), [spec.actors, t]);

  const groundColor = { snow: "#d4d8dc", grass: "#6f7d5e", dirt: "#8a7d68" }[spec.environment.ground];
  return (
    <>
      <hemisphereLight args={["#e9eef5", "#6d7176", 1.1]} />
      <directionalLight
        position={[40, 80, 30]}
        intensity={1.3}
        castShadow
        shadow-mapSize={quality === "render" ? [1024, 1024] : [2048, 2048]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-bias={-0.0004}
      />
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={1.6} color="#ffffff" position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[30, 30, 1]} />
        <Lightformer intensity={0.8} color="#dfe6ef" position={[0, 1, -8]} scale={[30, 4, 1]} />
        <Lightformer intensity={0.8} color="#dfe6ef" position={[0, 1, 8]} rotation={[0, Math.PI, 0]} scale={[30, 4, 1]} />
      </Environment>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[road.length / 2, -0.03, 0]} receiveShadow>
        <planeGeometry args={[road.length + 2000, 2000]} />
        <meshStandardMaterial color={groundColor} roughness={0.95} />
      </mesh>
      <RoadMesh road={road} />
      {spec.props.map((p, i) => {
        const meta = ASSET_MAP[p.asset];
        if (!meta) return null;
        const C = meta.component;
        const pos = road.toWorld(p.s, p.d, 0);
        return (
          <group key={i} position={pos} rotation={[0, road.heading(p.s, p.yaw), 0]}>
            <C params={{ ...meta.defaults, ...p.params }} />
          </group>
        );
      })}
      {spec.actors.map((a) => (
        <ActorNode key={a.id} actor={a} road={road} t={t} label={labels.find((l) => l.id === a.id)} showEvidence={showEvidence} />
      ))}
      {gaps.map((g, i) => (
        <Gap key={i} road={road} spec={spec} poses={poses} gap={g} />
      ))}
      {!orbit && camera && <CameraRig spec={spec} road={road} t={t} id={camera} />}
      {children}
    </>
  );
}

function lightState(actor: Actor, t: number) {
  const p0 = sampleKeys(actor.keys, t - 0.15);
  const p1 = sampleKeys(actor.keys, t + 0.15);
  const decel = (p0.speed - p1.speed) / 0.3;
  const iv = actor.lights.filter((l) => t >= l.from && t <= l.to);
  const hazard = iv.some((l) => l.mode === "hazard");
  return {
    brake: decel > 1.2 || iv.some((l) => l.mode === "brake"),
    hazard,
    hazardOn: hazard && Math.floor(t * 3) % 2 === 0,
    head: true,
  };
}

function ActorNode({ actor, road, t, label, showEvidence }: { actor: Actor; road: Road; t: number; label?: ActorLabel; showEvidence?: boolean }) {
  const meta = ASSET_MAP[actor.asset];
  const pose = sampleKeys(actor.keys, t);
  if (!meta) return null;
  const C = meta.component;
  const pos = road.toWorld(pose.s, pose.d, 0);
  const rot = road.heading(pose.s, pose.yaw);
  const [L, W, H] = meta.dims;
  const evidenceColor = { measured: "#22c55e", estimated: "#f59e0b", assumed: "#a78bfa" }[pose.evidence];
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <C params={{ ...meta.defaults, ...actor.params }} lights={lightState(actor, t)} />
      {showEvidence && (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[(actor.params.length ?? L) + 0.6, W + 0.6]} />
          <meshBasicMaterial color={evidenceColor} transparent opacity={0.28} depthWrite={false} />
        </mesh>
      )}
      {label && <TextSprite text={label.text} position={[0, H + 1.2, 0]} accent={label.color ?? evidenceColor} />}
    </group>
  );
}

function Gap({ road, spec, poses, gap }: { road: Road; spec: SceneSpec; poses: Record<string, ReturnType<typeof sampleKeys>>; gap: GapOverlay }) {
  const a = spec.actors.find((x) => x.id === gap.from);
  const b = spec.actors.find((x) => x.id === gap.to);
  if (!a || !b) return null;
  const la = (a.params.length ?? ASSET_MAP[a.asset].dims[0]) / 2;
  const lb = (b.params.length ?? ASSET_MAP[b.asset].dims[0]) / 2;
  const pa = poses[a.id], pb = poses[b.id];
  const s0 = pa.s + la, s1 = pb.s - lb;
  if (s1 <= s0) return null;
  const d = (pa.d + pb.d) / 2;
  const p0 = road.toWorld(s0, d, 0.08), p1 = road.toWorld(s1, d, 0.08);
  const mid = road.toWorld((s0 + s1) / 2, d, 0.1);
  const color = gap.color ?? "#ff3b30";
  const len = p0.distanceTo(p1);
  const ang = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
  return (
    <group>
      <mesh position={mid} rotation={[0, ang, 0]}>
        <boxGeometry args={[len, 0.03, 0.12]} />
        <meshBasicMaterial color={color} transparent opacity={0.75} depthWrite={false} />
      </mesh>
      {[p0, p1].map((p, i) => (
        <mesh key={i} position={[p.x, 0.1, p.z]} rotation={[0, ang, 0]}>
          <boxGeometry args={[0.12, 0.06, 1.4]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
      <TextSprite text={gap.label} position={[mid.x, 0.9, mid.z]} bg={color} size={0.026} />
    </group>
  );
}

/** 相机轨：follow（跟随目标车，车身坐标偏移）、mount（车载，如行车记录仪）、world（道路坐标绝对机位） */
function CameraRig({ spec, road, t, id }: { spec: SceneSpec; road: Road; t: number; id: string }) {
  const track = spec.cameras.find((c) => c.id === id);
  const { camera } = useThree();
  useFrame(() => {
    if (!track) return;
    const { pos, look, fov } = cameraAt(track, spec, road, t);
    camera.position.copy(pos);
    camera.lookAt(look);
    if ((camera as THREE.PerspectiveCamera).fov !== fov) {
      (camera as THREE.PerspectiveCamera).fov = fov;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

function lerpKeys(track: CameraTrack, t: number) {
  const ks = track.keys;
  if (t <= ks[0].t) return { a: ks[0], b: ks[0], u: 0 };
  for (let i = 0; i < ks.length - 1; i++) {
    if (t <= ks[i + 1].t) {
      const u = (t - ks[i].t) / (ks[i + 1].t - ks[i].t);
      return { a: ks[i], b: ks[i + 1], u: u * u * (3 - 2 * u) };
    }
  }
  const last = ks[ks.length - 1];
  return { a: last, b: last, u: 0 };
}

const mix3 = (a: [number, number, number] | undefined, b: [number, number, number] | undefined, u: number): [number, number, number] => {
  const A = a ?? b ?? [0, 0, 0], B = b ?? a ?? [0, 0, 0];
  return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u];
};

export function cameraAt(track: CameraTrack, spec: SceneSpec, road: Road, t: number) {
  const { a, b, u } = lerpKeys(track, t);
  const fov = a.fov + (b.fov - a.fov) * u;
  if (track.mode === "world") {
    const p = mix3(a.pos, b.pos, u);
    const l = mix3(a.lookAt, b.lookAt, u);
    return { pos: road.toWorld(p[0], p[1], p[2]), look: road.toWorld(l[0], l[1], l[2]), fov };
  }
  const actor = spec.actors.find((x) => x.id === track.target)!;
  const pose = sampleKeys(actor.keys, t);
  const base = road.toWorld(pose.s, pose.d, 0);
  const heading = road.heading(pose.s, pose.yaw);
  const fwd = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
  const left = new THREE.Vector3(0, 1, 0).cross(fwd);
  const o = mix3(a.offset, b.offset, u);
  const l = mix3(a.lookAt, b.lookAt, u);
  const pos = base.clone().addScaledVector(fwd, o[0]).addScaledVector(left, o[1]).setY(o[2]);
  const look = base.clone().addScaledVector(fwd, l[0]).addScaledVector(left, l[1]).setY(l[2]);
  return { pos, look, fov };
}
