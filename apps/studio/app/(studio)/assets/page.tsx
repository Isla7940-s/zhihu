import { AssetGallery } from "./AssetGallery";

export default function AssetsPage() {
  return (
    <div className="page">
      <h1>资产库</h1>
      <p className="sub">参数化 3D 资产，scene.json 里用 asset id 引用。新增资产：写一个组件，再到 src/assets3d/registry.ts 登记。</p>
      <AssetGallery />
    </div>
  );
}
