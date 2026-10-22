# crashlab — 事故视频解析 · 三维重建 · 自动成片

把一段事故视频（行车记录仪 / 监控）变成一条**带误差区间**的竖屏解析视频：

```
证据视频 ──► 取证（真实帧/时间轴） ──► 测量（虚线测速、前车测距、蒙特卡洛） ──► analysis.json
                                                                             │
人工标注（Studio 证据页） ──────────────────────────────────────────────────────┤
                                                                             ▼
                        scene.json（三维重建，关键帧标注 实测/推算/示意推定） ──► Studio 3D
                                                                             │
                 story.json（分镜，数字全用占位符） ──► 审查闸门 ──► Piper 配音 ──► 逐帧渲染 ──► mp4
```

| 目录 | 作用 |
| --- | --- |
| `crashlab/` | Python 分析引擎：取证、单目几何、虚线测速、前车测距、碰撞物理、配音、合规审查 |
| `apps/studio/` | Next.js + three.js 工作台：案例证据逐帧复核、测量图表、三维重建编辑、可复用资产库、成片渲染页 |
| `cases/<id>/` | 一个案例：`case.yaml`（元信息+标注）、`scene.json`、`story.json`、`out/` |
| `.claude/skills/accident-reconstruction/` | 整条工作流的 Skill（给 Claude 用的操作手册 + 方法参考） |
| `tests/` | 几何、测速、取证、物理、脚本占位符的单元测试 |

## 快速开始

```bash
pip install -r requirements.txt
scripts/fetch_voice.sh                       # Piper 中文语音模型（离线 TTS）
cd apps/studio && npm install && cd -

# 把视频放到 cases/<id>/evidence/source.mp4，参照模板写 case.yaml
python -m crashlab all cases/<id>            # 分析 → 抽帧 → 审查 → 配音

cd apps/studio
npm run build && npm start &                 # http://localhost:3000
node scripts/render-video.mjs <id> --workers 3   # → cases/<id>/out/<id>.mp4
```

## 示例案例：`cases/fog-highway-sandwich`

浓雾高速，行车记录仪视角，小车最终被自卸车与平头货车夹在中间（画面在冲击瞬间中断）。

主要结论（主假设 3 m + 9 m 虚线，括号为 90% 区间）：

- 本车约 **67 km/h**（63–71）；若为国标高速 6+9 规格则约 83 km/h。实测虚线占空比 18%，更接近前者。
- 1.4 s 时与前方自卸车相距约 **10.6 m**（7.9–13.8），车头时距 **0.56 s**（0.42–0.72）——这个量与标线规格无关。
- 湿滑路面停车所需距离约 57 m（47–68），远大于当时车距。
- 7 s 之后的三维重建为示意推定；碰撞先后、伤亡与责任无法从单段视频确定，成片不做推测。

素材来自抖音 @NDMZS.GS3Y，**未取得授权，仅作内部方法演示**；网传“冰岛”在画面中无依据，地点未核实。
