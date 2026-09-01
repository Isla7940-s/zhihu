# 前端

React + TypeScript + Vite。

## 开发时怎么跑

两个进程，各管各的：

```bash
# 1. 后端只提供 /api，端口固定 8011
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8011

# 2. 前端开发服务器，改代码即时生效
cd frontend && npm run dev
```

然后开 <http://localhost:5173>，改任何 `.tsx` / `.css` 都会热更新，不需要重新构建。
页面里的 `/api` 请求由 Vite 代理转给 8011（见 `vite.config.ts`）。

后端换了端口就用 `BACKEND_PORT=xxxx npm run dev`，不用改配置文件。

## 构建产物怎么跑

`npm run build` 会把产物写进 `dist/`，后端在 `FRONTEND_DIST` 存在时会直接把它托管在
8011 的根路径上。这条路适合演示和验收——只起一个进程就能看到完整的东西，
但它没有热更新，每次改动都要重新 build。**日常改界面请用上面的开发服务器。**

入口页 `index.html` 由后端加了 `Cache-Control: no-store`。它引用的 JS/CSS 文件名
带内容 hash，如果这张入口页被浏览器缓存住，重新构建的前端就永远送不到浏览器上。

## 目录

- `src/components/` —— 按界面区块划分，一个文件一块
- `src/styles.css` —— 全部样式。所有颜色集中在开头的 `:root`，
  组件里不写死颜色，SVG 也用 `var(--x)`。改主题只动那一段。
- `src/api.ts` —— 后端契约，字段名沿用 PRD 的中文 schema
