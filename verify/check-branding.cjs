// 界面用词检查：所有页面不得出现"重构版/rebuild"等内部字样
// 用法：node verify/check-branding.cjs（应用需以 --remote-debugging-port 启动）
const { connect } = require('../lib/cdp.cjs')

async function main() {
  const cdp = await connect()
  let bad = 0
  const sections = ['chat', 'train', 'drafts', 'tasks', 'models', 'logs', 'settings']
  for (const section of sections) {
    await cdp.eval(`(() => { const b = document.querySelector('.rail-item[data-args*="${section}"]'); if (b) b.click(); })()`)
    const hit = await cdp.eval(`document.getElementById('app').innerText.match(/重构版|rebuild/i)?.[0] || 'CLEAN'`)
    const ok = hit === 'CLEAN'
    if (!ok) bad += 1
    console.log(`${section} 页: ${ok ? '✅ 无内部字样' : '❌ 出现: ' + hit}`)
  }
  const boot = await cdp.eval(`(async () => { const s = await window.desktopApp.automation.getState(); return s.logs.find(l => l.type === 'app_boot')?.message || '(无启动日志)' })()`)
  console.log('启动日志: ' + boot)
  cdp.close()
  console.log(bad ? `\n❌ ${bad} 个页面存在内部字样` : '\n✅ 全部页面干净')
  process.exit(bad ? 1 : 0)
}
main().catch((e) => { console.error('检查失败:', e.message); process.exit(1) })
