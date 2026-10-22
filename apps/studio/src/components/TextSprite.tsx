"use client";
/** 3D 场景内的文字标签：Canvas 纹理 + Sprite，恒定屏幕尺寸，不依赖 DOM（导出截图稳定） */
import * as THREE from "three";
import { useEffect, useMemo } from "react";

export function TextSprite({ text, position, color = "#ffffff", bg = "rgba(10,12,16,0.82)", accent, size = 0.026 }: {
  text: string;
  position: [number, number, number] | THREE.Vector3;
  color?: string;
  bg?: string;
  accent?: string;
  /** 文字高度占屏幕高度的比例 */
  size?: number;
}) {
  const { tex, aspect } = useMemo(() => {
    const px = 64;
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    const font = `700 ${px}px 'Noto Sans SC','WenQuanYi Zen Hei',sans-serif`;
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + px * 0.9 + (accent ? 14 : 0);
    const h = Math.ceil(px * 1.5);
    c.width = w;
    c.height = h;
    g.font = font;
    g.fillStyle = bg;
    const r = 14;
    g.beginPath();
    g.roundRect(0, 0, w, h, r);
    g.fill();
    if (accent) {
      g.fillStyle = accent;
      g.fillRect(0, 0, 12, h);
    }
    g.fillStyle = color;
    g.textBaseline = "middle";
    g.fillText(text, px * 0.45 + (accent ? 14 : 0), h / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { tex: t, aspect: w / h };
  }, [text, color, bg, accent]);
  useEffect(() => () => tex.dispose(), [tex]);
  const pos = position instanceof THREE.Vector3 ? position.toArray() : position;
  return (
    <sprite position={pos as [number, number, number]} scale={[size * aspect * 1.5, size * 1.5, 1]} renderOrder={10}>
      <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent toneMapped={false} />
    </sprite>
  );
}
