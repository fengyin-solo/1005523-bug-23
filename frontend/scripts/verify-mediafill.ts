import { runAction, listEntries } from '../src/api/local-service'
import {
  judgeMediafill,
  submitFilling,
  terminateFilling,
  getMediafill,
} from '../src/api/mediafill-service'
import { listRows } from '../src/data/local-store'
import { STABILITY_KEY } from '../src/data/mediafill-ledger'
import type { Operator } from '../src/data/types'

const reviewer: Operator = { name: '周复核', station: '灌装岗', role: '复核人' }
const operator: Operator = { name: '王灌装', station: '灌装岗', role: '操作工' }
const qc: Operator = { name: '李检验', station: '成品检验岗', role: '复核人' }

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    console.log(`  ✗ ${name} ${extra}`)
  }
}

// 1. 已判定不能被「提交灌装」拽回灌装中（通用状态机挡回退）
const r1 = runAction('mediafill', 4, '提交灌装')
check('已判定批被提交灌装拽回 -> 挡回', !r1.ok && getMediafill(4)?.status === '已判定', r1.message)

// 2. 越级挡回：待灌装不能直接判定结果（通用动作）
const r2 = runAction('mediafill', 1, '判定结果')
check('待灌装越级到已判定 -> 挡回', !r2.ok, r2.message)

// 3. 本岗位复核人权限：操作工 / 外岗位复核人越权拒绝
const r3 = judgeMediafill(3, { 培养温度: '22', 培养天数: '7', 污染瓶数: '0' }, operator)
check('灌装岗操作工确认判定 -> 越权拒绝', !r3.ok, r3.message)
const r3b = judgeMediafill(3, { 培养温度: '22', 培养天数: '7', 污染瓶数: '0' }, qc)
check('成品检验岗复核人确认判定 -> 越权拒绝', !r3b.ok, r3b.message)

// 4. 三项一次写全
const r4 = judgeMediafill(3, { 培养温度: '22', 培养天数: '', 污染瓶数: '0' }, reviewer)
check('培养天数缺失 -> 不允许保存', !r4.ok, r4.message)

// 5. 现行区间：37℃ 区间外重判挡回（id2 老口径 37℃/10天）
const r5 = judgeMediafill(2, { 培养温度: '37', 培养天数: '10', 污染瓶数: '0' }, reviewer)
check('37℃ 不在现行区间 -> 按现行区间重判挡回', !r5.ok, r5.message)

// 6. 温度与天数不一致 -> 按台账统一为 7 天；合格判定 + 稳定性待办
const beforeTodos = listRows(STABILITY_KEY).filter((t) => String(t.来源灌装编号) === 'MEDI-2026-003').length
const r6 = judgeMediafill(3, { 培养温度: '22.5', 培养天数: '5', 污染瓶数: '0' }, reviewer)
const row3 = getMediafill(3)
check('合格判定成功', r6.ok && row3?.status === '已判定' && row3?.判定结论 === '合格', r6.message)
check('天数 5 与温度不一致 -> 统一为台账 7 天', Number(row3?.培养天数) === 7)
const afterTodos = listRows(STABILITY_KEY).filter((t) => String(t.来源灌装编号) === 'MEDI-2026-003')
check('合格判定落一条稳定性考察待办', afterTodos.length === beforeTodos + 1 && afterTodos[0]?.status === '待考察')

// 7. 同一批重复判定只算一次（仍合格）
const todosBefore = listRows(STABILITY_KEY).filter((t) => String(t.来源灌装编号) === 'MEDI-2026-003').length
const r7 = judgeMediafill(3, { 培养温度: '22.5', 培养天数: '7', 污染瓶数: '0' }, reviewer)
const todosAfter = listRows(STABILITY_KEY).filter((t) => String(t.来源灌装编号) === 'MEDI-2026-003').length
check('已判定合格再判合格 -> 只算一次，不重复落待办', !r7.ok && todosAfter === todosBefore, r7.message)

// 8. 已判定批重判为污染 -> 走终止；已落待办被终止
const r8 = judgeMediafill(3, { 培养温度: '22.5', 培养天数: '7', 污染瓶数: '3' }, reviewer)
const row3b = getMediafill(3)
check('已判定批重判污染 -> 转已终止', r8.ok && row3b?.status === '已终止' && row3b?.判定结论 === '污染终止', r8.message)
const todo3 = listRows(STABILITY_KEY).filter((t) => String(t.来源灌装编号) === 'MEDI-2026-003')
check('对应稳定性待办随污染终止', todo3.every((t) => t.status === '已终止'))

// 9. 极值挡回：负数 / 超批量
const r9a = judgeMediafill(2, { 培养温度: '22', 培养天数: '7', 污染瓶数: '-1' }, reviewer)
check('污染瓶数负数 -> 极值挡回', !r9a.ok, r9a.message)
const r9b = judgeMediafill(2, { 培养温度: '22', 培养天数: '7', 污染瓶数: '999999' }, reviewer)
check('污染瓶数超批量 8000 -> 极值挡回', !r9b.ok, r9b.message)

// 10. 首判污染 -> 已终止，不落待办
const todos002Before = listRows(STABILITY_KEY).filter((t) => String(t.来源灌装编号) === 'MEDI-2026-002').length
const r10 = judgeMediafill(2, { 培养温度: '32', 培养天数: '7', 污染瓶数: '2' }, reviewer)
const row2 = getMediafill(2)
check('首判污染 -> 已终止/污染终止', r10.ok && row2?.status === '已终止' && Number(row2?.污染瓶数) === 2, r10.message)
const todos002 = listRows(STABILITY_KEY).filter((t) => String(t.来源灌装编号) === 'MEDI-2026-002')
check('污染批不落稳定性待办', todos002.length === todos002Before)

// 11. 待灌装 -> 提交灌装（灌装岗）成功；外岗位拒绝
const r11 = submitFilling(1, qc)
check('外岗位提交灌装 -> 越权拒绝', !r11.ok, r11.message)
const r11b = submitFilling(1, operator)
check('灌装岗提交灌装 待灌装->灌装中', r11b.ok && getMediafill(1)?.status === '灌装中', r11b.message)
const r11c = submitFilling(1, operator)
check('灌装中再次提交灌装 -> 重复/回退挡回', !r11c.ok, r11c.message)

// 12. 手动终止 + 终止后状态封死
const r12 = terminateFilling(1, reviewer)
check('灌装中手动终止 -> 已终止', r12.ok && getMediafill(1)?.status === '已终止', r12.message)
const r12b = judgeMediafill(1, { 培养温度: '22', 培养天数: '7', 污染瓶数: '0' }, reviewer)
check('已终止不能再判定', !r12b.ok, r12b.message)

// 13. 列表与详情同源：listEntries 与 getMediafill 数据一致
const listItem = listEntries('mediafill', { 灌装编号: 'MEDI-2026-004' }).items[0]
check('列表/详情同一编号污染瓶数属同一份', String(listItem?.污染瓶数) === String(getMediafill(4)?.污染瓶数))
const mediaRows = listEntries('mediafill').items
check('同 id 不重复出现', new Set(mediaRows.map((r) => r.id)).size === mediaRows.length)

// 14. 污染瓶总数口径：只从这一份行求和
const totalContaminated = listEntries('mediafill').items.reduce((s, r) => {
  const n = Number(r.污染瓶数)
  return Number.isFinite(n) && n > 0 ? s + n : s
}, 0)
check('污染瓶总数=各污染瓶数之和(3+2=5)', totalContaminated === 5, `实际 ${totalContaminated}`)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
