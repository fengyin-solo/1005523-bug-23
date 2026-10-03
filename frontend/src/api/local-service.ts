import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { MEDIAFILL_KEY } from '@/data/mediafill-ledger'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 单条详情入口：与列表走同一份 listRows，打开详情再返回两处结果都不会走样。 */
export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === Number(id))
}

/**
 * 通用单向状态机：动作只能把状态往「相邻的下一状态」推进；
 * 登记在 meta.allowedJumps 里的动作允许业务收口式越级（如污染直接终止）；
 * 回退（含已判定被「提交灌装」拽回灌装中）、无变化、越级一律挡回。
 */
export function assertForwardTransition(meta: ModuleMeta, current: string, action: string): ActionResult | null {
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const fromIndex = meta.statuses.indexOf(current)
  const toIndex = meta.statuses.indexOf(target)
  if (fromIndex < 0 || toIndex < 0) {
    return { ok: false, message: `${meta.entity}当前状态「${current}」不在台账状态内` }
  }
  if (toIndex <= fromIndex) {
    return { ok: false, message: `状态只能单向推进，不能从「${current}」回退到「${target}」` }
  }
  const isAdjacent = toIndex === fromIndex + 1
  const jumpAllowed = (meta.allowedJumps ?? []).includes(action)
  if (!isAdjacent && !jumpAllowed) {
    return { ok: false, message: `不能从「${current}」越级到「${target}」，请按状态顺序推进` }
  }
  return null
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  // 单向状态机只对培养基模拟灌装强制：该模块有「已判定被拽回灌装中」的明确缺陷，
  // 且其页面已改走 mediafill-service；其余模块动作为并行结果（如待放行→已拒绝），维持原口径。
  if (key === MEDIAFILL_KEY) {
    const blocked = assertForwardTransition(meta, current, action)
    if (blocked) {
      return blocked
    }
  }
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: abnormalFlag(action, target, lastStatus),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function abnormalFlag(action: string, target: string, lastStatus: string): boolean {
  if (NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))) {
    return true
  }
  // 终止类终态按异常统计，便于看板识别污染终止批
  return target === '已终止' && target === lastStatus
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
