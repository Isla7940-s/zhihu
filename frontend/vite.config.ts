import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 后端端口。跟启动 uvicorn 时用的 --port 保持一致，
// 换端口时用 BACKEND_PORT=xxxx npm run dev，不用改这个文件。
const backendPort = process.env.BACKEND_PORT ?? '8011'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
        // 一次 begin-turn 要串起四个 Agent，实测能到两分钟以上。
        // 不放宽超时，开发时会看到代理先把连接掐了。
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
    },
  },
})
