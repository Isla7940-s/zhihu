import type { GameState } from '../api'
import { color } from '../theme'

/** 四条状态各差一档明度：名字就写在旁边，不需要再靠色相去认。 */
const DIM_COLOR: Record<string, string> = {
  财富: color.gray1,
  健康: color.gray2,
  心力: color.gray3,
  声望: color.gray4,
}

function stage(age: number): string {
  if (age < 26) return '刚毕业'
  if (age < 33) return '立足'
  if (age < 42) return '成家'
  if (age < 52) return '中年'
  if (age < 62) return '转折'
  if (age < 70) return '退休'
  return '暮年'
}

interface Props {
  state: GameState
  onOpenStarMap: () => void
}

/** PRD 6.2：长期状态用细线而非大数字，状态栏是氛围，不是仪表盘。 */
export function StatusBar({ state, onOpenStarMap }: Props) {
  const points = state.行动点
  const left = points.总预算 - points.已用
  const alive = state.关系网络.filter((person) => person.存活).length
  const act = state.meta.回合 === 0 ? '序幕' : `第 ${state.meta.回合} / ${state.meta.总回合} 幕`

  return (
    <header className="statusbar">
      <div className="sb-left">
        <span className="sb-age">
          {state.meta.当前年龄}
          <i>岁</i>
        </span>
        <span className="sb-meta">
          {act} · {stage(state.meta.当前年龄)}
        </span>
      </div>

      <div className="sb-stats">
        {Object.entries(state.长期状态).map(([name, value]) => (
          <div className="stat" key={name}>
            <div className="stat-head">
              <span className="stat-name">{name}</span>
              <span className="stat-value">{value}</span>
            </div>
            <span className="stat-track">
              <i style={{ width: `${value}%`, background: DIM_COLOR[name] ?? color.gray3 }} />
            </span>
          </div>
        ))}
      </div>

      <div className="sb-right">
        <div
          className="points"
          title={`一辈子共 ${points.总预算} 点：每回合保底 ${points.本回合保底} 点，自由池 ${points.自由池剩余} 点`}
        >
          <span className="points-label">行动点</span>
          <span className="pips">
            {Array.from({ length: points.总预算 }, (_, index) => (
              <i key={index} className={`pip${index < left ? ' on' : ''}`} />
            ))}
          </span>
          <span className="points-num">{left}</span>
        </div>

        <button className="relbtn" onClick={onOpenStarMap}>
          关系 · {alive} 人
        </button>
      </div>
    </header>
  )
}
