<template>
  <section v-if="row" class="page" data-module="mediafill-detail">
    <header class="page-head">
      <div>
        <h2>模拟灌装详情 · {{ row['灌装编号'] }}</h2>
        <p class="page-desc">与列表取自同一份数据：培养温度、培养天数、污染瓶数全部按判定台账口径统一显示。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn ghost" to="/mediafill">返回列表</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">当前状态</span>
        <strong class="stat-value">{{ row.status }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">判定结论</span>
        <strong :class="row['判定结论'] === '污染' ? 'tag-polluted' : 'tag-pass'">{{ row['判定结论'] || '—' }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">复核人 / 判定日期</span>
        <strong class="stat-value" style="font-size: 15px">{{ row['复核人'] || '—' }} / {{ row['判定日期'] || '—' }}</strong>
      </article>
    </div>

    <div class="detail-grid">
      <div v-for="field in detailFields" :key="field" class="detail-item">
        <span class="k">{{ field }}</span>
        <span class="v">{{ row[field] === '' || row[field] === undefined ? '—' : row[field] }}</span>
      </div>
    </div>

    <div class="ledger-card">
      <h3>本批可执行动作</h3>
      <div class="row-actions">
        <button v-if="row.status === '待灌装'" class="btn" type="button" @click="runSubmit">提交灌装（灌装操作岗）</button>
        <button v-if="row.status === '灌装中'" class="btn primary" type="button" @click="judging = true">确认判定（灌装复核岗）</button>
        <button v-if="row.status === '灌装中'" class="btn" type="button" @click="runTerminate">终止灌装</button>
        <span v-if="row.status === '已判定' || row.status === '已终止'" class="page-desc">
          已处于终态「{{ row.status }}」，状态单向推进，任何动作都不能再改。
        </span>
      </div>
      <p v-if="message" class="form-message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</p>
    </div>

    <JudgeDialog v-if="judging" :row="row" :actor="actor" @close="judging = false" @submit="submitJudge" />
  </section>

  <section v-else class="page">
    <p class="error-text">找不到该条模拟灌装记录，可能已被去重剔除。</p>
    <RouterLink class="back-link" to="/mediafill">← 返回列表</RouterLink>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { judgeFill, submitFill, terminateFill, getMediafill } from '@/api/mediafill-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import JudgeDialog from './JudgeDialog.vue'

const route = useRoute()
const store = useSessionStore()
const actor = computed(() => ({ operator: store.operator, role: store.role }))

const detailFields = ['灌装编号', '灌装规格', '灌装批量', '培养温度', '培养天数', '污染瓶数', '判定结论', '复核人', '判定日期']

// 详情与列表都走 getMediafill/listMediafill 这同一个数据源，不存在「显示的不是同一条」。
const row = ref<EntryRow | null>(getMediafill(Number(route.params.id)))
const message = ref('')
const messageOk = ref(false)
const judging = ref(false)

function flash(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function refresh() {
  row.value = getMediafill(Number(route.params.id))
}

function runSubmit() {
  if (!row.value) return
  const result = submitFill(Number(row.value.id), actor.value)
  flash(result.ok, result.message)
  refresh()
}

function runTerminate() {
  if (!row.value) return
  const result = terminateFill(Number(row.value.id), actor.value)
  flash(result.ok, result.message)
  refresh()
}

function submitJudge(payload: Record<string, string>) {
  if (!row.value) return
  const result = judgeFill(Number(row.value.id), payload, actor.value)
  flash(result.ok, [result.message, ...result.warnings].filter(Boolean).join('；'))
  if (result.ok) {
    judging.value = false
    refresh()
  }
}
</script>
