import type { Settlement } from '../api'

interface Props {
  result: Settlement
  ended: boolean
  busy: boolean
  onNext: () => void
}

/**
 * PRD 4.5 四档结算。
 *
 * 四档表达的是"目标达成到什么程度"，不是"玩家表现打几分"。
 * 所以四档都要显示代价——包括大成功。这是产品的立场，不是平衡性设计。
 */
export function SettlementPanel({ result, ended, busy, onNext }: Props) {
  const deltas = Object.entries(result.长期状态变化).filter(([, value]) => value !== 0)

  return (
    <>
      <div className="settle">
        <div className="settle-main">
          <span className={`tier ${result.档位}`}>{result.档位}</span>
          <span className="settle-info">
            <span className="roll">
              命运骰 {result.骰值} · 需要不超过 {result.结算概率}
            </span>
            <span className="roll">
              {result.年龄.从} 岁 — {result.年龄.到} 岁
            </span>
          </span>
        </div>

        <div className="settle-cost">{result.代价文案}</div>

        <div className="deltas">
          {deltas.map(([name, value]) => (
            <span className={`delta ${value > 0 ? 'up' : 'down'}`} key={name}>
              {name} {value > 0 ? '+' : ''}
              {value}
            </span>
          ))}
          {/* 伤疤值由引擎给出时已经带负号，不要再补一个 */}
          {Object.entries(result.伤疤).map(([name, value]) => (
            <span className="delta down" key={`scar-${name}`}>
              {name}伤疤 {value}
            </span>
          ))}
          {deltas.length === 0 && Object.keys(result.伤疤).length === 0 && (
            <span className="delta">长期状态没有明显变化</span>
          )}
        </div>

        {result.困境带入下回合 && (
          <p className="hint">这件事没有真正解决。它会原封不动地跟到下一个阶段。</p>
        )}
      </div>

      <button className="primary" disabled={busy} onClick={onNext}>
        {ended ? '看看这一生' : '往下走'}
      </button>
    </>
  )
}
