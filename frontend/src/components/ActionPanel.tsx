import { useState } from 'react'
import type { GameState } from '../api'

interface Props {
  state: GameState
  busy: boolean
  onAct: (text: string) => void
  onSettle: () => void
}

/**
 * PRD 4.3 行动阶段。
 *
 * 概率只给模糊档位（"很有希望"），不给数字。给了数字玩家就会开始算期望、
 * 反复刷行动，把一个关于取舍的表达变成一个刷子游戏。
 */
export function ActionPanel({ state, busy, onAct, onSettle }: Props) {
  const [draft, setDraft] = useState('')
  const goal = state.本回合.目标
  const dilemma = state.本回合.困境
  const left = state.可用行动点

  if (!goal) return null

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy || left <= 0) return
    setDraft('')
    onAct(trimmed)
  }

  return (
    <>
      {dilemma && (
        <div className="dilemma">
          <div className="dilemma-head">
            <span className="dilemma-name">{dilemma.困境名}</span>
            <span className="resolve">
              <span>解决度</span>
              <span className="resolve-track">
                <span className="resolve-fill" style={{ width: `${dilemma.解决度}%` }} />
              </span>
              <span>{dilemma.解决度}%</span>
            </span>
          </div>
          <div className="dilemma-scene">{dilemma.具体场景}</div>
        </div>
      )}

      <div className="goal">
        <div className="goal-line">
          <span className="goal-kicker">本幕目标</span>
          {state.达成希望 && <span className="hope">{state.达成希望}</span>}
        </div>
        <div className="goal-text">{goal.文案}</div>
        <div className="goal-cost">
          <i>已知代价</i>
          {goal.明示代价}
        </div>
      </div>

      {left > 0 ? (
        <>
          <div className="action-row">
            {state.本回合.建议行动.map((suggestion, index) => (
              <button
                className="suggestion"
                key={`${suggestion}-${index}`}
                disabled={busy}
                onClick={() => submit(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>

          <div className="input-row">
            <input
              value={draft}
              placeholder="或者，自己写一件要做的事"
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit(draft)
              }}
            />
            <button className="ghost" disabled={busy || !draft.trim()} onClick={() => submit(draft)}>
              去做
            </button>
            <button className="ghost" disabled={busy} onClick={onSettle}>
              不做了，结算
            </button>
          </div>

          <p className="hint">
            这一幕还能做 {left} 件事（一辈子共 {state.行动点.总预算} 件，已用{' '}
            {state.行动点.已用} 件）。行动点是跨越一生的——这一幕多做，后面就少做。
          </p>
        </>
      ) : (
        <div className="input-row">
          <button className="primary" disabled={busy} onClick={onSettle}>
            这一幕到此为止 · 看看结果
          </button>
        </div>
      )}
    </>
  )
}
