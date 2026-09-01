import { useEffect, useRef, useState } from 'react'
import type { EventCard as Card, TreeNode } from '../api'

/**
 * Agent 输出的图标词表（见 narrator/adjudicator 的 prompt）。
 * 用单字而不用 emoji：彩色 emoji 会把整个深色版面搅碎，
 * 金色宋体单字反而像旧书的批注，跟整体气质是一路的。
 */
const GLYPH: Record<string, string> = {
  house: '居',
  work: '事',
  family: '亲',
  health: '身',
  money: '钱',
  travel: '途',
  heart: '心',
  clock: '岁',
  spark: '记',
}

/** 牌面花色。代价是红桃（要付出的），关系是梅花，其余黑桃。 */
const SUIT: Record<string, string> = {
  cost: '♥',
  relationship: '♣',
  default: '♠',
}

const TIER_LABEL: Record<string, string> = {
  大成功: '大成功',
  成功: '成功',
  勉强: '勉强',
  失败: '失败',
}

interface Act {
  turn: number
  age: number
  cards: Card[]
  tier: string | null
  chosen: string
}

interface Props {
  /** 当前这一幕的牌，来自 state.事件卡 */
  cards: Card[]
  turn: number
  age: number
  /** 往期，来自事件树里已归档的牌 */
  history: TreeNode[]
  emptyHint?: string
}

/**
 * PRD 6.5：这一回合发生的事用卡片呈现，不用长段落。
 *
 * 牌桌隐喻：当前这一幕摊开成一手牌，左右翻；打过的幕收成牌摞，
 * 点一下重新摊开。这样"这一生"始终在同一屏里，不用往下滚很远。
 */
export function EventCards({ cards, turn, age, history, emptyHint }: Props) {
  const past: Act[] = history
    .filter((node) => node.回合 < turn && node.事件卡.length > 0)
    .map((node) => ({
      turn: node.回合,
      age: node.年龄,
      cards: node.事件卡,
      tier: node.结算档位,
      chosen: node.已选决策,
    }))
    .reverse()

  return (
    <div className="table">
      {cards.length > 0 ? (
        <ActRow act={{ turn, age, cards, tier: null, chosen: '' }} current />
      ) : (
        <p className="hint">{emptyHint ?? '这一回合还没有发生什么。'}</p>
      )}

      {past.map((act) => (
        <ActRow key={act.turn} act={act} current={false} />
      ))}
    </div>
  )
}

function ActRow({ act, current }: { act: Act; current: boolean }) {
  const [open, setOpen] = useState(current)
  const rail = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ left: false, right: false })

  const sync = () => {
    const node = rail.current
    if (!node) return
    setEdge({
      left: node.scrollLeft > 4,
      right: node.scrollLeft + node.clientWidth < node.scrollWidth - 4,
    })
  }

  useEffect(() => {
    if (!open) return
    sync()
    const node = rail.current
    if (!node) return
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    return () => observer.disconnect()
  }, [open, act.cards.length])

  const slide = (direction: -1 | 1) => {
    const node = rail.current
    if (!node) return
    // 一次推一张牌，翻牌的手感比连续滚动更像在看牌。
    const card = node.firstElementChild as HTMLElement | null
    const step = card ? card.offsetWidth + 12 : 224
    node.scrollBy({ left: direction * step, behavior: 'smooth' })
  }

  if (!open) {
    return (
      <button className="act-stack" onClick={() => setOpen(true)}>
        <span className="stack-deck" aria-hidden>
          {act.cards.slice(0, 3).map((card, index) => (
            <span className={`stack-card ${card.类型}`} key={index}>
              <i>{SUIT[card.类型] ?? SUIT.default}</i>
            </span>
          ))}
        </span>
        <span className="stack-info">
          <span className="stack-line">
            <span className="stack-turn">第 {act.turn} 幕</span>
            <span className="stack-age">{act.age} 岁</span>
            {act.tier && (
              <span className={`stack-tier tier-${act.tier}`}>{TIER_LABEL[act.tier] ?? act.tier}</span>
            )}
          </span>
          <span className="stack-chosen">{act.chosen}</span>
        </span>
        <span className="stack-count">{act.cards.length} 张 · 展开</span>
      </button>
    )
  }

  return (
    <section className={`act ${current ? 'is-current' : ''}`}>
      <header className="act-bar">
        <span className="act-kicker">第 {act.turn} 幕</span>
        <span className="act-title">{act.age} 岁这一年</span>
        {act.tier && (
          <span className={`stack-tier tier-${act.tier}`}>{TIER_LABEL[act.tier] ?? act.tier}</span>
        )}
        <span className="act-bar-gap" />
        <span className="rail-nav">
          <button onClick={() => slide(-1)} disabled={!edge.left} aria-label="上一张">
            ‹
          </button>
          <button onClick={() => slide(1)} disabled={!edge.right} aria-label="下一张">
            ›
          </button>
        </span>
        {!current && (
          <button className="act-fold" onClick={() => setOpen(false)}>
            收起
          </button>
        )}
      </header>

      <div className="rail-wrap">
        <div className={`rail${act.cards.length <= 4 ? ' fill' : ''}`} ref={rail} onScroll={sync}>
          {act.cards.map((card, index) => (
            <article
              className={`pcard ${card.类型}`}
              key={`${card.标题}-${index}`}
              style={{ animationDelay: `${Math.min(index, 6) * 0.06}s` }}
            >
              <span className="pcard-corner">
                <b>{GLYPH[card.图标] ?? GLYPH.spark}</b>
                <i>{SUIT[card.类型] ?? SUIT.default}</i>
              </span>
              <h4 className="pcard-title">{card.标题}</h4>
              <p className="pcard-summary">{card.摘要}</p>
              <span className="pcard-corner flip">
                <b>{GLYPH[card.图标] ?? GLYPH.spark}</b>
                <i>{SUIT[card.类型] ?? SUIT.default}</i>
              </span>
            </article>
          ))}
        </div>
        <span className={`rail-fade left ${edge.left ? 'on' : ''}`} />
        <span className={`rail-fade right ${edge.right ? 'on' : ''}`} />
      </div>
    </section>
  )
}
