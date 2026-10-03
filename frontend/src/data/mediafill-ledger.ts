import type { EntryRow } from './types'

/**
 * 培养基模拟灌装「判定台账」——所有判定口径只在这一份里维护，
 * 列表、详情、服务层、表单都从这里取，页面不允许各自再写一份规则。
 *
 * 口径依据（现行 GMP 培养基模拟灌装通则）：
 *  - 培养分两段：20～25℃ 与 30～35℃，每段各培养 7 天，合计 14 天。
 *  - 培养温度必须落在现行区间内；落在区间外的按现行区间重判，不予保存。
 *  - 培养温度与培养天数不一致时，以台账温度区间对应的标准天数为准统一。
 *  - 污染瓶数为负或超过本批灌装批量（极值）一律挡回。
 *  - 污染瓶数 > 0 即判污染，走终止；为 0 才判合格。
 */

export type IncubationStage = {
  /** 区间标识 */
  key: string
  /** 区间名称（台账口径） */
  label: string
  /** 含端点的培养温度区间（℃） */
  minTemp: number
  maxTemp: number
  /** 台账规定的该段标准培养天数 */
  standardDays: number
}

export const MEDIAFILL_STAGES: IncubationStage[] = [
  { key: 'low', label: '20～25℃ 培养段', minTemp: 20, maxTemp: 25, standardDays: 7 },
  { key: 'high', label: '30～35℃ 培养段', minTemp: 30, maxTemp: 35, standardDays: 7 },
]

/** 两段合计的标准培养天数（台账口径） */
export const TOTAL_STANDARD_DAYS = MEDIAFILL_STAGES.reduce(
  (sum, stage) => sum + stage.standardDays,
  0,
)

export const MEDIAFILL_KEY = 'mediafill'
export const STABILITY_KEY = 'stability'

/** 模拟灌装状态机：单向推进，不允许回退。 */
export const MEDIAFILL_STATUSES = ['待灌装', '灌装中', '已判定', '已终止'] as const
export type MediafillStatus = (typeof MEDIAFILL_STATUSES)[number]

/** 判定结论（台账只收这两种） */
export const VERDICT_CLEAN = '合格'
export const VERDICT_CONTAMINATED = '污染终止'

/** 只有灌装岗位的复核人才推得动「确认判定」 */
export const FILLING_STATION = '灌装岗'
export const ROLE_REVIEWER = '复核人'

/** 判定时必须一次写全的三项 */
export const JUDGE_REQUIRED_FIELDS = ['培养温度', '培养天数', '污染瓶数'] as const
export type JudgeInput = {
  培养温度: string
  培养天数: string
  污染瓶数: string
}

export type JudgeValidation = {
  ok: boolean
  message: string
  /** 归一后的标准值：温度原样、天数按台账口径统一、瓶数取整 */
  normalized?: { temp: number; days: number; contaminated: number }
  contaminated?: boolean
}

/** 取台账中命中的现行温度区间（端点闭区间） */
export function matchStage(temp: number): IncubationStage | undefined {
  return MEDIAFILL_STAGES.find((stage) => temp >= stage.minTemp && temp <= stage.maxTemp)
}

/**
 * 按现行区间校验一次判定输入。
 * 返回 normalized 时，培养天数已按台账口径统一（温度与天数不一致的归一处理）。
 */
export function validateJudgeInput(input: JudgeInput, row: EntryRow): JudgeValidation {
  // 三项必须一次写全，缺一项都不允许保存
  const missing = JUDGE_REQUIRED_FIELDS.filter((field) => input[field].trim() === '')
  if (missing.length > 0) {
    return { ok: false, message: `培养温度、培养天数与污染瓶数应一次写全，缺少：${missing.join('、')}` }
  }

  const temp = Number(input.培养温度)
  const days = Number(input.培养天数)
  const contaminated = Number(input.污染瓶数)

  if (Number.isNaN(temp)) {
    return { ok: false, message: '培养温度须为数值（℃），未按台账填写，不允许保存' }
  }
  const stage = matchStage(temp)
  if (!stage) {
    return {
      ok: false,
      message: `培养温度 ${temp}℃ 不在现行区间（20～25℃ 或 30～35℃）内，按现行区间重判，本次不予保存`,
    }
  }

  if (!Number.isFinite(days) || days <= 0 || !Number.isInteger(days)) {
    return { ok: false, message: '培养天数须为正整数，未按台账填写，不允许保存' }
  }

  if (!Number.isFinite(contaminated) || !Number.isInteger(contaminated)) {
    return { ok: false, message: '污染瓶数须为整数，未按台账填写，不允许保存' }
  }
  // 极值挡回：负数或超过本批灌装批量
  if (contaminated < 0) {
    return { ok: false, message: '污染瓶数不能为负，取到极值，本次判定挡回' }
  }
  const batchSize = Number(row.灌装批量)
  if (Number.isFinite(batchSize) && batchSize > 0 && contaminated > batchSize) {
    return {
      ok: false,
      message: `污染瓶数 ${contaminated} 超过本批灌装批量 ${batchSize}，取到极值，本次判定挡回`,
    }
  }

  // 温度与天数不一致时，按台账温度区间对应的标准天数统一
  const normalizedDays = stage.standardDays

  return {
    ok: true,
    message:
      days !== normalizedDays
        ? `培养天数与台账口径不一致，已按「${stage.label}」统一为 ${normalizedDays} 天`
        : '',
    normalized: { temp, days: normalizedDays, contaminated },
    contaminated: contaminated > 0,
  }
}

/** 台账总条数：规则就收成这一份，页面只读展示。 */
export function ledgerRules(): string[] {
  return [
    '培养分两段：20～25℃、30～35℃，每段各 7 天，合计 14 天。',
    '培养温度须落在现行区间，区间外按现行区间重判，不予保存。',
    '培养温度与培养天数不一致时，按台账温度区间对应的标准天数统一。',
    '培养温度、培养天数、污染瓶数必须一次写全，否则不允许保存。',
    '污染瓶数为负或超过灌装批量（极值）一律挡回。',
    '污染瓶数 > 0 判污染，走终止；为 0 判合格。',
    '只有灌装岗的复核人能确认判定，越权提交一律拒绝。',
    '状态单向推进（待灌装 → 灌装中 → 已判定 / 已终止），越级一律挡回。',
    '同一批灌装重复判定只算一次；合格判定落一条稳定性考察待办。',
  ]
}
