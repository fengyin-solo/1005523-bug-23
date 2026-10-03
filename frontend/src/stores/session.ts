import { defineStore } from 'pinia'

import { ROLE_REVIEWER, SESSION_ROLES } from '@/data/mediafill-ledger'

const OPERATOR_BY_ROLE: Record<string, string> = {
  灌装操作岗: '张某',
  灌装复核岗: '李某',
  巡检岗: '赵某',
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: OPERATOR_BY_ROLE[ROLE_REVIEWER],
    role: ROLE_REVIEWER as string,
    roles: [...SESSION_ROLES] as string[],
    shiftLabel: '白班 08:00-20:00',
    scope: '制药企业洁净区与批生产记录管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isReviewer: (state) => state.role === ROLE_REVIEWER,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    // 演示用：切换当前登录人的岗位，越权提交应被业务服务拒绝
    switchRole(role: string) {
      this.role = role
      this.operator = OPERATOR_BY_ROLE[role] ?? this.operator
    },
  },
})
