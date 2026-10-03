/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  /** 默认只允许向相邻下一状态推进；登记在这里的动作允许直接跳到目标（业务上的越级收口）。 */
  allowedJumps?: string[]
  metrics: string[]
}

/** 当前登录/切换的操作人：岗位 + 角色，用于本岗位复核权限判定。 */
export type Operator = {
  name: string
  station: string
  role: string
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
