<template>
  <section class="page" data-module="mediafill">
    <header class="page-head">
      <div>
        <h2>培养基模拟灌装管理</h2>
        <p class="page-desc">维护模拟灌装记录，温度 / 天数 / 污染瓶数统一按判定台账口径；状态单向推进，污染批自动终止并落入稳定性考察待办。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showCreate = true">登记模拟灌装记录</button>
        <button class="btn" type="button" @click="runRejudge">按现行区间重判</button>
        <button class="btn" type="button" @click="exportRows">导出培养基模拟灌装清单</button>
      </div>
    </header>

    <div class="ledger-card">
      <h3>判定台账（规则只认这一份）</h3>
      <div class="ledger-grid">
        <span><b>状态链：</b>待灌装 → 灌装中 → 已判定 / 已终止；越级与回退一律挡回，终态锁定</span>
        <span><b>培养区间：</b>低温档 20～25℃（14 天）、高温档 30～35℃（7 天）；天数 7～14 天，温度决定档</span>
        <span><b>污染判据：</b>污染瓶数 0 判合格；&gt; 0 走终止，并在稳定性考察生成待办（同编号只一条）</span>
        <span><b>极值拦截：</b>污染瓶数须为 0～灌装批量的整数，负数 / 非整数 / 超批量一律挡回</span>
        <span><b>岗位权限：</b>提交灌装限灌装操作岗；确认判定限灌装复核岗；越权提交一律拒绝</span>
        <span><b>判定填报：</b>培养温度、培养天数、污染瓶数必须一次写全，缺一项不允许保存</span>
      </div>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待灌装批次</span>
        <strong class="stat-value">{{ stats.pending }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">灌装中批次</span>
        <strong class="stat-value">{{ stats.filling }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">污染瓶总数（台账口径）</span>
        <strong class="stat-value">{{ stats.contaminatedBottles }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">当前岗位：{{ store.role }}</span>
    </p>

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
              {{ display(row, column) }}
            </RouterLink>
            <span v-else :class="conclusionClass(column, row)">{{ display(row, column) }}</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="row.status === '待灌装'"
              class="link-btn"
              type="button"
              @click="runSubmit(row)"
            >提交灌装</button>
            <button
              v-if="row.status === '灌装中'"
              class="link-btn"
              type="button"
              @click="openJudge(row)"
            >确认判定</button>
            <button
              v-if="row.status === '灌装中'"
              class="link-btn"
              type="button"
              @click="runTerminate(row)"
            >终止灌装</button>
            <RouterLink class="link-btn" :to="`/mediafill/${row.id}`">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无培养基模拟灌装数据，可先登记模拟灌装记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条培养基模拟灌装记录（同一灌装编号只保留一条）</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <CreateDialog v-if="showCreate" @close="showCreate = false" @submit="createRow" />
    <JudgeDialog
      v-if="judgeRow"
      :row="judgeRow"
      :actor="actor"
      @close="judgeRow = null"
      @submit="submitJudge"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  createRecord,
  judgeFill,
  listMediafill,
  mediafillStats,
  mediafillDisplayValue,
  rejudgeAll,
  submitFill,
  terminateFill,
} from '@/api/mediafill-service'
import { MEDIAFILL_STATUSES } from '@/data/mediafill-ledger'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import CreateDialog from './CreateDialog.vue'
import JudgeDialog from './JudgeDialog.vue'

const store = useSessionStore()
const actor = computed(() => ({ operator: store.operator, role: store.role }))

const columns = ['灌装编号', '灌装规格', '灌装批量', '培养温度', '培养天数', '污染瓶数', '判定结论', '复核人']
const filterFields = ['灌装编号', '灌装规格']

const rows = ref<EntryRow[]>([])
const message = ref('')
const messageOk = ref(false)
const filters = reactive<Record<string, string>>({})
const showCreate = ref(false)
const judgeRow = ref<EntryRow | null>(null)

const stats = ref(mediafillStats())
const statusSummary = computed(() =>
  MEDIAFILL_STATUSES.map((status) => ({
    status,
    count: stats.value.statusCounts[status] ?? 0,
  })),
)

function display(row: EntryRow, field: string) {
  return mediafillDisplayValue(row, field)
}

function conclusionClass(column: string, row: EntryRow) {
  if (column !== '判定结论') return ''
  if (row['判定结论'] === '污染') return 'tag-polluted'
  if (row['判定结论'] === '合格') return 'tag-pass'
  return ''
}

function flash(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function resetFilters() {
  for (const key of Object.keys(filters)) {
    filters[key] = ''
  }
  reload()
}

function exportRows() {
  downloadEntries('mediafill')
}

function createRow(payload: { 灌装编号: string; 灌装规格: string; 灌装批量: string }) {
  const result = createRecord(payload)
  flash(result.ok, result.message)
  if (result.ok) {
    showCreate.value = false
    reload()
  }
}

function runSubmit(row: EntryRow) {
  const result = submitFill(Number(row.id), actor.value)
  flash(result.ok, result.message)
  reload()
}

function openJudge(row: EntryRow) {
  message.value = ''
  judgeRow.value = row
}

function submitJudge(payload: Record<string, string>) {
  if (!judgeRow.value) return
  const result = judgeFill(Number(judgeRow.value.id), payload, actor.value)
  const full = [result.message, ...result.warnings].filter(Boolean).join('；')
  flash(result.ok, full)
  if (result.ok) {
    judgeRow.value = null
  }
  reload()
}

function runTerminate(row: EntryRow) {
  const result = terminateFill(Number(row.id), actor.value)
  flash(result.ok, result.message)
  reload()
}

function runRejudge() {
  const result = rejudgeAll()
  flash(true, result.message)
  reload()
}

function reload() {
  rows.value = listMediafill(filters)
  stats.value = mediafillStats()
}

onMounted(reload)
</script>
