import { useState } from 'react'
import type { GameState, Settlement } from '../api'
import { ActionPanel } from './ActionPanel'
import { DecisionPanel } from './DecisionPanel'
import { EventCards } from './EventCards'
import { LifeTree } from './LifeTree'
import { SettlementPanel } from './SettlementPanel'
import { StarMap } from './StarMap'
import { StatusBar } from './StatusBar'

interface Props {
  state: GameState
  settlement: Settlement | null
  busy: boolean
  busyLabel: string
  error: string | null
  onBeginTurn: () => void
  onChoose: (index: number) => void
  onAct: (text: string) => void
  onSettle: () => void
  onNext: () => void
}

export function GameScreen({
  state,
  settlement,
  busy,
  busyLabel,
  error,
  onBeginTurn,
  onChoose,
  onAct,
  onSettle,
  onNext,
}: Props) {
  const [starMap, setStarMap] = useState(false)
  const first = state.meta.回合 === 0

  return (
    <div className="game">
      <StatusBar state={state} onOpenStarMap={() => setStarMap(true)} />

      <div className={`main${first ? ' is-prologue' : ''}`}>
        <LifeTree
          tree={state.事件树}
          currentAge={state.meta.当前年龄}
          totalTurns={state.meta.总回合}
        />

        <div className="cards-pane">
          {first ? (
            <div className="center-stage">
              <span className="cs-kicker">序幕</span>
              <h2>
                {state.meta.当前年龄} 岁，{state.meta.身份文案}
              </h2>
              <p>
                你打算证明的是——{state.meta.立场文案}。
                <br />
                接下来 {state.meta.总回合} 幕人生，每一幕都会有一件事逼你选。
              </p>
            </div>
          ) : (
            <EventCards
              cards={state.事件卡}
              turn={state.meta.回合}
              age={state.meta.当前年龄}
              history={state.事件树}
            />
          )}
        </div>
      </div>

      <div className="dock">
        <div className="dock-inner">
          {error && <div className="error">{error}</div>}

          {busy ? (
            <div className="loading">
              <span className="spinner" />
              <span>{busyLabel}</span>
            </div>
          ) : settlement ? (
            <SettlementPanel
              result={settlement}
              ended={state.阶段 === 'ended'}
              busy={busy}
              onNext={onNext}
            />
          ) : state.阶段 === 'decision' ? (
            <DecisionPanel
              dilemma={state.本回合.困境}
              options={state.本回合.待选决策}
              busy={busy}
              onChoose={onChoose}
            />
          ) : state.阶段 === 'action' || state.阶段 === 'settlement' ? (
            <ActionPanel state={state} busy={busy} onAct={onAct} onSettle={onSettle} />
          ) : (
            <button className="primary solo" onClick={onBeginTurn}>
              {first ? '走出第一步' : '继续往下走'}
            </button>
          )}
        </div>
      </div>

      {starMap && (
        <StarMap relationships={state.关系网络} onClose={() => setStarMap(false)} />
      )}
    </div>
  )
}
