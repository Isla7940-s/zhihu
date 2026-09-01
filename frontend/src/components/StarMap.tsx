import { useMemo, useState } from 'react'
import type { Relationship } from '../api'
import { color } from '../theme'

interface Props {
  relationships: Relationship[]
  onClose: () => void
}

/** 关系亲疏已经用距离和亮度表达过了，色相这里只留明度差。 */
const KIND_COLOR: Record<string, string> = {
  父母: color.gray0,
  配偶: color.gray1,
  恋人: color.gray1,
  子女: color.gray2,
  手足: color.gray3,
  亲戚: color.gray3,
  朋友: color.gray4,
  同事: color.gray4,
}

const W = 660
const H = 380
const CX = W / 2
const CY = H / 2

/**
 * PRD 6.3 关系星图：亲密度映射为距离和亮度。
 * 疏远的人飘在外围、发暗；去世的角色变成灰色残影但不消失。
 */
export function StarMap({ relationships, onClose }: Props) {
  const [selected, setSelected] = useState<Relationship | null>(null)

  const nodes = useMemo(() => {
    const count = Math.max(1, relationships.length)
    return relationships.map((person, index) => {
      // 亲密度越高越靠近圆心
      const radius = 62 + (1 - person.亲密度 / 100) * 118
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2
      return {
        person,
        x: CX + Math.cos(angle) * radius * 1.42,
        y: CY + Math.sin(angle) * radius,
        radius,
      }
    })
  }, [relationships])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="starmap" onClick={(event) => event.stopPropagation()}>
        <div className="starmap-head">
          <h3>关系星图</h3>
          <button className="relbtn" onClick={onClose}>
            关闭
          </button>
        </div>
        <p className="starmap-note">
          越靠近圆心、越亮的人，离你越近。已经不在的人变成灰色，但不会从图上消失。
        </p>

        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
          <defs>
            <radialGradient id="core">
              <stop offset="0%" stopColor={color.gray0} />
              <stop offset="100%" stopColor={color.gray2} />
            </radialGradient>
          </defs>

          {[80, 130, 180].map((r) => (
            <ellipse
              key={r}
              cx={CX}
              cy={CY}
              rx={r * 1.42}
              ry={r}
              fill="none"
              stroke={color.gray8}
              strokeDasharray="2 5"
            />
          ))}

          {nodes.map(({ person, x, y }) => {
            const dead = !person.存活
            const alpha = dead ? 0.18 : 0.16 + (person.亲密度 / 100) * 0.62
            const tone = dead ? color.gray6 : KIND_COLOR[person.关系类型] ?? color.gray4
            return (
              <line
                key={`link-${person.角色}`}
                x1={CX}
                y1={CY}
                x2={x}
                y2={y}
                stroke={tone}
                strokeOpacity={alpha}
                strokeWidth={dead ? 1 : 1 + (person.亲密度 / 100) * 1.8}
                strokeDasharray={dead ? '3 4' : undefined}
              />
            )
          })}

          <circle cx={CX} cy={CY} r={17} fill="url(#core)" />
          <text x={CX} y={CY + 4} textAnchor="middle" fontSize="11" fill={color.gray12} fontWeight="700">
            你
          </text>

          {nodes.map(({ person, x, y }) => {
            const dead = !person.存活
            const tone = dead ? color.gray7 : KIND_COLOR[person.关系类型] ?? color.gray4
            const brightness = dead ? 0.3 : 0.4 + (person.亲密度 / 100) * 0.6
            return (
              <g
                key={person.角色}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(person)}
                opacity={brightness}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={7 + (dead ? 0 : (person.亲密度 / 100) * 5)}
                  fill={tone}
                  stroke={selected?.角色 === person.角色 ? color.gray1 : 'none'}
                  strokeWidth={1.5}
                />
                <text x={x} y={y - 15} textAnchor="middle" fontSize="12" fill={color.gray1}>
                  {person.角色}
                  {dead ? ' ·' : ''}
                </text>
                <text x={x} y={y + 24} textAnchor="middle" fontSize="10" fill={color.gray4}>
                  {dead ? '已经不在了' : person.亲密度}
                </text>
              </g>
            )
          })}
        </svg>

        <div className="person-detail">
          {selected ? (
            <>
              <strong>
                {selected.角色}
                <span style={{ color: color.textFaint, fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
                  {selected.关系类型} · 亲密度 {selected.亲密度}
                  {selected.存活 ? '' : ' · 已故'}
                </span>
              </strong>
              <p>{selected.态度 || '没什么好说的'}</p>
            </>
          ) : (
            <p style={{ color: color.textFaint, margin: 0 }}>点一个人，看他现在怎么看你。</p>
          )}
        </div>
      </div>
    </div>
  )
}
