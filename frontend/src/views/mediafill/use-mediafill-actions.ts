import { computed, ref } from 'vue'

import {
  judgeMediafill,
  submitFilling,
  terminateFilling,
} from '@/api/mediafill-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'
import type { JudgeInput } from '@/data/mediafill-ledger'

export type ActionFeedback = { ok: boolean; message: string; normalizedDays?: number }

/**
 * 模拟灌装动作的唯一交互入口：列表页与详情页共用，
 * 保证从列表点开详情再返回，两处执行结果与展示完全一致。
 */
export function useMediafillActions(reload: () => void) {
  const session = useSessionStore()
  const feedback = ref('')
  const feedbackOk = ref(true)
  const judgingRow = ref<EntryRow | null>(null)
  const dialogOpen = ref(false)

  const operator = computed(() => session.currentOperator)
  const canJudge = computed(() => session.canConfirmMediafill)

  function notify(result: ActionFeedback) {
    feedback.value = result.message
    feedbackOk.value = result.ok
  }

  function openJudge(row: EntryRow) {
    feedback.value = ''
    judgingRow.value = row
    dialogOpen.value = true
  }

  function closeJudge() {
    dialogOpen.value = false
    judgingRow.value = null
  }

  function doSubmit(row: EntryRow) {
    notify(submitFilling(Number(row.id), operator.value))
    if (feedbackOk.value) {
      reload()
    }
  }

  function doTerminate(row: EntryRow) {
    notify(terminateFilling(Number(row.id), operator.value))
    if (feedbackOk.value) {
      reload()
    }
  }

  function doJudge(input: JudgeInput): ActionFeedback {
    if (!judgingRow.value) {
      return { ok: false, message: '未选择要判定的灌装批' }
    }
    const result = judgeMediafill(Number(judgingRow.value.id), input, operator.value)
    notify(result)
    if (result.ok) {
      reload()
    }
    return result
  }

  return {
    session,
    feedback,
    feedbackOk,
    judgingRow,
    dialogOpen,
    operator,
    canJudge,
    openJudge,
    closeJudge,
    doSubmit,
    doTerminate,
    doJudge,
  }
}
