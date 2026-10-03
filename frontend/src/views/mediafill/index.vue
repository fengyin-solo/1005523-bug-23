<template>
  <section class="page" data-module="mediafill">
    <header class="page-head">
      <div>
        <h2>培养基模拟灌装管理</h2>
        <p class="page-desc">判定口径统一收自台账：培养温度按现行区间，温度/天数不一致按台账统一，污染瓶数取极值挡回。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出培养基模拟灌装清单</button>
      </div>
    </header>

    <div class="operator-bar">
      <span class="operator-label">当前操作人（本岗位复核人才能确认判定）：</span>
      <select :value="session.operator" @change="onSwitchOperator(($event.target as HTMLSelectElement).value)">
        <option v-for="op in OPERATORS" :key="op.name" :value="op.name">
          {{ op.name }} · {{ op.station }} · {{ op.role }}
        </option>
      </select>
      <span class="operator-now">{{ session.operator }}（{{ session.station }} / {{ session.role }}）</span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <details class="ledger-box">
      <summary>判定台账（规则就这一份，未按标准填写不允许保存）</summary>
      <ul>
        <li v-for="rule in rules" :key="rule">{{ rule }}</li>
      </ul>
    </details>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <RouterLink v-if="column === '灌装编号'" class="link" :to="`/mediafill/${row.id}`">
              {{ row[column] ?? '—' }}
            </RouterLink>
            <template v-else>{{ row[column] === '' || row[column] == null ? '—' : row[column] }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="row.status === '待灌装'"
              class="link"
              type="button"
              @click="doSubmit(row)"
            >
              提交灌装
            </button>
            <button
              v-if="row.status === '灌装中' || row.status === '已判定'"
              class="link"
              type="button"
              :title="canJudge ? '按台账填写三项并确认' : '只有灌装岗复核人能确认判定'"
              @click="openJudge(row)"
            >
              {{ row.status === '已判定' ? '按现行区间重判' : '判定结果' }}
            </button>
            <button
              v-if="row.status === '灌装中'"
              class="link danger"
              type="button"
              @click="doTerminate(row)"
            >
              终止灌装
            </button>
            <span v-if="terminal(row)" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无培养基模拟灌装数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条培养基模拟灌装记录（已按编号去重，同一条不重复出现）</span>
      <span v-if="feedback" :class="feedbackOk ? 'notice-text' : 'error-text'">{{ feedback }}</span>
    </footer>

    <JudgeDialog :open="dialogOpen" :row="judgingRow" :on-judge="doJudge" @close="closeJudge" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import { OPERATORS, useSessionStore } from '@/stores/session'
import { ledgerRules } from '@/data/mediafill-ledger'
import type { EntryRow } from '@/data/types'
import JudgeDialog from './JudgeDialog.vue'
import { useMediafillActions } from './use-mediafill-actions'

const meta = moduleMeta('mediafill')
const columns = meta.fields
const filterFields = ['灌装编号', '灌装规格']
const rules = ledgerRules()

const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 统计实时由这一份列表算出：污染瓶总数各入口取同一份，不存在两个口径
const stats = computed(() => [
  { label: '待灌装批次', value: rows.value.filter((row) => row.status === '待灌装').length },
  { label: '灌装中批次', value: rows.value.filter((row) => row.status === '灌装中').length },
  {
    label: '污染瓶总数',
    value: rows.value.reduce((sum, row) => {
      const n = Number(row.污染瓶数)
      return Number.isFinite(n) && n > 0 ? sum + n : sum
    }, 0),
  },
])

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

function terminal(row: EntryRow): boolean {
  return row.status === '已终止'
}

function onSwitchOperator(name: string) {
  const next = OPERATORS.find((item) => item.name === name)
  if (next) {
    session.switchOperator(next)
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
  total.value = payload.total
}

onMounted(reload)
</script>
