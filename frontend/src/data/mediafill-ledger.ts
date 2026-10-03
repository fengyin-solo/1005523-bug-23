/**
 * 培养基模拟灌装判定台账（单一口径）
 *
 * 列表、详情、判定弹窗、登记弹窗、复核动作、稳定性考察待办都从这里取数，
 * 不允许页面各写一份标准。温度/天数/污染瓶数的有效区间以本台账为准。
 */

export const MEDIAFILL_KEY = 'mediafill'
export const STABILITY_KEY = 'stability'

export const MEDIAFILL_STATUS = {
  pending: '待灌装',
  filling: '灌装中',
  judged: '已判定',
  terminated: '已终止',
} as const

/** 状态只能沿这条链单向推进；已判定 / 已终止都是终态，任何动作都不能再改状态。 */
export const MEDIAFILL_STATUSES = [
  MEDIAFILL_STATUS.pending,
  MEDIAFILL_STATUS.filling,
  MEDIAFILL_STATUS.judged,
  MEDIAFILL_STATUS.terminated,
] as const

export const MEDIAFILL_ORDER: Record<string, number> = MEDIAFILL_STATUSES.reduce(
  (acc, status, index) => ({ ...acc, [status]: index }),
  {} as Record<string, number>,
)

/** 允许的相邻推进：越级（待灌装 → 已判定）一律挡回。 */
export const MEDIAFILL_TRANSITIONS: Record<string, string[]> = {
  [MEDIAFILL_STATUS.pending]: [MEDIAFILL_STATUS.filling],
  [MEDIAFILL_STATUS.filling]: [MEDIAFILL_STATUS.judged, MEDIAFILL_STATUS.terminated],
  [MEDIAFILL_STATUS.judged]: [],
  [MEDIAFILL_STATUS.terminated]: [],
}

export const MEDIAFILL_FIELDS = [
  '灌装编号',
  '灌装规格',
  '灌装批量',
  '培养温度',
  '培养天数',
  '污染瓶数',
  '判定结论',
  '复核人',
  '判定日期',
] as const

/** 判定时必须一次性写全的三项，缺一项都不允许保存。 */
export const JUDGE_REQUIRED_FIELDS = ['培养温度', '培养天数', '污染瓶数'] as const

/**
 * 培养温度区间档：温度与天数必须落在同一档。
 * 档与档之间温度不重叠，所以温度唯一决定该走哪一档的天数区间。
 */
export type CultureProfile = {
  key: string
  label: string
  tempMin: number
  tempMax: number
  dayMin: number
  dayMax: number
  /** 温度合法但天数不在本档区间时，统一修正到的台账口径值 */
  standardDays: number
}

export const CULTURE_PROFILES: CultureProfile[] = [
  { key: 'low', label: '低温档 20～25℃', tempMin: 20, tempMax: 25, dayMin: 7, dayMax: 14, standardDays: 14 },
  { key: 'high', label: '高温档 30～35℃', tempMin: 30, tempMax: 35, dayMin: 7, dayMax: 14, standardDays: 7 },
]

/** 现行区间下的合格判据：污染瓶数为 0 才合格；只要大于 0 就按污染走终止。 */
export function conclusionFor(contaminated: number): '合格' | '污染' {
  return contaminated > 0 ? '污染' : '合格'
}

/** 岗位：只有本岗位（灌装复核岗）的复核人推得动「确认判定」。 */
export const ROLE_OPERATOR = '灌装操作岗'
export const ROLE_REVIEWER = '灌装复核岗'
export const ROLE_INSPECTOR = '巡检岗'

export const SESSION_ROLES = [ROLE_OPERATOR, ROLE_REVIEWER, ROLE_INSPECTOR] as const

/** 各动作允许的岗位；不在名单里一律拒绝。 */
export const ACTION_ROLES: Record<string, string[]> = {
  提交灌装: [ROLE_OPERATOR],
  确认判定: [ROLE_REVIEWER],
  终止灌装: [ROLE_OPERATOR, ROLE_REVIEWER],
}

export type JudgeInput = {
  培养温度: string | number
  培养天数: string | number
  污染瓶数: string | number
}

export type JudgeValidation = {
  ok: boolean
  message: string
  /** 校验通过后、按台账统一好的数值 */
  normalized?: {
    培养温度: number
    培养天数: number
    污染瓶数: number
    判定结论: '合格' | '污染'
  }
  /** 温度合法但天数越界，被台账口径统一时给出的提示 */
  warnings: string[]
}

function asCount(value: string | number): number {
  if (typeof value === 'number') return value
  const trimmed = value.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number.NaN
  }
  return Number(trimmed)
}

function isInteger(value: number): boolean {
  return Number.isInteger(value)
}

/**
 * 按现行台账区间校验并统一一次判定填报：
 * - 三项必须一次写全；
 * - 温度决定档，天数与该档不一致时按台账标准天数统一；
 * - 污染瓶数取极值（负数、非整数、超过灌装批量）一律挡回。
 */
export function validateJudgeInput(input: Partial<JudgeInput>, batchSize: number): JudgeValidation {
  const warnings: string[] = []

  for (const field of JUDGE_REQUIRED_FIELDS) {
    const raw = input[field]
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return { ok: false, message: `培养温度、培养天数与污染瓶数必须一次写全，缺少「${field}」不允许保存`, warnings }
    }
  }

  const temperature = asCount(input.培养温度 as string | number)
  if (!Number.isFinite(temperature)) {
    return { ok: false, message: '培养温度必须是数值（℃），未按台账标准填写不允许保存', warnings }
  }
  const profile = CULTURE_PROFILES.find(
    (item) => temperature >= item.tempMin && temperature <= item.tempMax,
  )
  if (!profile) {
    return {
      ok: false,
      message: `培养温度 ${temperature}℃ 不在台账区间（低温 20～25℃ / 高温 30～35℃）内，未按标准填写不允许保存`,
      warnings,
    }
  }

  const days = asCount(input.培养天数 as string | number)
  if (!Number.isFinite(days) || !isInteger(days)) {
    return { ok: false, message: '培养天数必须是整数（天），未按台账标准填写不允许保存', warnings }
  }
  let standardDays = days
  if (days < profile.dayMin || days > profile.dayMax) {
    standardDays = profile.standardDays
    warnings.push(
      `培养天数 ${days} 天与温度所属「${profile.label}」不一致，已按台账口径统一为 ${profile.standardDays} 天`,
    )
  }

  const contaminated = asCount(input.污染瓶数 as string | number)
  if (!Number.isFinite(contaminated) || !isInteger(contaminated) || contaminated < 0) {
    return { ok: false, message: '污染瓶数必须是不小于 0 的整数，取极值（负数 / 非整数）一律挡回', warnings }
  }
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    return { ok: false, message: '该批灌装批量缺失或非法，无法按区间核对污染瓶数，请先补全批量', warnings }
  }
  if (contaminated > batchSize) {
    return {
      ok: false,
      message: `污染瓶数 ${contaminated} 超过灌装批量 ${batchSize}，取极值挡回，不允许保存`,
      warnings,
    }
  }

  return {
    ok: true,
    message: '',
    normalized: {
      培养温度: temperature,
      培养天数: standardDays,
      污染瓶数: contaminated,
      判定结论: conclusionFor(contaminated),
    },
    warnings,
  }
}
