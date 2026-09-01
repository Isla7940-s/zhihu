import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// 不开 StrictMode：它会把 effect 跑两遍，而这里的 effect 会触发真实的
// Agent 调用和语音合成，跑两遍既烧钱又会让旁白重叠。
createRoot(document.getElementById('root')!).render(<App />)
