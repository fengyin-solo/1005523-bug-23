import { assertForwardTransition, moduleMeta } from './local-service'
import { listRows, saveRows } from '@/data/local-store'
import {
  FILLING_STATION,
  MEDIAFILL_KEY,
  ROLE_REVIEWER,
  STABILITY_KEY,
  VERDICT_CLEAN,
  VERDICT_CONTAMINATED,
  validateJudgeInput,
  type JudgeInput,
} from '@/data/mediafill-ledger'
import type { ActionResult, EntryRow, Operator } from '@/data/types'

/**
 * 培养基模拟灌装专用服务。
 * 列表与详情页都只通过这里动作，规则口径全部来自 mediafill-ledger 这一份台账。
 */

/** 面板/详情共用的单条读取：两个入口取回来的污染瓶数等字段属同一份。 */
export function getMediafill(id: number): EntryRow | undefined {
  return listRows(MEDIAFILL_KEY).find((row) => Number(row.id) === Number(id))
}

/** 由灌装编号派生的稳定性待办 id（数字），保证同批重复判定不会重复落待办。 */
function stabilityTodoId(sourceNo: string): number {
  let hash = 0
  for (let i = 0; i < sourceNo.length; i += 1) {
    hash = (hash * 31 + sourceNo.charCodeAt(i)) >>> 0
  }
  // 落到高位段，避开手工编号
  return 900000 + (hash % 9000)
}

function nextStabilityNo(): string {
  const rows = listRows(STABILITY_KEY)
  let max = 0
  for (const row of rows) {
    const no = String(row.考察编号 ?? '')
    const match = /STAB-MF-(\d+)/.exec(no)
    if (match) {
      max = Math.max(max, Number(match[1]))
    }
  }
  return `STAB-MF-${String(max + 1).padStart(3, '0')}`
}

/** 合格判定动作落到稳定性考察的待办；同一条灌装批只落一次。 */
function ensureStabilityTodo(source: EntryRow): void {
  const sourceNo = String(source.灌装编号)
  const rows = listRows(STABILITY_KEY)
  const id = stabilityTodoId(sourceNo)
  const existed = rows.some((row) => Number(row.id) === id || String(row.来源灌装编号 ?? '') === sourceNo)
  if (existed) {
    // 已有待办（同一批重复判定只算一次），不新增
    return
  }
  const todo: EntryRow = {
    id,
    status: '待考察',
    pending: true,
    abnormal: false,
    考察编号: nextStabilityNo(),
    考察批号: sourceNo,
    考察条件: `20～25℃ / 30～35℃ 合计 14 天`,
    考察时间点: '0/3/6/12 月',
    检验项目: '无菌检查（模拟灌装合格后跟进）',
    考察结果: '',
    考察人: '',
    考察状态: '待考察',
    来源灌装编号: sourceNo,
  }
  saveRows(STABILITY_KEY, [...rows, todo])
}

/** 灌装被判污染终止时，把已落下的稳定性待办一并终止，动作不再新增待办。 */
function cancelStabilityTodo(sourceNo: string): void {
  const rows = listRows(STABILITY_KEY)
  let changed = false
  const next = rows.map((row) => {
    if (String(row.来源灌装编号 ?? '') !== sourceNo) {
      return row
    }
    changed = true
    return { ...row, status: '已终止', pending: false, abnormal: true, 考察状态: '已终止' }
  })
  if (changed) {
    saveRows(STABILITY_KEY, next)
  }
}

function isFillingReviewer(operator: Operator, row: EntryRow): boolean {
  if (operator.station !== FILLING_STATION || operator.role !== ROLE_REVIEWER) {
    return false
  }
  // 该批已指定复核人时，须是本人；未指定时任何灌装岗复核人均可
  const designated = String(row.复核人 ?? '').trim()
  return designated === '' || designated === operator.name
}

export type JudgeResult = ActionResult & { normalizedDays?: number }

/**
 * 确认判定。
 * - 状态机：只有「灌装中」可首判；「已判定」按现行区间重判（污染转终止，合格重复只算一次）。
 * - 权限：只有本岗位复核人推得动，越权一律拒绝。
 * - 数据：培养温度、培养天数、污染瓶数一次写全并按台账校验，天数按口径统一。
 */
export function judgeMediafill(id: number, input: JudgeInput, operator: Operator): JudgeResult {
  const meta = moduleMeta(MEDIAFILL_KEY)
  const rows = listRows(MEDIAFILL_KEY)
  const index = rows.findIndex((row) => Number(row.id) === Number(id))
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)

  if (current === '待灌装' || current === '已终止') {
    return { ok: false, message: `「${current}」状态不能判定，请先提交灌装推进到「灌装中」` }
  }

  if (!isFillingReviewer(operator, row)) {
    return {
      ok: false,
      message: `越权提交被拒绝：只有${FILLING_STATION}的${ROLE_REVIEWER}（本批评定复核人：${String(row.复核人) || '未指定'}）才能确认判定`,
    }
  }

  const validation = validateJudgeInput(input, row)
  if (!validation.ok || !validation.normalized) {
    return { ok: false, message: validation.message }
  }
  const { temp, days, contaminated } = validation.normalized
  const sourceNo = String(row.灌装编号)

  // 已判定的批按现行区间重判
  if (current === '已判定') {
    // 同一批灌装重复判定（仍合格）只算一次：不覆盖、不再落待办
    if (!validation.contaminated) {
      return {
        ok: false,
        message: '该批已判定为合格，按现行区间重判仍无污染；同一批灌装重复判定只算一次',
        normalizedDays: days,
      }
    }
    // 重判为污染：走终止（状态机允许的业务收口越级，由专用服务执行）
    const terminated: EntryRow = {
      ...row,
      培养温度: temp,
      培养天数: days,
      污染瓶数: contaminated,
      判定结论: VERDICT_CONTAMINATED,
      灌装状态: '已终止',
      status: '已终止',
      pending: false,
      abnormal: true,
    }
    const next = [...rows]
    next[index] = terminated
    saveRows(MEDIAFILL_KEY, next)
    cancelStabilityTodo(sourceNo)
    return {
      ok: true,
      message: `按现行区间重判为污染（${contaminated} 瓶），已转「已终止」，并终止对应稳定性考察待办`,
      normalizedDays: days,
    }
  }

  // 首判（灌装中）
  const contaminatedNow = validation.contaminated === true
  const target = contaminatedNow ? '已终止' : '已判定'
  const updated: EntryRow = {
    ...row,
    培养温度: temp,
    培养天数: days,
    污染瓶数: contaminated,
    复核人: operator.name,
    判定结论: contaminatedNow ? VERDICT_CONTAMINATED : VERDICT_CLEAN,
    灌装状态: target,
    status: target,
    pending: false,
    abnormal: contaminatedNow,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MEDIAFILL_KEY, next)

  if (contaminatedNow) {
    cancelStabilityTodo(sourceNo)
    return {
      ok: true,
      message: `污染瓶数 ${contaminated}（>0），判定污染，已转「已终止」，不落稳定性考察待办`,
      normalizedDays: days,
    }
  }
  ensureStabilityTodo(updated)
  return {
    ok: true,
    message: `判定合格，培养温度/天数/污染瓶数已一次写全，并已在稳定性考察生成待办`,
    normalizedDays: days,
  }
}

/**
 * 提交灌装 / 手动终止：复用通用单向状态机做越级、回退拦截。
 * 手动终止只对灌装岗开放（操作工或复核人均可终止，但不做判定）。
 */
export function submitFilling(id: number, operator: Operator): ActionResult {
  const meta = moduleMeta(MEDIAFILL_KEY)
  const row = getMediafill(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (operator.station !== FILLING_STATION) {
    return { ok: false, message: `越权提交被拒绝：只有${FILLING_STATION}人员能提交灌装` }
  }
  const blocked = assertForwardTransition(meta, String(row.status), '提交灌装')
  if (blocked) {
    return blocked
  }
  return applyPlain(id, '提交灌装')
}

export function terminateFilling(id: number, operator: Operator): ActionResult {
  const meta = moduleMeta(MEDIAFILL_KEY)
  const row = getMediafill(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (operator.station !== FILLING_STATION) {
    return { ok: false, message: `越权提交被拒绝：只有${FILLING_STATION}人员能终止灌装` }
  }
  const blocked = assertForwardTransition(meta, String(row.status), '终止灌装')
  if (blocked) {
    return blocked
  }
  const result = applyPlain(id, '终止灌装')
  if (result.ok) {
    cancelStabilityTodo(String(row.灌装编号))
  }
  return result
}

function applyPlain(id: number, action: '提交灌装' | '终止灌装'): ActionResult {
  const meta = moduleMeta(MEDIAFILL_KEY)
  const rows = listRows(MEDIAFILL_KEY)
  const index = rows.findIndex((item) => Number(item.id) === Number(id))
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const target = meta.actionTargets[action] as string
  const terminating = target === '已终止'
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    灌装状态: target,
    pending: false,
    abnormal: terminating,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MEDIAFILL_KEY, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}
