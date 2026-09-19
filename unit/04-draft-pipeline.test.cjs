// AI 回复链路（draft pipeline）端到端测试：注入 fake transport，不打真实网络
const { test } = require('node:test')
const assert = require('node:assert')
require('../lib/setup.cjs')
const { AiService } = require('../lib/app.cjs')('electron/ai-service.cjs')
const { createMemoryStorage } = require('../lib/setup.cjs')

const PROVIDER = { name: '主力', model: 'test-model', baseUrl: 'https://api.test/v1', capabilities: ['vision'] }
const PROVIDER2 = { name: '备用', model: 'backup-model', baseUrl: 'https://backup.test/v1', capabilities: [] }

function makeContact(overrides = {}) {
  return {
    id: 'c1',
    name: '小明',
    profile: { relationship: '大学同学' },
    learning: {
      messages: [{ role: 'contact', text: '哈喽，在吗' }, { role: 'me', text: '在的' }],
      facts: [{ text: '对方是程序员' }],
      // topicLog 时间放在 3 小时前，避免触发 recordMediaContext 的 2 小时写入守卫
      topicLog: [{ at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), text: '聊了周末的安排' }],
      mediaLog: [],
    },
    ...overrides,
  }
}

function makeService({ responses, onCall } = {}) {
  const contact = makeContact()
  const storage = createMemoryStorage({ providers: [PROVIDER], contacts: [contact] })
  let callIndex = 0
  const transport = async (url, options, body) => {
    const parsed = JSON.parse(String(body))
    const record = { model: parsed.model, isAnalysis: String(parsed.messages?.[0]?.content || '').includes('先理解一条抖音私信'), messages: parsed.messages }
    onCall?.(record, callIndex)
    const response = responses?.[Math.min(callIndex, responses.length - 1)]
    callIndex += 1
    if (typeof response === 'number' && response < 0) {
      const error = new Error('模拟接口故障')
      error.statusCode = 500
      error.retryable = true
      throw error
    }
    return { choices: [{ message: { content: response ?? '好的呀' } }] }
  }
  const ai = new AiService(storage, { transport })
  return { ai, storage }
}

test('普通文本回复：生成 → 清洗 → 打标签', async () => {
  const { ai, storage } = makeService({ responses: ['你这是刚睡醒吧'] })
  const result = await ai.draft({ contact: storage.get().contacts[0], incoming: '刚起床哈哈哈' })
  assert.equal(result.ok, true)
  assert.equal(result.text, '你这是刚睡醒吧')
  assert.equal(result.labeledText, '【AI · test-model】你这是刚睡醒吧')
  assert.equal(result.skipped, undefined)
})

test('模型标签关闭时不加前缀', async () => {
  const { ai, storage } = makeService({ responses: ['嗯嗯'] })
  storage.update({ settings: { ...storage.get().settings, showAiModelLabel: false } })
  const result = await ai.draft({ contact: storage.get().contacts[0], incoming: '吃了吗' })
  assert.equal(result.labeledText, '嗯嗯')
})

test('[不回复] 决策被尊重', async () => {
  const { ai, storage } = makeService({ responses: ['[不回复]'] })
  const result = await ai.draft({ contact: storage.get().contacts[0], incoming: '哈哈哈哈' })
  assert.equal(result.skipped, true)
  assert.equal(result.text, '')
})

test('思考泄漏正文被整条拒发', async () => {
  const { ai, storage } = makeService({ responses: ['我们需要生成一条消息，要求是简短口语化'] })
  const result = await ai.draft({ contact: storage.get().contacts[0], incoming: '在吗' })
  assert.equal(result.rejected, true)
  assert.equal(result.text, '')
})

test('超长回复被机械限长', async () => {
  const { ai, storage } = makeService({ responses: ['今天天气特别好，我早上去了公园散步，然后吃了早饭，还买了杯咖啡，心情很不错，下午打算去看电影，晚上再约朋友吃饭，你觉得怎么样呀，要不要一起出来逛逛？'] })
  const result = await ai.draft({ contact: storage.get().contacts[0], incoming: '今天干嘛了' })
  assert.ok([...result.text].length <= 40, `限长后应 <=40，实际 ${[...result.text].length}`)
})

test('AI 腔回复触发自然化重写并采纳改写结果', async () => {
  const calls = []
  const { ai, storage } = makeService({
    responses: ['我理解你的感受。', '抱抱，辛苦了'],
    onCall: (record) => calls.push(record),
  })
  const result = await ai.draft({ contact: storage.get().contacts[0], incoming: '最近好累' })
  assert.equal(result.text, '抱抱，辛苦了', '应使用改写后的回复')
  assert.equal(calls.length, 2, '生成 + 重写共两次调用')
})

test('攻击性回复重写仍不过关 → 整条拒发', async () => {
  const { ai, storage } = makeService({ responses: ['闭嘴吧你', '滚蛋，废物'] })
  const result = await ai.draft({ contact: storage.get().contacts[0], incoming: '你懂什么' })
  assert.equal(result.rejected, true)
  assert.equal(result.text, '')
})

test('视频回复：先理解再回复，理解结果落库为视频上下文', async () => {
  const calls = []
  const { ai, storage } = makeService({
    responses: [
      '视频里一只猫把水杯打翻了，主人一脸无奈。\n话题记录：分享了宠物搞笑视频：猫打翻水杯',
      '那只猫是故意的吧哈哈',
    ],
    onCall: (record) => calls.push(record),
  })
  const frame = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
  const media = { frames: [frame], mediaKind: 'video', detectedVideo: true, videoReady: true, decodedVideoFrames: 1, confidence: 'high', frameDetail: 'low' }
  const result = await ai.draft({ contact: storage.get().contacts[0], incoming: '[视频]', videoFrames: media })
  assert.equal(result.ok, true)
  assert.equal(result.text, '那只猫是故意的吧哈哈')
  assert.equal(calls[0].isAnalysis, true, '第一跳必须是媒体理解')
  assert.ok(calls[1].messages.some((m) => JSON.stringify(m.content).includes('视频理解结果')), '回复 prompt 应包含理解结果')
  // 视频上下文落库
  const contact = storage.get().contacts[0]
  assert.equal(contact.learning.mediaLog.length, 1)
  assert.ok(contact.learning.mediaLog[0].summary.includes('水杯'))
  assert.ok(contact.learning.topicLog.some((t) => String(t.text).includes('水杯')), '话题记录写入 topicLog')
})

test('视频回复：无视觉能力的文本模型用评论氛围摘要回复（不因无视觉能力被排除）', async () => {
  const calls = []
  const { ai, storage } = makeService({
    responses: ['这狗子是来搞笑的吧'],
    onCall: (record) => calls.push(record),
  })
  storage.update({ providers: [{ ...PROVIDER, capabilities: [] }] }) // 无视觉能力
  const media = { frames: ['data:image/jpeg;base64,/9j/x'], mediaKind: 'video', detectedVideo: true, videoComments: ['狗子跑得好欢乐', '太可爱了'] }
  const result = await ai.draft({ contact: storage.get().contacts[0], incoming: '[视频]', videoFrames: media })
  assert.equal(result.ok, true)
  assert.ok(calls.every((c) => !c.isAnalysis), '无视觉模型时跳过画面分析')
  assert.ok(calls[0].messages.some((m) => JSON.stringify(m.content).includes('视频内容与氛围')), '评论氛围摘要注入回复 prompt')
})

test('弱文本模型不参与文字回复生成（只承担视觉分析）', async () => {
  const used = []
  const contact = makeContact()
  const storage = createMemoryStorage({
    providers: [
      { name: '弱', model: 'meta/llama-3.2-11b-vision-instruct', capabilities: ['vision'] },
      { name: '强', model: 'deepseek-v4', capabilities: [] },
    ],
    contacts: [contact],
  })
  const transport = async (url, options, body) => {
    const parsed = JSON.parse(String(body))
    used.push(parsed.model)
    return { choices: [{ message: { content: '强模型的回复' } }] }
  }
  const ai = new AiService(storage, { transport })
  const result = await ai.draft({ contact, incoming: '在吗' })
  assert.equal(result.text, '强模型的回复')
  assert.ok(!used.some((m) => String(m).includes('llama')), `弱模型不应出现在生成链，实际 ${used.join(',')}`)
})

test('全部只剩弱模型时仍允许兜底生成', async () => {
  const contact = makeContact()
  const storage = createMemoryStorage({
    providers: [{ name: '弱', model: 'meta/llama-3.2-11b-vision-instruct', capabilities: ['vision'] }],
    contacts: [contact],
  })
  const ai = new AiService(storage, { transport: async () => ({ choices: [{ message: { content: '兜底回复' } }] }) })
  const result = await ai.draft({ contact, incoming: '在吗' })
  assert.equal(result.text, '兜底回复')
})

test('连续复读守卫：与上一条本人回复重复时自动换角度重写', async () => {
  const calls = []
  const contact = makeContact()
  contact.learning.messages = [
    { role: 'contact', text: '哦' },
    { role: 'me', text: '你练多久了？' },
  ]
  const storage = createMemoryStorage({ providers: [PROVIDER], contacts: [contact] })
  const transport = async (url, options, body) => {
    const parsed = JSON.parse(String(body))
    calls.push(parsed.messages.at(-1).content)
    // 第一次生成复读；重写调用返回新角度
    return { choices: [{ message: { content: calls.length === 1 ? '你练多久了？' : '这么早就躺了？' } }] }
  }
  const ai = new AiService(storage, { transport })
  const result = await ai.draft({ contact, incoming: '嗯嗯' })
  assert.equal(result.text, '这么早就躺了？', '复读被守卫重写为新角度')
  assert.ok(String(calls[1]).includes('重复'), '重写调用应带复读警告')
})

test('soak 回归：两次都输出 AI 腔时拒绝发送（不再漏网）', async () => {
  const contact = makeContact()
  const storage = createMemoryStorage({ providers: [PROVIDER], contacts: [contact] })
  const transport = async () => ({ choices: [{ message: { content: '我理解你的感受，感谢你的分享' } }] })
  const ai = new AiService(storage, { transport })
  const result = await ai.draft({ contact, incoming: '最近好难受' })
  assert.equal(result.rejected, true, '重写仍失败后必须拒发')
  assert.equal(result.text, '')
})

test('soak 回归：AI 腔第一次改写成功则正常发送', async () => {
  const contact = makeContact()
  const storage = createMemoryStorage({ providers: [PROVIDER], contacts: [contact] })
  let n = 0
  const transport = async () => {
    n += 1
    return { choices: [{ message: { content: n === 1 ? '我理解你的感受' : '这确实挺难受的' } }] }
  }
  const ai = new AiService(storage, { transport })
  const result = await ai.draft({ contact, incoming: '最近好难受' })
  assert.equal(result.ok, true)
  assert.equal(result.text, '这确实挺难受的')
})

test('soak 回归：强模型冷却期间弱模型不再顶上生成（宁可失败等恢复）', async () => {
  const used = []
  const contact = makeContact()
  const storage = createMemoryStorage({
    providers: [
      { name: '强', model: 'deepseek-v4', capabilities: [] },
      { name: '弱', model: 'meta/llama-3.2-11b-vision-instruct', capabilities: ['vision'] },
    ],
    contacts: [contact],
  })
  const transport = async (url, options, body) => {
    const parsed = JSON.parse(String(body))
    used.push(parsed.model)
    if (String(parsed.model).includes('deepseek')) {
      const e = new Error('cooldown')
      e.statusCode = 429
      throw e
    }
    return { choices: [{ message: { content: '弱模型的回复' } }] }
  }
  const ai = new AiService(storage, { transport })
  // 第一次：强模型 429 → 失败并进入冷却
  await assert.rejects(() => ai.draft({ contact, incoming: '在吗' }), /cooldown|没有可用的 AI 模型/)
  assert.ok(!used.some((m) => String(m).includes('llama')), `第一次调用就不该用弱模型，实际 ${used.join(',')}`)
  // 第二次（强模型已在冷却中）：弱模型仍不得顶上——这是跑批第二轮抓到的洞
  await assert.rejects(() => ai.draft({ contact, incoming: '在吗' }), /cooldown|没有可用的 AI 模型/)
  assert.ok(!used.some((m) => String(m).includes('llama')), `冷却期间弱模型不应顶上，实际 ${used.join(',')}`)
})

test('soak 回归：全部是弱模型时仍允许兜底生成', async () => {
  const contact = makeContact()
  const storage = createMemoryStorage({
    providers: [{ name: '唯弱', model: 'meta/llama-3.2-11b-vision-instruct', capabilities: ['vision'] }],
    contacts: [contact],
  })
  const ai = new AiService(storage, { transport: async () => ({ choices: [{ message: { content: '兜底回复' } }] }) })
  const result = await ai.draft({ contact, incoming: '在吗' })
  assert.equal(result.text, '兜底回复')
})

test('双消息：概率命中时补一条不重复的随口话', async () => {
  const contact = makeContact()
  const storage = createMemoryStorage({ providers: [PROVIDER], contacts: [contact] })
  storage.update({ settings: { ...storage.get().settings, twoMessageChance: 1 } })
  const bodies = []
  const transport = async (url, options, body) => {
    const parsed = JSON.parse(String(body))
    bodies.push(parsed.messages.at(-1).content)
    return { choices: [{ message: { content: bodies.length === 1 ? '刚睡醒哈哈' : '你呢你呢' } }] }
  }
  const ai = new AiService(storage, { transport })
  const result = await ai.draft({ contact, incoming: '在干嘛' })
  assert.equal(result.text, '刚睡醒哈哈')
  assert.equal(result.text2, '你呢你呢', '应生成第二条随口话')
  assert.ok(String(bodies[1]).includes('再补一条更短'), '补充调用应带双消息指令')
})

test('双消息：概率未命中时不生成第二条', async () => {
  const contact = makeContact()
  const storage = createMemoryStorage({ providers: [PROVIDER], contacts: [contact] })
  storage.update({ settings: { ...storage.get().settings, twoMessageChance: 0 } })
  let calls = 0
  const ai = new AiService(storage, { transport: async () => { calls += 1; return { choices: [{ message: { content: '好呀' } }] } } })
  const result = await ai.draft({ contact, incoming: '周末出来？' })
  assert.equal(result.text2, '')
  assert.equal(calls, 1)
})

test('双消息：第二条质检不过时静默放弃，不影响首条', async () => {
  const contact = makeContact()
  const storage = createMemoryStorage({ providers: [PROVIDER], contacts: [contact] })
  storage.update({ settings: { ...storage.get().settings, twoMessageChance: 1 } })
  const replies = ['刚睡醒哈哈', '我们需要生成一条消息，要求是简短口语化']
  let n = 0
  const ai = new AiService(storage, { transport: async () => ({ choices: [{ message: { content: replies[Math.min(n++, 1)] } }] }) })
  const result = await ai.draft({ contact, incoming: '在吗' })
  assert.equal(result.text, '刚睡醒哈哈')
  assert.equal(result.text2, '', '思考泄漏的第二条应被丢弃')
})

test('今日播报续火花：prompt 注入天气/日期/热点/祝福，缺数据时显式不提', async () => {
  require('../lib/setup.cjs')
  const { buildSparkPrompt } = require('../lib/app.cjs')('electron/ai-service.cjs')
  const withData = buildSparkPrompt({
    contact: { name: '小明', profile: {} },
    contactMsgs: ['早'], ownerMsgs: ['早呀'],
    weather: '成都今天 18~25°C，小雨，白天降雨概率约 60%，出门记得带伞',
    hotTopic: '【热点】某新品发布',
  })
  assert.ok(withData.includes('18~25°C'), '天气进入 prompt')
  assert.ok(withData.includes('带伞'), '带伞提醒进入 prompt')
  assert.ok(withData.includes('某新品发布'), '热点进入 prompt')
  assert.ok(withData.includes('祝福'), '祝福要求存在')
  assert.ok(withData.includes('轻短祝福') || withData.includes('轻短的祝福'))
  const withoutData = buildSparkPrompt({ contact: { name: '小明', profile: {} }, contactMsgs: [], ownerMsgs: [] })
  assert.ok(withoutData.includes('完全不要提天气'), '无天气时明确要求不提')
  assert.ok(withoutData.includes('没有热点素材就不提'), '无热点时明确要求不提')
})

test('weatherFromJ1：解析温度区间与带伞/遮阳提醒', async () => {
  require('../lib/setup.cjs')
  const { weatherFromJ1 } = require('../lib/app.cjs')('electron/ai-service.cjs')
  const j1 = {
    weather: [{ mintempC: '18', maxtempC: '25', hourly: [{ chanceofrain: '70', UVIndex: '2', weatherDesc: [{ value: 'Light rain' }] }, { chanceofrain: '30', UVIndex: '7', weatherDesc: [{ value: 'Sunny' }] }] }],
    nearest_area: [{ areaName: [{ value: 'Chengdu' }] }],
  }
  const { text, maxRain, maxUV } = weatherFromJ1(j1)
  assert.equal(maxRain, 70)
  assert.equal(maxUV, 7)
  assert.ok(text.includes('18~25°C'))
  assert.ok(text.includes('带伞'))
  assert.ok(!text.includes('Chengdu'), '英文地名不进文案')
})

test('soak 回归：客服腔改写调用失败时拒发（不再漏网直发）', async () => {
  const contact = makeContact()
  const storage = createMemoryStorage({ providers: [PROVIDER], contacts: [contact] })
  let n = 0
  const transport = async () => {
    n += 1
    if (n >= 2) { const e = new Error('改写调用网络故障'); e.statusCode = 503; throw e }
    return { choices: [{ message: { content: '我理解你的感受，感谢你的分享' } }] }
  }
  const ai = new AiService(storage, { transport })
  const result = await ai.draft({ contact, incoming: '最近好难受' })
  assert.equal(result.rejected, true, '改写调用失败后应拒发客服腔文本')
  assert.equal(result.text, '')
})

test('今日播报：天气/祝福提醒语每天重复不算复读（记得带伞悖论回归）', async () => {
  require('../lib/setup.cjs')
  const { AiService } = require('../lib/app.cjs')('electron/ai-service.cjs')
  const { createMemoryStorage } = require('../lib/setup.cjs')
  const contact = makeContact()
  // 前几天的开场里有几乎相同的播报内容（旧版会因 ≥4 字重合"记得带伞"而拒发）
  contact.learning.messages = [
    { role: 'contact', text: '早' },
    { role: 'me', text: '【AI · test-model】早上好呀，今天18~25°C，出门记得带伞。祝你今天顺利！' },
  ]
  const storage = createMemoryStorage({ providers: [PROVIDER], contacts: [contact] })
  const transport = async () => ({ choices: [{ message: { content: '早上好呀，今天19~24°C，出门记得带伞，别淋着啦，祝你好心情！' } }] })
  const ai = new AiService(storage, { transport })
  const result = await ai.draftSparkMessage({
    contact, task: {},
    weather: '今天 19~24°C，小雨，降雨概率约 60%，出门记得带伞',
    hotTopic: '【热点】某地举办丰收节',
    retryDelayMs: 1,
  })
  assert.ok(result.text.includes('带伞'), '播报内容正常生成')
})

test('今日播报：祝福尾句/温度数字不参与复读判定（200 遍实测回归）', async () => {
  require('../lib/setup.cjs')
  const { AiService } = require('../lib/app.cjs')('electron/ai-service.cjs')
  const { createMemoryStorage } = require('../lib/setup.cjs')
  const contact = makeContact()
  // 前 3 天的开场：同骨架（问候+温度+提醒+愿你尾句），仅提醒词和尾句不同——这是播报的日常形态
  contact.learning.messages = [
    { role: 'contact', text: '早' },
    { role: 'me', text: '【AI · test-model】阿甲下午好，周日这23到30度，出门记得带瓶水。刚看到说瑞丽丢牛上热搜了。愿你下午舒舒坦坦的' },
    { role: 'contact', text: '嗯嗯' },
    { role: 'me', text: '【AI · test-model】阿甲下午好，周日这23到30度，太阳不算太烈，傍晚出门走走正合适。刚看到说瑞丽那边丢牛的事儿又上热搜了。愿你下午舒舒坦坦的~' },
  ]
  const storage = createMemoryStorage({ providers: [PROVIDER], contacts: [contact] })
  const transport = async () => ({ choices: [{ message: { content: '阿甲下午好，周日这23到30度，太阳还是有点烈，出门记得抹点防晒。刚看到说珠三角常住人口破八千万了，是真能装人。愿你下午轻松自在~' } }] })
  const ai = new AiService(storage, { transport })
  const result = await ai.draftSparkMessage({ contact, task: {}, weather: '今天 23~30°C，多云', hotTopic: '【热点】珠三角常住人口突破八千万', retryDelayMs: 1 })
  assert.ok(result.text.includes('防晒'), '同骨架不同提醒词的播报应正常生成')
})

test('今日播报：真正的复读仍然拒发', async () => {
  require('../lib/setup.cjs')
  const { AiService } = require('../lib/app.cjs')('electron/ai-service.cjs')
  const { createMemoryStorage } = require('../lib/setup.cjs')
  const contact = makeContact()
  contact.learning.messages = [
    { role: 'contact', text: '早' },
    { role: 'me', text: '【AI · test-model】周末去钓鱼吧，湖边新开了个地方特别清净，适合发呆' },
  ]
  const storage = createMemoryStorage({ providers: [PROVIDER], contacts: [contact] })
  const transport = async () => ({ choices: [{ message: { content: '周末去钓鱼吧，湖边新开了个地方特别清净' } }] })
  const ai = new AiService(storage, { transport })
  await assert.rejects(
    () => ai.draftSparkMessage({ contact, task: {}, weather: '', hotTopic: '', retryDelayMs: 1 }),
    /质检|拒发/,
  )
})

test('无模型配置时明确报错', async () => {
  const storage = createMemoryStorage({ providers: [] })
  const ai = new AiService(storage)
  await assert.rejects(
    () => ai.draft({ contact: makeContact(), incoming: '你好' }),
    /没有配置可用模型/,
  )
})

test('故障转移：主模型 5xx 后自动切备用并记冷却', async () => {
  const models = []
  const contact = makeContact()
  const storage = createMemoryStorage({ providers: [PROVIDER, PROVIDER2], contacts: [contact] })
  const transport = async (url, options, body) => {
    const parsed = JSON.parse(String(body))
    models.push(parsed.model)
    if (parsed.model === PROVIDER.model) {
      const error = new Error('模拟 500')
      error.statusCode = 500
      error.retryable = false
      throw error
    }
    return { choices: [{ message: { content: '备用模型顶上了' } }] }
  }
  const ai = new AiService(storage, { transport })
  const result = await ai.draft({ contact, incoming: '在吗' })
  assert.equal(result.ok, true)
  assert.equal(result.provider, PROVIDER2.name)
  assert.deepEqual(models, [PROVIDER.model, PROVIDER2.model])
  const { providerInCooldown, providerCooldowns } = require('../lib/app.cjs')('electron/ai-service.cjs')
  assert.ok(providerInCooldown(PROVIDER.name), '失败模型进入冷却')
  providerCooldowns.clear()
})

test('cooldown 生效：冷却中的模型被跳过', async () => {
  const { providerCooldowns, markProviderFailure, providerInCooldown } = require('../lib/app.cjs')('electron/ai-service.cjs')
  const storage = createMemoryStorage({ providers: [PROVIDER, PROVIDER2] })
  const usedModels = []
  const transport = async (url, options, body) => {
    const parsed = JSON.parse(String(body))
    usedModels.push(parsed.model)
    return { choices: [{ message: { content: '好的' } }] }
  }
  const ai = new AiService(storage, { transport })
  markProviderFailure(PROVIDER.name, new Error('inference tpm exhausted'))
  const result = await ai.inquiryCompletion([{ role: 'user', content: 'hi' }])
  assert.equal(result.provider, PROVIDER2.name, '限流冷却中的主力模型被跳过')
  assert.ok(providerInCooldown(PROVIDER.name))
  providerCooldowns.clear()
})

test('recordMediaContext：mediaLog 有上限且 appendMediaLog 空摘要不写入', () => {
  const contact = makeContact()
  const storage = createMemoryStorage({ contacts: [contact] })
  const ai = new AiService(storage)
  for (let i = 0; i < 10; i += 1) ai.recordMediaContext('小明', { summary: `视频${i}` })
  const learning = storage.get().contacts[0].learning
  assert.ok(learning.mediaLog.length <= 6, `mediaLog 上限 6，实际 ${learning.mediaLog.length}`)
  const before = learning.mediaLog.length
  ai.recordMediaContext('小明', { summary: '' })
  assert.equal(storage.get().contacts[0].learning.mediaLog.length, before, '空摘要不写入')
})

test('mineFacts：从对话提炼长期记忆并去重合并', async () => {
  const { ai, storage } = makeService({ responses: ['对方在成都做程序员；养了一只猫'] })
  const result = await ai.mineFacts({
    name: '小明',
    messages: [{ role: 'contact', text: '我在成都写代码，家里猫又拆家了' }],
    existing: [{ text: '对方是程序员' }],
  })
  assert.equal(result.ok, true)
  const texts = result.facts.map((f) => f.text)
  assert.ok(texts.some((t) => t.includes('成都')))
  assert.ok(texts.some((t) => t.includes('程序员')), '已有事实被合并保留')
})

test('summarizeRecentTopic：输出被消毒后写入', async () => {
  const { ai } = makeService({ responses: ['概括：1. 一起吐槽了加班 2. 关系温度似乎是热络'] })
  const result = await ai.summarizeRecentTopic({
    name: '小明',
    messages: [{ role: 'contact', text: '今天又加班到十点' }, { role: 'me', text: '牛逼，注意身体' }],
    existing: [],
  })
  assert.equal(result.ok, true)
  const text = result.topics.at(-1).text
  assert.ok(!/\d+\./.test(text), '分点编号被剥除')
  assert.ok(!text.includes('关系温度似乎是'))
})

test('AI 缓存优化：同视频分析与评论摘要命中本地 LRU 缓存', async () => {
  let transportCalls = 0
  const { ai, storage } = makeService({
    responses: ['视频里小猫摔倒了\n话题记录：小猫摔倒视频', '好可爱哈哈', '氛围轻松搞笑'],
    onCall: () => { transportCalls += 1 },
  })
  const frame = 'data:image/jpeg;base64,/9j/testframe123'
  const media = { frames: [frame], mediaKind: 'video', detectedVideo: true, videoPageTitle: '搞笑猫咪' }
  
  // 首次分析媒体：触发 transport
  const res1 = await ai.analyzeMediaFrames({ contact: storage.get().contacts[0], incoming: '[视频]', media, providers: [PROVIDER] })
  assert.equal(res1.text, '视频里小猫摔倒了')
  const callsAfterFirst = transportCalls
  assert.ok(callsAfterFirst > 0, '首次分析触发模型请求')

  // 第二次分析相同媒体：必须命中 LRU 缓存，0 次新增模型请求
  const res2 = await ai.analyzeMediaFrames({ contact: storage.get().contacts[0], incoming: '[视频]', media, providers: [PROVIDER] })
  assert.equal(res2.text, '视频里小猫摔倒了')
  assert.equal(res2.fromCache, true)
  assert.equal(transportCalls, callsAfterFirst, '二次相同视频 100% 走缓存，不产生网络调用')

  // 评论摘要缓存验证
  const comments = ['太好笑了', '哈哈哈哈', '救命']
  const sum1 = await ai.summarizeComments(comments)
  const callsAfterSum1 = transportCalls
  const sum2 = await ai.summarizeComments(comments)
  assert.equal(sum1, sum2)
  assert.equal(transportCalls, callsAfterSum1, '二次相同评论摘要 100% 走缓存')
})

test('AI 缓存优化：服务端 Prefix Cache 对齐与 Token Usage 监控', async () => {
  const { buildChatPrompt } = require('../lib/app.cjs')('electron/ai-service.cjs')
  const contact = makeContact()
  
  // 模拟不同时间调用的 prompt
  const p1 = buildChatPrompt(contact, '你好呀')
  const p2 = buildChatPrompt(contact, '吃了吗')
  
  // 验证静态前缀一致性：全局原则和联系人记忆在动态时间前缀之前
  const p1StaticPart = p1.split('【当轮时间与即时接话指引】')[0]
  const p2StaticPart = p2.split('【当轮时间与即时接话指引】')[0]
  assert.equal(p1StaticPart, p2StaticPart, '多轮对话中静态原则与联系人记忆前缀 100% 相同，保证服务端 Prefix Cache 命中')
  assert.ok(p1StaticPart.length > 500, '静态前缀包含完整人设、原则与记忆')

  // 验证 Token Usage 监控捕获
  let recordedUsage = null
  const { ai, storage } = makeService({
    responses: ['哈哈吃过了'],
    onCall: () => {},
  })
  // 注入 fake transport 返回带有 usage 统计的数据
  ai.setTransport(async () => ({
    choices: [{ message: { content: '哈哈吃过了' } }],
    usage: { prompt_tokens: 1200, completion_tokens: 15, prompt_tokens_details: { cached_tokens: 1050 } },
  }))
  const draftRes = await ai.draft({ contact: storage.get().contacts[0], incoming: '吃了吗' })
  assert.equal(draftRes.usage.promptTokens, 1200)
  assert.equal(draftRes.usage.cachedTokens, 1050)
  assert.equal(draftRes.usage.hitRate, 88)
  const logs = storage.get().logs || []
  assert.ok(logs.some((l) => String(l.message).includes('缓存命中 88%')), '日志中记录了缓存命中率百分比')
})
