<template>
  <section class="page" data-module="mediafill-detail">
    <header class="page-head">
      <div>
        <h2>模拟灌装记录详情 · {{ row?.灌装编号 ?? '未找到' }}</h2>
        <p class="page-desc">详情与列表读取同一份数据；在此执行判定与返回列表，两处结果一致、不走样。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回列表</button>
      </div>
    </header>

    <div v-if="!row" class="empty-state detail-missing">
      没有找到该条模拟灌装记录（可能已被重置）。
      <RouterLink class="link" to="/mediafill">返回列表</RouterLink>
    </div>

    <template v-else>
      <div class="operator-bar">
        <span class="operator-label">当前操作人：</span>
        <select :value="session.operator" @change="onSwitchOperator(($event.target as HTMLSelectElement).value)">
          <option v-for="op in OPERATORS" :key="op.name" :value="op.name">
            {{ op.name }} · {{ op.station }} · {{ op.role }}
          </option>
        </select>
        <span v-if="!canJudge" class="error-text">当前操作人不是灌装岗复核人，确认判定会被拒绝。</span>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in fields" :key="field">
            <th>{{ field }}</th>
            <td>{{ display(field) }}</td>
          </tr>
          <tr>
            <th>当前状态</th>
            <td>
              <strong>{{ row.status }}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="detail-actions">
        <button v-if="row.status === '待灌装'" class="btn" type="button" @click="doSubmit(row)">
          提交灌装
        </button>
        <button class="btn primary" type="button" @click="openJudge(row)">
          {{ row.status === '已判定' ? '按现行区间重判' : '判定结果' }}
        </button>
        <button v-if="row.status === '灌装中'" class="btn" type="button" @click="doTerminate(row)">
          终止灌装
        </button>
        <span v-if="row.status === '已终止'" class="muted-text">该批已终止，状态不再推进。</span>
      </div>

      <footer class="page-foot">
        <span v-if="feedback" :class="feedbackOk ? 'notice-text' : 'error-text'">{{ feedback }}</span>
      </footer>

      <section v-if="linkedTodos.length" class="linked-box">
        <h3>联动的稳定性考察待办</h3>
        <ul>
          <li v-for="todo in linkedTodos" :key="String(todo.id)">
            {{ todo.考察编号 }} · {{ todo.考察批号 }} · {{ todo.考察状态 }}
          </li>
        </ul>
      </section>
    </template>

    <JudgeDialog :open="dialogOpen" :row="judgingRow" :on-judge="doJudge" @close="closeJudge" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'

import { getMediafill } from '@/api/mediafill-service'
import { listRows } from '@/data/local-store'
import { moduleMeta } from '@/api/local-service'
import { OPERATORS, useSessionStore } from '@/stores/session'
import { MEDIAFILL_KEY, STABILITY_KEY } from '@/data/mediafill-ledger'
import type { EntryRow } from '@/data/types'
import JudgeDialog from './JudgeDialog.vue'
import { useMediafillActions } from './use-mediafill-actions'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const meta = moduleMeta(MEDIAFILL_KEY)
const fields = meta.fields

const row = ref<EntryRow | null>(null)
const stabilityRows = ref<EntryRow[]>([])

const linkedTodos = computed(() =>
  stabilityRows.value.filter((todo) => String(todo.来源灌装编号 ?? '') === String(row.value?.灌装编号 ?? '')),
)

const {
  feedback,
  feedbackOk,
  judgingRow,
  dialogOpen,
  canJudge,
  openJudge,
  closeJudge,
  doSubmit,
  doTerminate,
  doJudge,
} = useMediafillActions(reload)

function display(field: string): string {
  const value = row.value?.[field]
  return value === '' || value == null ? '—' : String(value)
}

function onSwitchOperator(name: string) {
  const next = OPERATORS.find((item) => item.name === name)
  if (next) {
    session.switchOperator(next)
  }
}

function goBack() {
  router.push('/mediafill')
}

function reload() {
  const id = Number(route.params.id)
  // 详情始终回源读取，列表/详情共用 listRows 这一份
  row.value = getMediafill(id) ?? null
  stabilityRows.value = listRows(STABILITY_KEY)
}

onMounted(reload)
// 离开详情（如判定后返回）前无需额外处理：数据已在同一份 store 中
onBeforeRouteLeave(() => true)
</script>
