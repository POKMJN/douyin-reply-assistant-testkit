// Chrome DevTools 协议客户端：连接正在运行的应用主窗口，用于端到端驱动真实模型链路。
// 应用需以 --remote-debugging-port=<port> 启动（端口见 lib/config.cjs）。
const { config } = require('./config.cjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 找到应用主窗口的页面目标（标题固定为"抖音回复助手"）
async function findMainPage({ retries = 10, intervalMs = 1500 } = {}) {
  const port = config().debugPort
  let lastError = null
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) })
      const list = await res.json()
      const pages = list.filter((t) => t.type === 'page')
      const main = pages.find((t) => t.title === '抖音回复助手') || pages.find((t) => String(t.url || '').startsWith('file:'))
      if (main) return main
      lastError = new Error(`调试端口可达但未找到主窗口（当前页面目标：${pages.map((p) => p.title).join('、') || '无'}）`)
    } catch (error) {
      lastError = new Error(`无法连接调试端口 ${port}：${error.message}。请确认应用以 --remote-debugging-port=${port} 启动`)
    }
    if (attempt < retries - 1) await sleep(intervalMs)
  }
  throw lastError
}

// 建立连接并返回 { eval, close }
async function connect(options = {}) {
  const target = await findMainPage(options)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 8000)
    ws.onopen = () => { clearTimeout(timer); resolve() }
    ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket 连接失败')) }
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
    }
  })
  return {
    // 在页面上下文求值：返回 JS 值（异常会被抛出）
    async eval(expression, timeoutMs = 200000) {
      const out = await Promise.race([
        new Promise((res, rej) => {
          const mid = ++id
          pending.set(mid, { res, rej })
          ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
        }),
        sleep(timeoutMs).then(() => { throw new Error('页面调用超时') }),
      ])
      if (out.exceptionDetails) {
        const desc = out.exceptionDetails.exception?.description || out.exceptionDetails.text || ''
        throw new Error(`页面内异常: ${String(desc).slice(0, 300)}`)
      }
      return out.result?.value
    },
    // 调用应用暴露的接口并吞掉异常，返回 { ok:false, error }（与主进程 guarded 风格一致）
    async call(expression, timeoutMs = 200000) {
      return this.eval(`(async () => { try { return await (${expression}) } catch (e) { return { ok: false, error: e.message } } })()`, timeoutMs)
    },
    close() { try { ws.close() } catch { /* ignore */ } },
    target,
  }
}

// 便捷：调用 ai.draft 并返回结果（失败时带 error 字段）
function draftExpr(payload) {
  return `window.desktopApp.ai.draft(${JSON.stringify(payload)}).catch(e => ({ ok: false, error: e.message }))`
}

module.exports = { connect, findMainPage, draftExpr, sleep }
