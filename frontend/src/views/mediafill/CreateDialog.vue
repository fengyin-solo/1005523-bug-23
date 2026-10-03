<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal-panel">
      <h3>登记模拟灌装记录</h3>
      <div class="form-grid">
        <label class="form-field full">
          <span>灌装编号 *</span>
          <input v-model.trim="form.灌装编号" placeholder="如 MEDI-2610-01；同一编号不可重复登记" />
        </label>
        <label class="form-field full">
          <span>灌装规格 *</span>
          <input v-model.trim="form.灌装规格" placeholder="如 100ml 西林瓶" />
        </label>
        <label class="form-field full">
          <span>灌装批量（正整数，瓶）*</span>
          <input v-model.trim="form.灌装批量" type="number" step="1" min="1" placeholder="如 10000" />
        </label>
      </div>
      <p v-if="errorMessage" class="form-message error-text">{{ errorMessage }}</p>
      <div class="modal-actions">
        <button class="btn ghost" type="button" @click="$emit('close')">取消</button>
        <button class="btn primary" type="button" @click="submit">保存登记</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'

const emit = defineEmits<{
  close: []
  submit: [payload: { 灌装编号: string; 灌装规格: string; 灌装批量: string }]
}>()

const form = reactive({ 灌装编号: '', 灌装规格: '', 灌装批量: '' })
const errorMessage = ref('')

function submit() {
  if (!form.灌装编号) {
    errorMessage.value = '灌装编号为必填项，没按标准填写不允许保存'
    return
  }
  if (!form.灌装规格) {
    errorMessage.value = '灌装规格为必填项，没按标准填写不允许保存'
    return
  }
  const batchSize = Number(form.灌装批量)
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    errorMessage.value = '灌装批量必须是正整数，没按标准填写不允许保存'
    return
  }
  errorMessage.value = ''
  emit('submit', { ...form })
}
</script>
