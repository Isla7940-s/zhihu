/** 后端契约。字段名沿用 PRD 的中文 schema。 */

export interface EventCard {
  标题: string
  摘要: string
  图标: string
  类型: string
}

export interface Relationship {
  角色: string
  关系类型: string
  亲密度: number
  态度: string
  存活: boolean
}

export interface DecisionOption {
  文案: string
  P基线: number
  时间跨度: number
  新增flags: string[]
  明示代价: string
  代价delta: Record<string, number>
}

export interface TurnDilemma {
  困境ID: string
  困境名: string
  具体场景: string
  解决路径提示: string[]
  困境权重: number
  解决度: number
}

export interface TurnGoal {
  文案: string
  P基线: number
  当前P: number
  时间跨度: number
  明示代价: string
  代价delta: Record<string, number>
  行动累计修正: number
}

export interface TreeNode {
  回合: number
  年龄: number
  已选决策: string
  未选分支: string[]
  结算档位: string | null
  代价: string
  目标: string
  困境: string
  困境解决度: number
  骰值: number | null
  结算概率: number | null
  事件卡: EventCard[]
}

export interface RegretOption {
  选项ID: string
  文案: string
}

export interface LifeCard {
  标题: string
  墓志铭: string
  重大决策: string[]
  成就: string[]
  放弃的那些路: string[]
  结局评价: Record<string, number>
  结局旁白: string[]
  后悔选项: RegretOption[]
  玩家填答: string
}

export interface GameState {
  会话ID: string
  阶段: 'setup' | 'carry_over' | 'dilemma' | 'decision' | 'action' | 'settlement' | 'ended'
  meta: {
    母题ID: string
    母题名: string
    立场: string
    立场文案: string
    身份: string
    身份文案: string
    当前年龄: number
    回合: number
    总回合: number
    人生终点: number
    时代背景: string
  }
  长期状态: Record<string, number>
  即时状态: Record<string, number>
  flags: string[]
  关系网络: Relationship[]
  行动点: {
    总预算: number
    已用: number
    本回合保底: number
    自由池剩余: number
    本回合保底剩余: number
  }
  本回合: {
    目标: TurnGoal | null
    困境: TurnDilemma | null
    本回合已投入行动点: number
    已执行行动: { 行动: string; 目标概率修正: number; 困境解决度推进: number }[]
    待选决策: DecisionOption[]
    建议行动: string[]
  }
  事件树: TreeNode[]
  事件卡: EventCard[]
  人生卡片: LifeCard | null
  达成希望: string | null
  可用行动点: number
  概率构成: Record<string, number>
  结算?: Settlement
}

export interface Settlement {
  档位: string
  骰值: number
  结算概率: number
  目标达成: boolean
  概率构成: Record<string, number>
  长期状态变化: Record<string, number>
  代价: Record<string, number>
  伤疤: Record<string, number>
  代价文案: string
  困境带入下回合: boolean
  年龄: { 从: number; 到: number }
}

export interface ZhihuAnswer {
  answer_id: string
  author: string
  headline: string
  upvotes: number
  comments_count: number
  stance: string
  content: string
  comments: { author: string; content: string; upvotes: number }[]
}

export interface ZhihuTopic {
  question_id: string
  title: string
  description: string
  tags: string[]
  stats: { followers: number; views: string; answers: number; good_question: number }
  created_at: string
  answers: ZhihuAnswer[]
}

export interface Motif {
  母题ID: string
  母题名: string
  时代背景: string
  入场年龄: number
  人生终点: number
  总回合数: number
  立场选项: { 立场ID: string; 文案: string; 注解: string }[]
  身份设定: { 身份ID: string; 文案: string; 注解: string }[]
  结局评价维度: string[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!response.ok) {
    const body = await response.text()
    let detail = body
    try {
      detail = JSON.parse(body).detail ?? body
    } catch {
      /* 原样抛出 */
    }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export const api = {
  configure: (api_key: string, base_url: string, model: string) => request<{status:string}>('/api/config', { method: 'POST', body: JSON.stringify({api_key, base_url, model}) }),
  topic: () => request<ZhihuTopic>('/api/topic'),
  motifs: () => request<Motif[]>('/api/motifs'),
  session: (id: string) => request<GameState>(`/api/session/${id}`),
  start: (motif_id: string, stance_id: string, identity_id: string) =>
    request<GameState>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ motif_id, stance_id, identity_id }),
    }),
  beginTurn: (id: string) =>
    request<GameState>(`/api/session/${id}/begin-turn`, { method: 'POST' }),
  decide: (id: string, index: number) =>
    request<GameState>(`/api/session/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ index }),
    }),
  act: (id: string, text: string) =>
    request<GameState>(`/api/session/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  settle: (id: string) => request<GameState>(`/api/session/${id}/settle`, { method: 'POST' }),
  regret: (id: string, text: string) =>
    request<GameState>(`/api/session/${id}/regret`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
}
