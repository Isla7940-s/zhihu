import { useState } from 'react'
import type { Motif, ZhihuAnswer, ZhihuTopic } from '../api'

interface Props {
  topic: ZhihuTopic
  motif: Motif
  busy: boolean
  error: string | null
  onStart: (stanceId: string, identityId: string) => void
}

function Answer({ answer }: { answer: ZhihuAnswer }) {
  const [open, setOpen] = useState(false)
  const long = answer.content.length > 220

  return (
    <div className="zhihu-answer">
      <div className="zhihu-author">
        <strong>{answer.author}</strong>
        <span>{answer.headline}</span>
      </div>
      <div className="zhihu-upvote">
        ▲ {answer.upvotes.toLocaleString('zh-CN')} 人赞同了该回答
      </div>
      <div className={`zhihu-content${long && !open ? ' clipped' : ''}`}>{answer.content}</div>
      {long && (
        <button className="zhihu-more" onClick={() => setOpen(!open)}>
          {open ? '收起' : '阅读全文 ∨'}
        </button>
      )}
      {answer.comments.length > 0 && (
        <div className="zhihu-comments">
          {answer.comments.map((comment, index) => (
            <div className="zhihu-comment" key={index}>
              <b>{comment.author}</b>：{comment.content}
              <em>{comment.upvotes} 赞</em>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * PRD 3.1：这个东西是嵌在知乎话题里的一块互动内容，不是一个独立的游戏站。
 *
 * 入口只问两件事——立场和身份。问得再多，玩家在还没理解这是什么之前就走了。
 * 立场决定他想证明什么，身份决定他从哪里出发；剩下的一切由过程生成。
 */
export function ZhihuEntry({ topic, motif, busy, error, onStart }: Props) {
  const [stance, setStance] = useState(motif.立场选项[0]?.立场ID ?? '')
  const [identity, setIdentity] = useState(motif.身份设定[0]?.身份ID ?? '')

  return (
    <div className="zhihu">
      <div className="zhihu-bar">
        <div className="zhihu-bar-inner">
          <span className="zhihu-logo">知乎</span>
        </div>
      </div>

      <div className="zhihu-body">
        <div className="zhihu-card">
          <h1 className="zhihu-question">{topic.title}</h1>
          <p className="zhihu-desc">{topic.description}</p>
          <div className="zhihu-tags">
            {topic.tags.map((tag) => (
              <span className="zhihu-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <div className="zhihu-stats">
            <span>{topic.stats.followers.toLocaleString('zh-CN')} 人关注</span>
            <span>{topic.stats.views} 次浏览</span>
            <span>{topic.stats.answers} 个回答</span>
            <span>{topic.stats.good_question} 人觉得是好问题</span>
          </div>
        </div>

        {topic.answers.slice(0, 2).map((answer) => (
          <Answer answer={answer} key={answer.answer_id} />
        ))}

        <div className="embed">
          <div className="embed-kicker">互动内容</div>
          <h2>{motif.母题名}</h2>
          <p>
            {motif.时代背景}
            <br />
            这里没有攻略，也没有最优解。你会从 {motif.入场年龄} 岁走到{' '}
            {motif.人生终点} 岁，做 {motif.总回合数} 次决定，每一次都要付出点什么。
          </p>

          <div className="choice-group">
            <div className="choice-label">你更想证明哪件事</div>
            <div className="choice-row">
              {motif.立场选项.map((item) => (
                <button
                  className={`choice${stance === item.立场ID ? ' on' : ''}`}
                  key={item.立场ID}
                  onClick={() => setStance(item.立场ID)}
                >
                  <div className="choice-title">{item.文案}</div>
                  <div className="choice-note">{item.注解}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="choice-group">
            <div className="choice-label">你从哪里出发</div>
            <div className="choice-row">
              {motif.身份设定.map((item) => (
                <button
                  className={`choice${identity === item.身份ID ? ' on' : ''}`}
                  key={item.身份ID}
                  onClick={() => setIdentity(item.身份ID)}
                >
                  <div className="choice-title">{item.文案}</div>
                  <div className="choice-note">{item.注解}</div>
                </button>
              ))}
            </div>
          </div>

          {error && <div className="error">{error}</div>}

          <button
            className="primary"
            disabled={busy || !stance || !identity}
            onClick={() => onStart(stance, identity)}
          >
            {busy ? '正在铺开这一生…' : '开始'}
          </button>
        </div>

        {topic.answers.slice(2).map((answer) => (
          <Answer answer={answer} key={answer.answer_id} />
        ))}
      </div>
    </div>
  )
}
