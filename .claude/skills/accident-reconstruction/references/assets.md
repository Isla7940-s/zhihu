# 3D 资产约定

位置：`apps/studio/src/assets3d/`（`vehicles.tsx` 车辆、`infrastructure.tsx` 设施与道路、`parts.tsx` 共用零件）。

- 原点在物体几何中心正下方的地面；车头朝 +X，车宽沿 Z，Y 向上；单位米。
- 组件签名：`({ params, lights }) => JSX`。`params` 覆盖 registry 里的 `defaults`；`lights` 由场景时间轴给出（刹车/双闪）。
- 材质从 `mat.*` 取（带缓存），不要在组件里 new 材质。
- 圆角盒用 `RBox`（外形尺寸严格等于参数），轿车类用侧面轮廓挤出（`profileWithArches`）。

新增资产：
1. 在对应文件写组件，尺寸全部参数化。
2. 在 `registry.ts` 的 `ASSETS` 里登记 id、中文名、dims、defaults、knobs、说明。
3. 打开 Studio `/assets` 检查转台预览，调参数确认没有穿模。

道路：`RoadSpec`（中心线控制点、车道数/宽、虚线规格、路肩、护栏、路面干湿）由 `RoadMesh` 自动生成路面、标线和护栏。
