import { useEffect, useRef, useState } from 'react'
import type { LifeCard } from '../api'

interface Props {
  card: LifeCard
  onRegret: (text: string) => void
  onRestart: () => void
}

/** 一行旁白大致的朗读时长，用来对齐字幕滚动速度。 */
const SECONDS_PER_LINE = 4.6

function speak(lines: string[], onDone: () => void): () => void {
  const synth = window.speechSynthesis
  if (!synth) {
    onDone()
    return () => {}
  }

  synth.cancel()
  // 中文音色的名字各系统不一样，按 lang 前缀挑最稳。
  const voice = synth.getVoices().find((item) => item.lang.toLowerCase().startsWith('zh'))
  let cancelled = false

  lines.forEach((line, index) => {
    const utterance = new SpeechSynthesisUtterance(line)
    utterance.lang = 'zh-CN'
    if (voice) utterance.voice = voice
    utterance.rate = 0.86
    utterance.pitch = 0.95
    if (index === lines.length - 1) {
      utterance.onend = () => {
        if (!cancelled) onDone()
      }
    }
    synth.speak(utterance)
  })

  return () => {
    cancelled = true
    synth.cancel()
  }
}

/**
 * PRD 7.1 终局：先滚字幕、后给卡片。
 *
 * 顺序是有意的。玩家刚走完一生，先让他把这一生听完——这是情绪落点；
 * 卡片是复盘，复盘不该抢在情绪之前。
 */
export function EndingScreen({ card, onRegret, onRestart }: Props) {
  const [rolling, setRolling] = useState(true)
  const [muted, setMuted] = useState(false)
  const [regret, setRegret] = useState(card.玩家填答)
  const [submitted, setSubmitted] = useState(Boolean(card.玩家填答))
  const stopRef = useRef<() => void>(() => {})

  const duration = Math.max(card.结局旁白.length * SECONDS_PER_LINE, 12)

  useEffect(() => {
    if (!rolling) return

    // 有些浏览器首次拿 voices 是空的，等 voiceschanged 再开口。
    const start = () => {
      if (!muted) stopRef.current = speak(card.结局旁白, () => setRolling(false))
    }
    const synth = window.speechSynthesis
    if (synth && synth.getVoices().length === 0) {
      synth.addEventListener('voiceschanged', start, { once: true })
    } else {
      start()
    }

    // 静音时没有朗读回调，用字幕时长兜底切场。
    const timer = window.setTimeout(() => setRolling(false), (duration + 1.5) * 1000)
    return () => {
      window.clearTimeout(timer)
      stopRef.current()
      if (synth) synth.removeEventListener('voiceschanged', start)
    }
  }, [rolling, muted, card.结局旁白, duration])

  const skip = () => {
    stopRef.current()
    setRolling(false)
  }

  if (rolling) {
    return (
      <div className="ending">
        <div className="credits">
          <div className="credits-inner" style={{ animationDuration: `${duration}s` }}>
            {card.结局旁白.map((line, index) => (
              <div className="credit-line" key={index}>
                {line}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="credits-skip"
            onClick={() => {
              stopRef.current()
              setMuted(!muted)
            }}
          >
            {muted ? '开启旁白朗读' : '关闭旁白朗读'}
          </button>
          <button className="credits-skip" onClick={skip}>
            跳过字幕
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ending">
      <div className="lifecard">
        <div className="lifecard-kicker">这一生</div>
        <h1>{card.标题}</h1>
        <div className="epitaph">{card.墓志铭}</div>

        <div className="dims">
          {Object.entries(card.结局评价).map(([name, value]) => (
            <div className="dim" key={name}>
              <div className="dim-name">{name}</div>
              <div className="dim-value">{value}</div>
            </div>
          ))}
        </div>

        <div className="section">
          <h4>你做过的重大决定</h4>
          <ul>
            {card.重大决策.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="section">
          <h4>你确实做到的事</h4>
          <ul>
            {card.成就.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="section">
          <h4>你放弃的那些路</h4>
          <ul>
            {card.放弃的那些路.map((item, index) => (
              <li className="abandoned" key={index}>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="regret">
          <div className="regret-q">这一生，你最后悔的是什么？</div>
          <div className="regret-note">可以不答。答了也不会改变任何数值。</div>

          {submitted ? (
            <div className="regret-answer">{regret || '（跳过了）'}</div>
          ) : (
            <>
              <div className="regret-options">
                {card.后悔选项.map((option) => (
                  <button
                    className={`choice${regret === option.文案 ? ' on' : ''}`}
                    key={option.选项ID}
                    onClick={() => setRegret(option.文案)}
                  >
                    <div className="choice-title">{option.文案}</div>
                  </button>
                ))}
              </div>
              <div className="input-row">
                <input
                  value={regret}
                  placeholder="或者自己写一句"
                  onChange={(event) => setRegret(event.target.value)}
                />
                <button
                  className="ghost"
                  onClick={() => {
                    onRegret(regret)
                    setSubmitted(true)
                  }}
                >
                  留下
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    setRegret('')
                    setSubmitted(true)
                  }}
                >
                  跳过
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 26 }}>
          <button className="primary" onClick={onRestart}>
            换一个立场，再走一遍
          </button>
        </div>
      </div>
    </div>
  )
}
