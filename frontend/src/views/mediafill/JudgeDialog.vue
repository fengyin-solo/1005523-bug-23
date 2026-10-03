<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <div class="modal" role="dialog" aria-modal="true">
      <header class="modal-head">
        <h3>确认判定 · {{ row?.灌装编号 }}</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>

      <p class="modal-tip">
        台账口径：培养温度 20～25℃ 或 30～35℃；温度与天数不一致时按台账统一为 7 天/段；
        污染瓶数为 0 判合格，大于 0 判污染终止。三项须一次写全。
      </p>

      <form class="modal-form" @submit.prevent="submit">
        <label class="modal-field">
          <span>培养温度（℃）</span>
          <input v-model="form.培养温度" placeholder="如 22.5 或 32" />
        </label>
        <label class="modal-field">
          <span>培养天数（天）</span>
          <input v-model="form.培养天数" placeholder="如 7" />
        </label>
        <label class="modal-field">
          <span>污染瓶数（瓶）</span>
          <input v-model="form.污染瓶数" :placeholder="`0 ～ ${Number(row?.灌装批量) || '批量'}`" />
        </label>

        <p v-if="error" class="error-text">{{ error }}</p>
        <p v-if="notice" class="notice-text">{{ notice }}</p>

        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="close">取消</button>
          <button class="btn primary" type="submit">确认判定</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

import type { EntryRow } from '@/data/types'
import type { JudgeInput, JudgeValidation } from '@/data/mediafill-ledger'

const props = defineProps<{
  open: boolean
  row: EntryRow | null
  /** 由父级注入判定处理（列表/详情各自调服务，弹窗本身不含业务规则） */
  onJudge: (input: JudgeInput) => JudgeValidation | ({ ok: boolean; message: string; normalizedDays?: number })
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const form = reactive<JudgeInput>({ 培养温度: '', 培养天数: '', 污染瓶数: '' })
const error = ref('')
const notice = ref('')

// 每次打开用该批已有值预填（重判时看到的是同一份数据）
watch(
  () => props.open,
  (open) => {
    if (open && props.row) {
      form.培养温度 = String(props.row.培养温度 ?? '')
      form.培养天数 = String(props.row.培养天数 ?? '')
      form.污染瓶数 = String(props.row.污染瓶数 ?? '')
      error.value = ''
      notice.value = ''
    }
  },
)

function close() {
  emit('close')
}

function submit() {
  error.value = ''
  notice.value = ''
  const result = props.onJudge({ ...form })
  if (!result.ok) {
    error.value = result.message
    return
  }
  if (result.message) {
    notice.value = result.message
  }
  // 成功即关闭；归一/成功提示由父级在主页面展示
  emit('close')
}
</script>
