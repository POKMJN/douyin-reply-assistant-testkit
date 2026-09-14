// 定位"抖音回复助手"应用源码目录（测试项目与应用仓库解耦：只在运行时定位，不复制源码）
//
// 查找顺序：
//   1. 环境变量 DRA_SOURCE
//   2. config.json 里的 sourcePath
//   3. 常见同级目录布局（../app-source、../douyin-reply-assistant/app-source、../rebuild）
//   4. ./vendor/app-source（把应用源码 vendored 进来的场景）
const fs = require('node:fs')
const path = require('node:path')

const PROJECT_ROOT = path.join(__dirname, '..')

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'config.json'), 'utf8'))
  } catch {
    return {}
  }
}

// 判定一个目录是否是应用源码根（含主进程模块与渲染层）
function isValidAppRoot(dir) {
  if (!dir) return false
  try {
    return fs.existsSync(path.join(dir, 'electron', 'ai-service.cjs'))
      && fs.existsSync(path.join(dir, 'electron', 'conversation-engine.cjs'))
  } catch {
    return false
  }
}

function candidatePaths() {
  const config = loadConfig()
  return [
    process.env.DRA_SOURCE,
    config.sourcePath,
    path.join(PROJECT_ROOT, 'vendor', 'app-source'),
    path.join(PROJECT_ROOT, '..', 'app-source'),
    path.join(PROJECT_ROOT, '..', 'douyin-reply-assistant', 'app-source'),
    path.join(PROJECT_ROOT, '..', 'rebuild'),
  ].filter(Boolean).map((p) => path.resolve(p))
}

let cached = null
function resolveAppRoot() {
  if (cached) return cached
  for (const candidate of candidatePaths()) {
    if (isValidAppRoot(candidate)) { cached = candidate; return cached }
  }
  throw new Error([
    '找不到「抖音回复助手」应用源码目录。请任选一种方式指定：',
    '  1) 设置环境变量：DRA_SOURCE=<应用源码目录>',
    '  2) 在项目根目录创建 config.json：{"sourcePath": "<应用源码目录>"}',
    '  3) 把应用源码放到 ./vendor/app-source/',
    '',
    `已尝试：${candidatePaths().join('、') || '（无候选）'}`,
    '应用源码目录需包含 electron/ai-service.cjs 与 electron/conversation-engine.cjs',
  ].join('\n'))
}

module.exports = { resolveAppRoot, isValidAppRoot, PROJECT_ROOT, loadConfig }
