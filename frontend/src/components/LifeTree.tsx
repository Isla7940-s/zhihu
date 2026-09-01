import type { TreeNode } from '../api'
import { color } from '../theme'

interface Props {
  tree: TreeNode[]
  currentAge: number
  totalTurns: number
}

const TIER_COLOR: Record<string, string> = {
  大成功: color.tierGreat,
  成功: color.tierSuccess,
  勉强: color.tierBarely,
  失败: color.tierFail,
}

const ROW = 100
const TRUNK = 34
const TOP = 34

/**
 * PRD 6.4 人生事件树：主干是走过的路，未选分支虚线灰显。
 *
 * 这个组件直接服务于产品目的——让玩家看见他这次选择舍弃了什么。
 * 舍弃不需要用文字讲，画出来就行。
 */
export function LifeTree({ tree, currentAge, totalTurns }: Props) {
  const hereY = TOP + tree.length * ROW
  const height = Math.max(tree.length + 1, totalTurns) * ROW + 60
  const width = 262

  return (
    <div className="tree-pane">
      <div className="pane-title">人生事件树</div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
        <defs>
          {/* 走过的路是暖的，还没走的那截淡出去 */}
          <linearGradient id="trunk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color.gray0} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color.gray0} stopOpacity="0.12" />
          </linearGradient>
          <radialGradient id="halo">
            <stop offset="0%" stopColor={color.gray0} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color.gray0} stopOpacity="0" />
          </radialGradient>
        </defs>

        {tree.length > 0 && (
          <line
            x1={TRUNK}
            y1={TOP}
            x2={TRUNK}
            y2={hereY}
            stroke="url(#trunk)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}

        {tree.map((node, index) => {
          const y = TOP + index * ROW
          const tone = node.结算档位 ? TIER_COLOR[node.结算档位] ?? color.gray4 : color.gray5
          return (
            <g key={`${node.回合}-${node.年龄}`}>
              {node.未选分支.map((branch, order) => {
                const branchY = y + 30 + order * 22
                return (
                  <g key={branch} className="tree-branch">
                    <path
                      d={`M ${TRUNK} ${y + 8} C ${TRUNK} ${branchY}, ${TRUNK + 12} ${branchY}, ${TRUNK + 21} ${branchY}`}
                      fill="none"
                      stroke={color.gray7}
                      strokeWidth={1}
                      strokeDasharray="2.5 3.5"
                    />
                    <circle cx={TRUNK + 23} cy={branchY} r={1.8} fill={color.gray6} />
                    <text x={TRUNK + 31} y={branchY + 3.5} fontSize="10.5" fill={color.gray4}>
                      {truncate(branch, 19)}
                    </text>
                  </g>
                )
              })}

              {node.结算档位 && (
                <text
                  x={TRUNK + 17}
                  y={y - 12}
                  fontSize="9.5"
                  fill={tone}
                  letterSpacing="1.5"
                  fontWeight={500}
                >
                  {node.结算档位}
                  {node.结算概率 !== null ? ` · P${node.结算概率} 骰 ${node.骰值}` : ''}
                </text>
              )}

              <circle cx={TRUNK} cy={y} r={13} fill="url(#halo)" />
              <circle cx={TRUNK} cy={y} r={7} fill={color.gray12} stroke={tone} strokeOpacity={0.45} />
              <circle cx={TRUNK} cy={y} r={3.6} fill={tone} />

              <text
                x={TRUNK - 17}
                y={y + 4}
                textAnchor="end"
                fontSize="10.5"
                fill={color.gray4}
                letterSpacing="0.5"
              >
                {node.年龄}
              </text>
              <text x={TRUNK + 17} y={y + 4.5} fontSize="12.5" fill={color.gray1} fontWeight={500}>
                {truncate(node.已选决策, 18)}
              </text>
            </g>
          )
        })}

        {/* 你在这里 */}
        <g>
          <line
            x1={TRUNK}
            y1={hereY}
            x2={TRUNK}
            y2={hereY + 44}
            stroke={color.gray8}
            strokeWidth={1.5}
            strokeDasharray="3 5"
            strokeLinecap="round"
          />
          <circle cx={TRUNK} cy={hereY} r={16} fill="url(#halo)" />
          <circle
            className="tree-pulse"
            cx={TRUNK}
            cy={hereY}
            r={9}
            fill="none"
            stroke={color.gray0}
            strokeWidth={1.2}
          />
          <circle cx={TRUNK} cy={hereY} r={4.5} fill={color.gray12} stroke={color.gray0} strokeWidth={1.4} />
          <circle cx={TRUNK} cy={hereY} r={1.8} fill={color.gray0} />
          <text
            x={TRUNK - 17}
            y={hereY + 4}
            textAnchor="end"
            fontSize="10.5"
            fill={color.gray0}
            letterSpacing="0.5"
          >
            {currentAge}
          </text>
          <text x={TRUNK + 17} y={hereY + 4.5} fontSize="11.5" fill={color.gray0} letterSpacing="1.5">
            你在这里
          </text>
        </g>
      </svg>
    </div>
  )
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
