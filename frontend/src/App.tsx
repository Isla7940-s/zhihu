import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { GameState, Motif, Settlement, ZhihuTopic } from './api'
import { EndingScreen } from './components/EndingScreen'
import { GameScreen } from './components/GameScreen'
import { ZhihuEntry } from './components/ZhihuEntry'
import './styles.css'

/**
 * Agent 调用是真的慢（单次十几到几十秒），所以每个等待都必须有一句
 * 说明"在等什么"。否则玩家会以为卡死了，然后反复点。
 */
const LABEL = {
  start: '正在铺开这一生…',
  turn: '这几年正在过去…',
  decide: '正在想清楚眼前有哪几条路…',
  act: '正在发生…',
  settle: '正在结算这一段…',
  ending: '正在为这一生写一张卡片…',
}

export default function App() {
  const [topic, setTopic] = useState<ZhihuTopic | null>(null)
  const [motif, setMotif] = useState<Motif | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [busyLabel, setBusyLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')

  const busy = busyLabel !== ''

  useEffect(() => {
    Promise.all([api.topic(), api.motifs()])
      .then(([loadedTopic, motifs]) => {
        setTopic(loadedTopic)
        setMotif(motifs[0] ?? null)
      })
      .catch((cause: Error) => setError(cause.message))

    // 页面刷新不该把人一辈子刷没了：会话还在服务端，续上即可。
    const saved = sessionStorage.getItem('life-session')
    if (saved) {
      api
        .session(saved)
        .then(setState)
        .catch(() => sessionStorage.removeItem('life-session'))
    }
  }, [])

  /** 所有后端调用都走这里：统一管 busy 标签和错误，避免每个 handler 各写一遍。 */
  const run = useCallback(
    async (label: string, task: () => Promise<GameState>, after?: (next: GameState) => void) => {
      setBusyLabel(label)
      setError(null)
      try {
        const next = await task()
        setState(next)
        after?.(next)
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setBusyLabel('')
      }
    },
    [],
  )

  const start = (stanceId: string, identityId: string) => {
    if (!motif) return
    run(LABEL.start, () => api.start(motif.母题ID, stanceId, identityId), (next) => {
      sessionStorage.setItem('life-session', next.会话ID)
    })
  }

  const beginTurn = () => {
    if (!state) return
    setSettlement(null)
    run(LABEL.turn, () => api.beginTurn(state.会话ID))
  }

  const choose = (index: number) => {
    if (!state) return
    run(LABEL.decide, () => api.decide(state.会话ID, index))
  }

  const act = (text: string) => {
    if (!state) return
    run(LABEL.act, () => api.act(state.会话ID, text))
  }

  const settle = () => {
    if (!state) return
    const last = state.meta.回合 >= state.meta.总回合
    run(last ? LABEL.ending : LABEL.settle, () => api.settle(state.会话ID), (next) => {
      setSettlement(next.结算 ?? null)
    })
  }

  const next = () => {
    if (state?.阶段 === 'ended') {
      setSettlement(null)
      return
    }
    beginTurn()
  }

  const regret = (text: string) => {
    if (!state) return
    api.regret(state.会话ID, text).then(setState).catch(() => {
      /* 留言失败不影响任何东西，不打扰玩家 */
    })
  }

  const restart = () => {
    sessionStorage.removeItem('life-session')
    setState(null)
    setSettlement(null)
    setError(null)
  }

  // 终局：字幕和卡片，不再显示回合界面
  if (state?.阶段 === 'ended' && state.人生卡片 && !settlement) {
    return <EndingScreen card={state.人生卡片} onRegret={regret} onRestart={restart} />
  }

  if (state) {
    return (
      <GameScreen
        state={state}
        settlement={settlement}
        busy={busy}
        busyLabel={busyLabel}
        error={error}
        onBeginTurn={beginTurn}
        onChoose={choose}
        onAct={act}
        onSettle={settle}
        onNext={next}
      />
    )
  }

  if (!topic || !motif) {
    return (
      <div className="booting">
        {error ? <div className="error">{error}</div> : <span className="spinner" />}
      </div>
    )
  }
  if (!configured) return <div className="booting"><div className="embed"><h2>配置模型</h2><input placeholder="API Key" type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} /><input placeholder="Base URL，例如 https://api.openai.com/v1" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} /><input placeholder="模型名称" value={model} onChange={e=>setModel(e.target.value)} /><button className="primary" disabled={!apiKey||!baseUrl||!model} onClick={()=>api.configure(apiKey,baseUrl,model).then(()=>setConfigured(true)).catch(e=>setError(e.message))}>保存并开始</button>{error&&<div className="error">{error}</div>}</div></div>

  return (
    <ZhihuEntry topic={topic} motif={motif} busy={busy} error={error} onStart={start} />
  )
}
