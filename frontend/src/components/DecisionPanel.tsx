import type { DecisionOption, TurnDilemma } from '../api'

interface Props {
  dilemma: TurnDilemma | null
  options: DecisionOption[]
  busy: boolean
  onChoose: (index: number) => void
}

const NUMERAL = ['壹', '贰', '叁']

/**
 * PRD 4.2：困境必须先于决策呈现——玩家得先知道自己被什么卡住了，
 * 三个选项才算"权衡"而不是"猜谜"。
 *
 * 每个选项都显示明示代价。这是产品的核心主张：没有免费的选择。
 */
export function DecisionPanel({ dilemma, options, busy, onChoose }: Props) {
  return (
    <div className="decide">
      <div className="dilemma">
        {dilemma && (
          <>
            <div className="dilemma-head">
              <span className="dilemma-kicker">眼下卡住你的</span>
              <span className="dilemma-name">{dilemma.困境名}</span>
            </div>
            <div className="dilemma-scene">{dilemma.具体场景}</div>
            {dilemma.解决度 > 0 && (
              <span className="resolve">
                <span>上一幕留下的</span>
                <span className="resolve-track">
                  <span className="resolve-fill" style={{ width: `${dilemma.解决度}%` }} />
                </span>
                <span>{dilemma.解决度}%</span>
              </span>
            )}
          </>
        )}
        <p className="hint">三条路都有代价，没有哪条是「对」的。放弃的路会留在左边的事件树上。</p>
      </div>

      <div className="options">
        {options.map((option, index) => (
          <button
            className="option"
            key={`${option.文案}-${index}`}
            disabled={busy}
            onClick={() => onChoose(index)}
          >
            <span className="option-index">其{NUMERAL[index] ?? index + 1}</span>
            <span className="option-body">
              <span className="option-text">{option.文案}</span>
              <span className="option-cost">
                <i>代价</i>
                {option.明示代价}
              </span>
            </span>
            <span className="option-meta">
              <span>往后 {option.时间跨度} 年</span>
              {Object.entries(option.代价delta).map(([name, value]) => (
                <span key={name}>
                  {name} −{Math.abs(value)}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
