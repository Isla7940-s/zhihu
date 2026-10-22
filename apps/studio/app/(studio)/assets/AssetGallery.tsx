"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { ASSETS } from "@/assets3d/registry";

const AssetStage = dynamic(() => import("@/components/AssetStage").then((m) => m.AssetStage), { ssr: false });

export function AssetGallery() {
  return (
    <div className="grid cards">
      {ASSETS.map((a) => <AssetCard key={a.id} id={a.id} />)}
    </div>
  );
}

function AssetCard({ id }: { id: string }) {
  const meta = ASSETS.find((x) => x.id === id)!;
  const [params, setParams] = useState<Record<string, any>>({ ...meta.defaults });
  const [brake, setBrake] = useState(false);
  const dimDefault = (key: string) => ({ length: meta.dims[0], width: meta.dims[1], height: meta.dims[2] } as Record<string, number>)[key] ?? meta.defaults[key] ?? 0;
  return (
    <div className="card asset-card">
      <div className="stage">
        <AssetStage id={id} params={params} lights={{ brake, head: true }} />
      </div>
      <div className="body">
        <h3>{meta.name} <span className="chip mono">{meta.id}</span></h3>
        <div className="meta">{meta.dims.map((d) => d.toFixed(2)).join(" × ")} m · {meta.description}</div>
        {meta.knobs?.map((k) => (
          <div key={k.key} className="knob">
            <span>{k.label}</span>
            {k.type === "color" && <input type="color" value={params[k.key] ?? "#ffffff"} onChange={(e) => setParams({ ...params, [k.key]: e.target.value })} />}
            {k.type === "number" && (
              <input type="range" min={k.min} max={k.max} step={k.step} value={params[k.key] ?? dimDefault(k.key)}
                onChange={(e) => setParams({ ...params, [k.key]: +e.target.value })} />
            )}
            {k.type === "select" && (
              <select value={params[k.key]} onChange={(e) => setParams({ ...params, [k.key]: e.target.value })}>
                {k.options!.map((o) => <option key={o}>{o}</option>)}
              </select>
            )}
            <span className="mono">{k.type === "number" ? Number(params[k.key] ?? dimDefault(k.key)).toFixed(2) : ""}</span>
          </div>
        ))}
        {meta.category === "vehicle" && (
          <label className="knob" style={{ cursor: "pointer" }}>
            <span>刹车灯</span>
            <input type="checkbox" checked={brake} onChange={(e) => setBrake(e.target.checked)} />
            <span />
          </label>
        )}
        <pre className="code">{JSON.stringify({ asset: meta.id, params }, null, 0)}</pre>
      </div>
    </div>
  );
}
