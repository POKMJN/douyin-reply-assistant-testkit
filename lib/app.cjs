// 按相对路径加载应用模块：require('../lib/app.cjs')('electron/ai-service.cjs')
// 测试项目不复制应用源码，只在运行时按 resolve-app 的结果加载。
const path = require('node:path')
const { resolveAppRoot } = require('./resolve-app.cjs')

module.exports = function loadAppModule(relativePath) {
  return require(path.join(resolveAppRoot(), relativePath))
}
