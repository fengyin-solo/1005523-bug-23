import { defineStore } from 'pinia'
import type { Operator } from '@/data/types'

// 可切换的演示操作人：岗位 + 角色决定能不能推得动「确认判定」。
export const OPERATORS: Operator[] = [
  { name: '周复核', station: '灌装岗', role: '复核人' },
  { name: '王灌装', station: '灌装岗', role: '操作工' },
  { name: '李检验', station: '成品检验岗', role: '复核人' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: OPERATORS[0].name,
    // 当前操作人的岗位与角色：只有「灌装岗 + 复核人」能确认判定
    station: OPERATORS[0].station,
    role: OPERATORS[0].role,
    shiftLabel: '白班 08:00-20:00',
    scope: '制药企业洁净区与批生产记录管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    currentOperator: (state): Operator => ({ name: state.operator, station: state.station, role: state.role }),
    // 只有本岗位（灌装岗）的复核人才推得动确认判定
    canConfirmMediafill(state): boolean {
      return state.station === '灌装岗' && state.role === '复核人'
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchOperator(next: Operator) {
      this.operator = next.name
      this.station = next.station
      this.role = next.role
    },
  },
})
