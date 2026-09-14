// 训练场端到端验证：真实应用里走一遍"对方说 → AI 拟回复 → 用户示范学习 → 检查学习结果 → 再拟"
// 用法：node verify/verify-train.cjs（应用需以 --remote-debugging-port 启动）
const { connect } = require('../lib/cdp.cjs')

const CONTACT = '训练·测试'

async function main() {
  const cdp = await connect()
  const checks = []
  const check = (name, ok, detail = '') => {
    checks.push({ name, ok })
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  }

  const r1 = await cdp.call(`window.desktopApp.ai.trainLearn({ name: ${JSON.stringify(CONTACT)}, incoming: "在干嘛呢" })`)
  check('对方消息入库', Boolean(r1?.ok), `historyCount=${r1?.historyCount}`)

  const r2 = await cdp.call(`(async()=>{const s=await window.desktopApp.automation.getState();const c=s.contacts.find(c=>c.name===${JSON.stringify(CONTACT)});const d=await window.desktopApp.ai.draft({contact:c,incoming:"在干嘛呢"});return {text:d.text,model:d.model,error:d.error}})()`)
  check('AI 能拟回复', Boolean(r2?.text), r2?.text || r2?.error)

  const r3 = await cdp.call(`window.desktopApp.ai.trainLearn({ name: ${JSON.stringify(CONTACT)}, incoming: "在干嘛呢", userText: "刚醒，你咋这个点醒着哈哈" })`)
  check('用户示范被学习', Boolean(r3?.learned) && r3?.examplesCount >= 1, `样例 ${r3?.examplesCount} 条 · 风格：${r3?.styleSummary}`)

  const r4 = await cdp.call(`(async()=>{const s=await window.desktopApp.automation.getState();const c=s.contacts.find(c=>c.name===${JSON.stringify(CONTACT)});return {examples:c.profile.examples,ownerStyle:c.learning.ownerStyle.summary,msgCount:c.learning.messages.length}})()`)
  check('示范进入说话样例', Array.isArray(r4?.examples) && r4.examples.length >= 1, JSON.stringify(r4?.examples))
  check('风格统计已产出', Boolean(r4?.ownerStyle) && r4.ownerStyle !== '样本不足', r4?.ownerStyle)

  const r5 = await cdp.call(`(async()=>{const s=await window.desktopApp.automation.getState();const c=s.contacts.find(c=>c.name===${JSON.stringify(CONTACT)});const d=await window.desktopApp.ai.draft({contact:c,incoming:"在干嘛呢"});return {text:d.text,error:d.error}})()`)
  check('学习后仍能正常拟回复', Boolean(r5?.text), r5?.text || r5?.error)

  await cdp.call(`(async()=>{const s=await window.desktopApp.automation.getState();await window.desktopApp.automation.update({contacts:s.contacts.filter(c=>c.name!==${JSON.stringify(CONTACT)})})})()`)
  console.log('\n测试联系人已清理')
  cdp.close()
  const failed = checks.filter((c) => !c.ok).length
  console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ 训练场链路全部正常')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('验证失败:', e.message); process.exit(1) })
