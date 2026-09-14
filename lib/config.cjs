// 统一读取运行配置（config.json + 环境变量覆盖）
const { loadConfig } = require('./resolve-app.cjs')

function config() {
  const file = loadConfig()
  return {
    // 应用可执行文件（供需要重启应用的用例使用）
    appExe: process.env.DRA_APP_EXE || file.appExe || '',
    // Chrome DevTools 协议端口（应用需以 --remote-debugging-port=<port> 启动）
    debugPort: Number(process.env.DRA_DEBUG_PORT || file.debugPort || 9223),
    // 应用 userData 目录（读取 state.json 做持久化校验时使用）
    userData: process.env.DRA_USER_DATA || file.userData || '',
    // 报告输出目录（默认 ./artifacts）
    artifactsDir: process.env.DRA_ARTIFACTS || file.artifactsDir || '',
  }
}

module.exports = { config }
