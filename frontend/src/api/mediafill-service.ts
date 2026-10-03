/**
 * 培养基模拟灌装领域服务
 *
 * 所有入口（列表、详情、判定弹窗）都通过这里读写，保证取回来的是同一份数据。
 * 状态单向推进、同编号去重、判定写全、岗位鉴权、污染联动稳定性待办都在此收口。
 */
import { listRows, saveRows } from '@/data/local-store'
import {
  ACTION_ROLES,
  JUDGE_REQUIRED_FIELDS,
  MEDIAFILL_KEY,
  MEDIAFILL_ORDER,
  MEDIAFILL_STATUS,
  MEDIAFILL_TRANSITIONS,
  STABILITY_KEY,
  validateJudgeInput,
} from '@/data/mediafill-ledger'
import type { ActionResult, EntryRow } from '@/data/types'

const TERMINAL_STATUSES: string[] = [MEDIAFILL_STATUS.judged, MEDIAFILL_STATUS.terminated]

type Actor = { operator: string; role: string }

type ReconcileReport = {
  removedDuplicates: number
  reopened: string[]
  terminated: string[]
  todos: string[]
  unchanged: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.trim()))) {
    return Number(value.trim())
  }
  return Number.NaN
}

/** 同一灌装编号只保留一条：优先保留已经走到终态的那一条，其次保留排序靠前的。 */
function dedupeByCode(rows: EntryRow[]): { rows: EntryRow[]; removed: number } {
  const winners = new Map<string, EntryRow>()
  for (const row of rows) {
    const code = String(row['灌装编号'] ?? '').trim()
    if (!code) {
      // 没有编号的异常数据给一个不冲突的键，不参与合并
      winners.set(`__empty__${row.id}`, row)
      continue
    }
    const current = winners.get(code)
    if (!current) {
      winners.set(code, row)
      continue
    }
    const currentTerminal = TERMINAL_STATUSES.includes(String(current.status))
    const rowTerminal = TERMINAL_STATUSES.includes(String(row.status))
    if (!currentTerminal && rowTerminal) {
      winners.set(code, row)
    }
  }
  const merged = [...winners.values()].sort((a, b) => Number(a.id) - Number(b.id))
  return { rows: merged, removed: rows.length - merged.length }
}

/**
 * 按现行台账区间重判一条「灌装中」且读数已写全的批：
 * 温度 / 天数 / 瓶数合法才判；污染的走终止，其余判为合格已判定。
 * 已经处在终态的记录一律锁定，重判也不能把它们拽回灌装中。
 */
function rejudgeRow(row: EntryRow): { row: EntryRow; outcome: 'terminated' | 'judged' | 'none' } {
  const status = String(row.status)
  if (status !== MEDIAFILL_STATUS.filling) {
    return { row, outcome: 'none' }
  }
  const batchSize = asNumber(row['灌装批量'])
  const validation = validateJudgeInput(
    {
      培养温度: row['培养温度'] as string | number,
      培养天数: row['培养天数'] as string | number,
      污染瓶数: row['污染瓶数'] as string | number,
    },
    batchSize,
  )
  if (!validation.ok || !validation.normalized) {
    return { row, outcome: 'none' }
  }
  const { 培养温度, 培养天数, 污染瓶数, 判定结论 } = validation.normalized
  const target = 判定结论 === '污染' ? MEDIAFILL_STATUS.terminated : MEDIAFILL_STATUS.judged
  const updated: EntryRow = {
    ...row,
    培养温度,
    培养天数,
    污染瓶数,
    判定结论,
    status: target,
    灌装状态: target,
    pending: false,
    abnormal: target === MEDIAFILL_STATUS.terminated,
    复核人: String(row['复核人'] ?? '').trim() || '系统按台账重判',
    判定日期: String(row['判定日期'] ?? '').trim() || new Date().toISOString().slice(0, 10),
  }
  return { row: updated, outcome: target === MEDIAFILL_STATUS.terminated ? 'terminated' : 'judged' }
}

/** 已判定为「合格」、但按现行区间实为污染的历史错判，纠正为终止。 */
function correctWronglyPassed(row: EntryRow): EntryRow | null {
  if (String(row.status) !== MEDIAFILL_STATUS.judged) {
    return null
  }
  if (String(row['判定结论'] ?? '') !== '合格') {
    return null
  }
  const contaminated = asNumber(row['污染瓶数'])
  if (!Number.isFinite(contaminated) || contaminated <= 0) {
    return null
  }
  return {
    ...row,
    判定结论: '污染',
    status: MEDIAFILL_STATUS.terminated,
    灌装状态: MEDIAFILL_STATUS.terminated,
    pending: false,
    abnormal: true,
  }
}

/** 污染终止的批，动作落到稳定性考察待办；同一灌装编号只落一条。 */
function ensureStabilityTodo(stabilityRows: EntryRow[], row: EntryRow): { rows: EntryRow[]; created: boolean } {
  const code = String(row['灌装编号'] ?? '').trim()
  const exists = stabilityRows.some(
    (item) => String(item['来源灌装编号'] ?? '') === code || String(item['考察批号'] ?? '').includes(code),
  )
  if (exists) {
    return { rows: stabilityRows, created: false }
  }
  const nextId = stabilityRows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
  const todo: EntryRow = {
    id: nextId,
    status: '待考察',
    pending: true,
    abnormal: true,
    考察编号: `STAB-MF-${code}`,
    考察批号: code,
    来源灌装编号: code,
    考察条件: '培养基模拟灌装污染批跟踪考察',
    考察时间点: '',
    检验项目: '污染菌鉴别与培养条件复核',
    考察结果: '',
    考察人: '',
    考察状态: '待考察',
  }
  return { rows: [...stabilityRows, todo], created: true }
}

/**
 * 数据对账（幂等）：去重 → 纠正历史错判 → 按现行区间重判 → 污染批补稳定性待办。
 * 每次读数据前跑一遍，重复执行不会重复落待办、也不会重复判定。
 */
function reconcile(): ReconcileReport {
  const report: ReconcileReport = { removedDuplicates: 0, reopened: [], terminated: [], todos: [], unchanged: 0 }
  const raw = listRows(MEDIAFILL_KEY)
  const { rows: deduped, removed } = dedupeByCode(raw)
  report.removedDuplicates = removed

  let stabilityRows = clone(listRows(STABILITY_KEY))
  const next = deduped.map((row) => {
    const corrected = correctWronglyPassed(row)
    if (corrected) {
      report.reopened.push(String(row['灌装编号']))
      return corrected
    }
    const result = rejudgeRow(row)
    if (result.outcome === 'terminated') {
      report.terminated.push(String(row['灌装编号']))
    } else if (result.outcome === 'none') {
      report.unchanged += 1
    }
    return result.row
  })

  for (const row of next) {
    if (String(row.status) === MEDIAFILL_STATUS.terminated && String(row['判定结论'] ?? '') === '污染') {
      const ensured = ensureStabilityTodo(stabilityRows, row)
      stabilityRows = ensured.rows
      if (ensured.created) {
        report.todos.push(String(row['灌装编号']))
      }
    }
  }

  saveRows(MEDIAFILL_KEY, next)
  saveRows(STABILITY_KEY, stabilityRows)
  return report
}

let reconciled = false

function ensureIntegrity(): ReconcileReport {
  if (reconciled) {
    return { removedDuplicates: 0, reopened: [], terminated: [], todos: [], unchanged: 0 }
  }
  reconciled = true
  return reconcile()
}

function matches(row: EntryRow, filters: Record<string, string>): boolean {
  return Object.entries(filters).every(([field, value]) => {
    if (!value.trim()) return true
    return String(row[field] ?? '').includes(value.trim())
  })
}

function displayValue(row: EntryRow, field: string): string | number | boolean {
  const value = row[field]
  if (value === undefined || value === null || value === '') return '—'
  return value
}

export function listMediafill(filters: Record<string, string> = {}): EntryRow[] {
  ensureIntegrity()
  return listRows(MEDIAFILL_KEY).filter((row) => matches(row, filters))
}

export function getMediafill(id: number): EntryRow | null {
  ensureIntegrity()
  return listRows(MEDIAFILL_KEY).find((row) => Number(row.id) === id) ?? null
}

export type MediafillStats = {
  pending: number
  filling: number
  contaminatedBottles: number
  statusCounts: Record<string, number>
}

export function mediafillStats(): MediafillStats {
  const rows = listMediafill()
  const statusCounts: Record<string, number> = {}
  let contaminatedBottles = 0
  for (const row of rows) {
    const status = String(row.status)
    statusCounts[status] = (statusCounts[status] ?? 0) + 1
    if (String(row['判定结论'] ?? '') === '污染') {
      const count = asNumber(row['污染瓶数'])
      if (Number.isFinite(count) && count >= 0) {
        contaminatedBottles += count
      }
    }
  }
  return {
    pending: statusCounts[MEDIAFILL_STATUS.pending] ?? 0,
    filling: statusCounts[MEDIAFILL_STATUS.filling] ?? 0,
    contaminatedBottles,
    statusCounts,
  }
}

function findIndex(rows: EntryRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

function assertRole(action: string, actor: Actor): ActionResult | null {
  const allowed = ACTION_ROLES[action] ?? []
  if (!allowed.includes(actor.role)) {
    return {
      ok: false,
      message: `越权提交已拒绝：「${action}」只允许${allowed.join(' / ')}执行，当前岗位是「${actor.role}」`,
    }
  }
  return null
}

function assertForward(current: string, target: string): ActionResult | null {
  if (current === target) {
    return { ok: false, message: `该批已经是「${target}」，同一批灌装重复判定只算一次` }
  }
  const allowedTargets = MEDIAFILL_TRANSITIONS[current] ?? []
  if (!allowedTargets.includes(target)) {
    const currentOrder = MEDIAFILL_ORDER[current]
    const targetOrder = MEDIAFILL_ORDER[target]
    if (Number.isInteger(currentOrder) && Number.isInteger(targetOrder) && targetOrder < currentOrder) {
      return { ok: false, message: `状态只能单向推进，不能从「${current}」回到「${target}」，操作已挡回` }
    }
    return { ok: false, message: `状态只能逐级推进，不能从「${current}」越级到「${target}」，操作已挡回` }
  }
  return null
}

export type MediafillActionInput = Partial<{
  培养温度: string | number
  培养天数: string | number
  污染瓶数: string | number
  复核人: string
  判定日期: string
}>

function persist(row: EntryRow): void {
  const rows = listRows(MEDIAFILL_KEY)
  const index = findIndex(rows, Number(row.id))
  if (index < 0) return
  const next = [...rows]
  next[index] = row
  saveRows(MEDIAFILL_KEY, next)
}

/** 提交灌装：待灌装 → 灌装中，只推一级。 */
export function submitFill(id: number, actor: Actor): ActionResult {
  ensureIntegrity()
  const denied = assertRole('提交灌装', actor)
  if (denied) return denied
  const rows = listRows(MEDIAFILL_KEY)
  const index = findIndex(rows, id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的模拟灌装记录` }
  const blocked = assertForward(String(rows[index].status), MEDIAFILL_STATUS.filling)
  if (blocked) return blocked

  const updated: EntryRow = { ...rows[index], status: MEDIAFILL_STATUS.filling, 灌装状态: MEDIAFILL_STATUS.filling, pending: true }
  const next = [...rows]
  next[index] = updated
  saveRows(MEDIAFILL_KEY, next)
  return { ok: true, message: `灌装 ${updated['灌装编号']} 已提交，状态推进到「灌装中」` }
}

/**
 * 确认判定：灌装中 → 已判定（合格）/ 已终止（污染）。
 * 温度、天数、污染瓶数一次写全并按台账校验；只有灌装复核岗推得动。
 */
export function judgeFill(id: number, input: MediafillActionInput, actor: Actor): ActionResult & { warnings: string[] } {
  ensureIntegrity()
  const roleDenied = assertRole('确认判定', actor)
  if (roleDenied) return { ...roleDenied, warnings: [] }
  const rows = listRows(MEDIAFILL_KEY)
  const index = findIndex(rows, id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的模拟灌装记录`, warnings: [] }
  const current = rows[index]

  for (const field of JUDGE_REQUIRED_FIELDS) {
    const raw = input[field]
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return { ok: false, message: `培养温度、培养天数与污染瓶数必须一次写全，缺少「${field}」不允许保存`, warnings: [] }
    }
  }

  const batchSize = asNumber(current['灌装批量'])
  const validation = validateJudgeInput(
    {
      培养温度: input.培养温度 as string | number,
      培养天数: input.培养天数 as string | number,
      污染瓶数: input.污染瓶数 as string | number,
    },
    batchSize,
  )
  if (!validation.ok || !validation.normalized) {
    return { ok: false, message: validation.message, warnings: validation.warnings }
  }
  const { 培养温度, 培养天数, 污染瓶数, 判定结论 } = validation.normalized
  const target = 判定结论 === '污染' ? MEDIAFILL_STATUS.terminated : MEDIAFILL_STATUS.judged
  const blocked = assertForward(String(current.status), target)
  if (blocked) return { ...blocked, warnings: validation.warnings }

  const updated: EntryRow = {
    ...current,
    培养温度,
    培养天数,
    污染瓶数,
    判定结论,
    复核人: actor.operator || String(input.复核人 ?? '') || '未署名复核人',
    判定日期: String(input.判定日期 ?? '').trim() || new Date().toISOString().slice(0, 10),
    status: target,
    灌装状态: target,
    pending: false,
    abnormal: target === MEDIAFILL_STATUS.terminated,
  }
  persist(updated)

  if (target === MEDIAFILL_STATUS.terminated) {
    const stabilityRows = clone(listRows(STABILITY_KEY))
    const ensured = ensureStabilityTodo(stabilityRows, updated)
    saveRows(STABILITY_KEY, ensured.rows)
  }

  const tail =
    target === MEDIAFILL_STATUS.terminated
      ? '污染批已走终止，动作已落到稳定性考察待办'
      : '判定合格，状态锁定为「已判定」'
  return {
    ok: true,
    message: `灌装 ${updated['灌装编号']}：${tail}`,
    warnings: validation.warnings,
  }
}

/** 终止灌装：非污染原因终止；终态批不允许再终止。 */
export function terminateFill(id: number, actor: Actor): ActionResult {
  ensureIntegrity()
  const denied = assertRole('终止灌装', actor)
  if (denied) return denied
  const rows = listRows(MEDIAFILL_KEY)
  const index = findIndex(rows, id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的模拟灌装记录` }
  const blocked = assertForward(String(rows[index].status), MEDIAFILL_STATUS.terminated)
  if (blocked) return blocked

  const current = rows[index]
  const updated: EntryRow = {
    ...current,
    status: MEDIAFILL_STATUS.terminated,
    灌装状态: MEDIAFILL_STATUS.terminated,
    pending: false,
    abnormal: true,
  }
  persist(updated)
  return { ok: true, message: `灌装 ${updated['灌装编号']} 已终止，终态锁定` }
}

export type CreateInput = {
  灌装编号: string
  灌装规格: string
  灌装批量: string | number
}

/** 登记模拟灌装记录：编号唯一、批量为正整数，没按标准填不允许保存。 */
export function createRecord(input: CreateInput): ActionResult {
  ensureIntegrity()
  const code = input.灌装编号.trim()
  if (!code) {
    return { ok: false, message: '灌装编号为必填项，没按标准填写不允许保存' }
  }
  if (!input.灌装规格.trim()) {
    return { ok: false, message: '灌装规格为必填项，没按标准填写不允许保存' }
  }
  const batchSize = asNumber(input.灌装批量)
  if (!Number.isFinite(batchSize) || !Number.isInteger(batchSize) || batchSize <= 0) {
    return { ok: false, message: '灌装批量必须是正整数，没按标准填写不允许保存' }
  }
  const rows = listRows(MEDIAFILL_KEY)
  if (rows.some((row) => String(row['灌装编号'] ?? '').trim() === code)) {
    return { ok: false, message: `灌装编号 ${code} 已存在，同一批灌装不允许重复登记` }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: MEDIAFILL_STATUS.pending,
    pending: true,
    abnormal: false,
    灌装编号: code,
    灌装规格: input.灌装规格.trim(),
    灌装批量: batchSize,
    培养温度: '',
    培养天数: '',
    污染瓶数: '',
    判定结论: '',
    复核人: '',
    判定日期: '',
    灌装状态: MEDIAFILL_STATUS.pending,
  }
  saveRows(MEDIAFILL_KEY, [...rows, row])
  return { ok: true, message: `已登记 ${code}，当前状态「待灌装」` }
}

/** 手工触发「按现行区间重判」：返回处理明细。 */
export function rejudgeAll(): ActionResult & { report: ReconcileReport } {
  reconciled = false
  const report = reconcile()
  const parts: string[] = []
  if (report.removedDuplicates) parts.push(`剔除重复记录 ${report.removedDuplicates} 条`)
  if (report.reopened.length) parts.push(`纠正历史错判并终止 ${report.reopened.length} 批`)
  if (report.terminated.length) parts.push(`污染重判终止 ${report.terminated.length} 批`)
  if (report.todos.length) parts.push(`新增稳定性考察待办 ${report.todos.length} 条`)
  if (!parts.length) parts.push('没有需要重判的灌装中批次')
  return { ok: true, message: parts.join('；'), report }
}

export { MEDIAFILL_KEY, STABILITY_KEY }
export { displayValue as mediafillDisplayValue }
