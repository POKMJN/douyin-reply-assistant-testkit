// 单元测试跑批：连续运行 N 轮，任一轮失败即终止（默认 12 轮）
// 用法：node run-all.cjs [轮数]
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROUNDS = Number(process.argv[2] || process.env.ROUNDS || 12)
const unitDir = path.join(__dirname, 'unit')
const testFiles = fs.readdirSync(unitDir).filter((f) => f.endsWith('.test.cjs')).map((f) => path.join(unitDir, f))

let allPass = true
for (let round = 1; round <= ROUNDS; round += 1) {
  const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  const pass = Number((output.match(/ℹ pass (\d+)/) || output.match(/pass (\d+)/) || [])[1] || 0)
  const fail = Number((output.match(/ℹ fail (\d+)/) || output.match(/fail (\d+)/) || [])[1] || 0)
  if (result.status !== 0 || fail > 0) {
    allPass = false
    console.log(`第 ${round} 轮：❌ 失败（pass=${pass} fail=${fail}）`)
    console.log(output.slice(-4000))
    break
  }
  console.log(`第 ${round} 轮：✅ 全部通过（${pass} tests）`)
}

if (!allPass) {
  console.error('\n测试未全部通过')
  process.exit(1)
}
console.log(`\n${ROUNDS} 轮全部通过 ✅`)
