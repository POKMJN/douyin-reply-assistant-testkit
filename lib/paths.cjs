// 报告与产物的统一输出路径：默认 <项目根>/artifacts
const fs = require('node:fs')
const path = require('node:path')
const { PROJECT_ROOT } = require('./resolve-app.cjs')
const { config } = require('./config.cjs')

function artifactsDir() {
  const dir = config().artifactsDir || path.join(PROJECT_ROOT, 'artifacts')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

module.exports = { artifactsDir, PROJECT_ROOT }
