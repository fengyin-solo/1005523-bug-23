<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal-panel">
      <h3>确认判定 · {{ row['灌装编号'] }}</h3>
      <div class="ledger-grid">
        <span><b>判定台账：</b>低温 20～25℃ / 高温 30～35℃；天数 7～14 天</span>
        <span><b>批量：</b>{{ row['灌装批量'] }} 瓶；污染瓶数须在 0～批量之间</span>
      </div>
      <div class="form-grid">
        <label class="form-field">
          <span>培养温度（℃）*</span>
          <input v-model.trim="form.培养温度" type="number" step="0.1" placeholder="如 22.5" />
        </label>
        <label class="form-field">
          <span>培养天数（天）*</span>
          <input v-model.trim="form.培养天数" type="number" step="1" placeholder="如 14" />
        </label>
        <label class="form-field full">
          <span>污染瓶数（瓶，0～{{ row['灌装批量'] }}）*</span>
          <input v-model.trim="form.污染瓶数" type="number" step="1" min="0" :max="Number(row['灌装批量'])" placeholder="三项一次写全" />
        </label>
        <label class="form-field">
          <span>复核人</span>
          <input :value="actor.operator" disabled />
        </label>
        <label class="form-field">
          <span>判定日期</span>
          <input v-model.trim="form.判定日期" type="date" />
        </label>
      </div>
      <p v-if="errorMessage" class="form-message error-text">{{ errorMessage }}</p>
      <p v-for="(warning, index) in warnings" :key="index" class="form-message warn-text">{{ warning }}</p>
      <div class="modal-actions">
        <button class="btn ghost" type="button" @click="$emit('close')">取消</button>
        <button class="btn primary" type="button" @click="submit">提交判定</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'

import { validateJudgeInput } from '@/data/mediafill-ledger'
import type { EntryRow } from '@/data/types'

const props = defineProps<{
  row: EntryRow
  actor: { operator: string; role: string }
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: Record<string, string>]
}>()

const form = reactive({
  培养温度: String(props.row['培养温度'] ?? ''),
  培养天数: String(props.row['培养天数'] ?? ''),
  污染瓶数: String(props.row['污染瓶数'] ?? ''),
  判定日期: new Date().toISOString().slice(0, 10),
})

const errorMessage = ref('')
const warnings = ref<string[]>([])

function submit() {
  errorMessage.value = ''
  warnings.value = []
  const batchSize = Number(props.row['灌装批量'])
  const result = validateJudgeInput(
    {
      培养温度: form.培养温度,
      培养天数: form.培养天数,
      污染瓶数: form.污染瓶数,
    },
    batchSize,
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  warnings.value = result.warnings
  emit('submit', {
    培养温度: String(result.normalized?.培养温度 ?? form.培养温度),
    培养天数: String(result.normalized?.培养天数 ?? form.培养天数),
    污染瓶数: String(result.normalized?.污染瓶数 ?? form.污染瓶数),
    判定日期: form.判定日期,
  })
}
</script>
