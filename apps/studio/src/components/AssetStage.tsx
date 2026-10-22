"use client";
/** 资产预览台：转台 + 影棚光 + 接触阴影 */
import { Canvas } from "@react-three/fiber";
import { Bounds, ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { ASSET_MAP } from "@/assets3d/registry";
import type { LightState } from "@/assets3d/parts";

export function AssetStage({ id, params, lights, autoRotate = true }: { id: string; params: Record<string, any>; lights?: LightState; autoRotate?: boolean }) {
  const meta = ASSET_MAP[id];
  const C = meta.component;
  const [L, , H] = meta.dims;
  const size = Math.max(L, H, 3);
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [size * 0.95, size * 0.55, size * 0.95], fov: 40 }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, preserveDrawingBuffer: true }}>
      <color attach="background" args={["#c9d0d8"]} />
      <hemisphereLight args={["#ffffff", "#8a9099", 1.0]} />
      <directionalLight position={[6, 10, 4]} intensity={1.4} castShadow />
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={2} position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 10, 1]} />
        <Lightformer intensity={1} position={[-5, 1, -1]} rotation={[0, Math.PI / 2, 0]} scale={[10, 2, 1]} />
        <Lightformer intensity={1} position={[5, 1, 1]} rotation={[0, -Math.PI / 2, 0]} scale={[10, 2, 1]} />
      </Environment>
      <Bounds fit clip margin={1.15}>
        <C params={params} lights={lights} />
      </Bounds>
      <ContactShadows position={[0, 0.001, 0]} opacity={0.55} scale={size * 2.2} blur={2.2} far={4} />
      <OrbitControls makeDefault autoRotate={autoRotate} autoRotateSpeed={0.8} target={[0, H * 0.4, 0]} enablePan={false} />
    </Canvas>
  );
}
