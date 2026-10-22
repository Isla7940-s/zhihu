---
name: accident-reconstruction
description: 把一段事故视频（行车记录仪或固定监控）做成带误差区间的解析 + 三维重建 + 配音竖屏成片。用于“事故还原/事故解析/算车速/三维重建/出一条事故分析视频”这类请求。覆盖取证、测量、重建、合规审查、配音、渲染全链路，产物落在 cases/<id>/ 与 apps/studio。
---

# 事故重建流水线（crashlab）

目标：**一条 1–2.5 分钟的竖屏解析视频**，每个数字都能追溯到视频证据，每个推定都在画面上标明。
可信度是这类内容唯一的护城河——宁可少说，不可说错。

## 0. 开工前（必须）

1. 看清素材：`ffprobe` 看帧率/时长；按 0.25 s 抽帧拼图逐段看完（含黑场、片尾广告）。
2. 写下**能从画面确认的事实**和**不能确认的事**。地点、日期、伤亡、责任默认都是“未知”。
   网传说法（“冰岛”“某某路”）没有画面或可靠报道支撑时，一律写“未核实”。
3. 素材授权写进 `case.yaml > case.source.rights`。未授权素材只能做内部演示，审查闸门会标记。

## 1. 建案例目录

```
cases/<id>/
  case.yaml      元信息 + 人工标注 + 分析参数（模板：references/case-template.yaml）
  evidence/      原始视频（不入库，见 .gitignore）
  scene.json     三维重建（第 4 步）
  story.json     分镜脚本（第 5 步）
```

`case.yaml` 的 `annotations` 是“人在回路”的部分：地平线、车道线、虚线检测区、前车初始位置、事件时间线。
用 Studio 工作台（`/cases/<id>` 的证据页）逐帧确认后填写；数值要能被别人复核。

## 2. 取证 + 测量

```bash
python -m crashlab analyze cases/<id>     # → out/analysis.json
```

- **取证**：平台转码会把 25/30 fps 补成 60 fps。重复帧必须剔除，时刻不确定度取“真实帧停留时长的一半”。
- **测速（运动相机）**：车道虚线是尺子。v = 周期长度 P ÷ 相邻两段扫过同一行的时间差。
  P 取决于标线规格——**必须并列给出所有合理规格的结果**，用实测占空比（线段时长/周期）选主假设。
- **测距**：前车已知宽度（货车 2.5 m、轿车约 1.8 m）+ 由虚线与车道宽反推的焦距 → 距离、接近速度、TTC。
- **与尺度无关的量优先讲**：车头时距 = 车距 ÷ 本车速度，不受标线规格假设影响，是最硬的结论。
- 所有输入不确定度进蒙特卡洛，输出 median + p05/p95。旁白、字幕只引用这些数。

方法细节与几何推导：`references/methods.md`。固定机位（CCTV）走单视图标定（`crashlab/geometry.py:calibrate_from_ground`）。

## 3. 抽帧给 Studio

```bash
python -m crashlab frames cases/<id>      # → apps/studio/public/cases/<id>/frames/
```

平台水印按 `evidence.watermark_boxes` 打码。

## 4. 三维重建（scene.json）

- 道路用中心线控制点 + 车道数/宽 + 虚线规格描述；车辆轨迹用**道路坐标 (s, d, yaw)** 写关键帧。
- 资产从注册表取（`apps/studio/src/assets3d/registry.ts`）：`sedan` `van` `box-truck` `dump-truck`
  `flat-nose-truck` `traffic-light` `street-lamp` `guardrail` `traffic-cone` `warning-triangle`。
  缺资产就新增组件 + 登记一行，别在场景里临时拼。
- **每个关键帧标 evidence**：`measured`（测得）/ `estimated`（由测量推算）/ `assumed`（示意推定）。
  `notes` 里写清每段的依据。成片会用绿/橙/紫底色区分。
- 测量段的位置直接由 analysis.json 换算（车头到相机偏移 + 车距 + 半车长）。
  画面看不出来的东西（碰撞先后、受力、结果）**不要演**；需要示意时标 `assumed` 并在旁白里说明。
- 在 Studio 的“三维重建”页拖时间轴、切机位、改关键帧并保存。

## 5. 分镜脚本（story.json）

- 一个镜头 = 一句旁白 + 一个画面（title / evidence / method / stat / chart / scene3d / timeline / lesson / end）。
- **旁白里不准写死阿拉伯数字**，一律用 `{占位符}`（见 `crashlab/story.py:story_vars`），保证配音、字幕、图表一致。
- 结构建议：钩子 → 原视频 → 要回答的问题 → 方法四步 → 每步一个结论 → 三维重建 → 局限声明 → 可带走的建议 → 免责。
- 语气：克制、可验证。禁用定罪式/绝对化措辞（审查闸门有词表），不消费伤亡。

## 6. 审查 → 配音 → 渲染

```bash
python -m crashlab review cases/<id>      # 不通过就停
python -m crashlab tts cases/<id>         # Piper 离线中文配音 + 时间轴
cd apps/studio && npm run build && npm start &
node scripts/render-video.mjs <id> --workers 3   # → cases/<id>/out/<id>.mp4
```

一条龙：`python -m crashlab all cases/<id>` 后再渲染。渲染在纯 CPU（SwiftShader）下约 0.8 s/帧（3D 镜头），2D 镜头约 0.15 s/帧。

## 7. 交付前自检

- [ ] 抽 6–8 帧成片截图看过：字幕不遮挡、标签不重叠、3D 机位没有被近处车辆挡住。
- [ ] 每个数字在 analysis.json 里能找到，区间写在画面上。
- [ ] 示意推定段有画面标注 + 旁白说明。
- [ ] `out/review.json` 通过；`publishable=false` 时只作内部演示，告知用户授权问题。

## 参考

- `references/methods.md` — 测量方法、几何推导、误差来源
- `references/case-template.yaml` — 新案例模板
- `references/assets.md` — 资产约定与新增资产步骤
