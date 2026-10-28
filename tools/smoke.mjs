/**
 * 离线冒烟：不启动宿主，只用真实的 cordis Context + 桩 sessionPersistence
 * 验证注册表的三件事 —— 扫盘、子 agent 排除、运行中增量登记。
 *
 *   node tools/smoke.mjs
 */
import { mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

// 插件本身不依赖 cordis（只在宿主里被调用），冒烟脚本需要真实的 Context。
// 优先用 DSH_CORDIS 指定，否则退回本机 DSH 安装路径。
const CORDIS =
  process.env.DSH_CORDIS ??
  '/Users/tom/.local/olcli-ustc/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'

const { Context } = await import(CORDIS)
const { apply } = await import('../index.js')

const dir = await mkdtemp(join(tmpdir(), 'dsh-meeting-'))
process.env.DSH_MEETING_DIR = dir

const stored = [
  { header: { id: 'session-root01', cwd: '/p/alpha', createdAt: 1 } },
  { header: { id: 'session-fork02', cwd: '/p/alpha', createdAt: 2, parentSession: 'session-root01' } },
  { header: { id: 'session-child3', cwd: '/p/alpha', createdAt: 3, origin: 'subagent' } },
  { header: { id: 'session-nocwd4', createdAt: 4 } },
]

/** root01 的对话日志：一个 turn 边界 + 三条表面消息（读的时候应只投影后三条）。 */
const root01Log = [
  { seq: 0, time: 1, type: 'turn/start', data: { turn: 1 } },
  {
    seq: 1,
    time: 2,
    type: 'user/message',
    data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '帮我看看 GLOSS 的表格' }] },
  },
  {
    seq: 2,
    time: 3,
    type: 'assistant/message',
    data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '表格列宽有问题，第三列被撑开。' }] } },
  },
  {
    seq: 3,
    time: 4,
    type: 'tool/result',
    data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'diff --git a/main.tex' }] } },
  },
]

const ctx = new Context()
const tools = new Map()
ctx.provide('tools', {
  register: (definition) => {
    tools.set(definition.name, definition)
    return () => tools.delete(definition.name)
  },
})
const liveAgents = new Map()
const delivered = []
const fakeAgent = (id, status) => ({
  id,
  status,
  steer: (message) => delivered.push({ via: 'steer', to: id, message }),
  followup: (message) => delivered.push({ via: 'followup', to: id, message }),
})
const resumed = []
const assembleHooks = []
const mounted = []
ctx.provide('agents', {
  get: (id) => liveAgents.get(id),
  list: () => [...liveAgents.values()],
  resume: async (options) => {
    resumed.push(options)
    if (typeof options.setup === 'function') await options.setup({
      on: (event, listener) => {
        if (event === 'system-prompt/assemble') assembleHooks.push(listener)
        return () => {}
      },
      effect: (fn) => fn(),
    })
    const agent = fakeAgent(options.resumeSessionId, 'idle')
    liveAgents.set(agent.id, agent)
    return { agent, dispose: async () => liveAgents.delete(agent.id) }
  },
})
ctx.provide('agentPresets', {
  resolve: async (presetName) => ({ id: 'resolved:' + presetName }),
  mount: async (_agentCtx, id) => { mounted.push(id) },
})
ctx.provide('sessionQuery', {
  observeSession: async (id) => ({ header: { id, cwd: '/p/late', agentPreset: 'writer' } }),
  readSession: async (id) => ({
    header: { id, cwd: '/p/late', agentPreset: 'writer' },
    events: [
      { seq: 0, type: 'turn/start', data: {} },
      {
        seq: 1,
        type: 'request/header',
        data: {
          config: { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'adapter-default' },
          adapterDefaults: { reasoningEffort: true },
        },
      },
    ],
  }),
})
ctx.provide('sessionPersistence', {
  list: async () => stored,
  open: async (id) => {
    if (id !== 'session-root01') throw new Error('no such session ' + id)
    return {
      read: async (offset, length) => ({ events: root01Log.slice(offset, offset + length) }),
      close: () => {},
    }
  },
})
const routes = []
ctx.provide('webServer', {
  register: (route) => {
    routes.push(route)
    return () => {}
  },
})
apply(ctx)

// 运行中新建一个会话（payload 是 Session，插件只读 header）。
ctx.emit('session/created', { id: 'session-live05', header: { id: 'session-live05', cwd: '/p/beta' } })

await new Promise((resolve) => setTimeout(resolve, 100))

const file = join(dir, 'members.json')
assert.ok(existsSync(file), 'members.json 应该被写出')
const state = JSON.parse(await readFile(file, 'utf8'))

const ids = Object.keys(state.members)
assert.deepEqual(ids.sort(), ['session-fork02', 'session-live05', 'session-nocwd4', 'session-root01'])
assert.equal(state.members['session-child3'], undefined, '子 agent 不应入会')

const root = state.members['session-root01']
assert.equal(root.name, 'agent-root01')
assert.equal(root.cwd, '/p/alpha')
assert.equal(root.canWake, true)
assert.equal(root.allowWake, true)

const nocwd = state.members['session-nocwd4']
assert.equal(nocwd.canWake, false, '没有 cwd 的会话可以读，但不该被叫醒')

const fork = state.members['session-fork02']
assert.equal(fork.parentSession, 'session-root01', 'fork 保留谱系但仍算独立成员')

// 幂等：同一个会话重复登记不应改写名字或重复计数。
ctx.emit('session/created', { id: 'session-root01', header: { id: 'session-root01', cwd: '/p/alpha' } })
await new Promise((resolve) => setTimeout(resolve, 50))
const again = JSON.parse(await readFile(file, 'utf8'))
assert.equal(again.members['session-root01'].name, 'agent-root01')
assert.equal(Object.keys(again.members).length, 4)
assert.ok(!existsSync(file + '.tmp'), '临时文件不应残留')

// ---------------------------------------------------------------- 只读工具
assert.ok(tools.has('meeting_list'), 'meeting_list 应已注册')
assert.ok(tools.has('meeting_read'), 'meeting_read 应已注册')

const exec = { agent: { id: 'session-fork02' } }
const listed = await tools.get('meeting_list').execute({}, exec)
assert.match(listed.message, /会议室共 4 位成员/)
assert.match(listed.message, /agent-root01 \[root01\] cold/)
assert.match(listed.message, /agent-nocwd4 .*不可叫醒/)

const read = tools.get('meeting_read')
const first = await read.execute({ name: 'agent-root01' }, exec)
assert.match(first.message, /用户：帮我看看 GLOSS 的表格/)
assert.match(first.message, /助手：表格列宽有问题/)
assert.match(first.message, /工具结果：diff --git/)
assert.doesNotMatch(first.message, /turn\/start/, 'turn 边界是噪声，不该投影')

const second = await read.execute({ name: 'agent-root01' }, exec)
assert.match(second.message, /没有新的对话/, '游标应已推进到日志末尾')

const replay = await read.execute({ name: 'agent-root01', since: 0 }, exec)
assert.match(replay.message, /帮我看看 GLOSS/, '显式 since 应能重读')

const cursorState = JSON.parse(await readFile(join(dir, 'cursors.json'), 'utf8'))
assert.equal(cursorState.cursors['session-fork02']['session-root01'], 4, '游标应停在最后一条之后')

const missing = await read.execute({ name: '不存在的人' }, exec)
assert.match(missing.message, /找不到/)

// ---------------------------------------------------------------- 投递
assert.ok(tools.has('meeting_send'), 'meeting_send 应已注册')
const send = tools.get('meeting_send')

liveAgents.set('session-live05', fakeAgent('session-live05', 'idle'))
liveAgents.set('session-root01', fakeAgent('session-root01', 'running'))

// 1) 空闲 → followup
const firstSend = await send.execute({ name: 'agent-live05', text: '你那边表格修好了吗？' }, exec)
assert.equal(firstSend.delivered, 'followup', '空闲目标应走 followup')
assert.equal(delivered.length, 1)
const mail = delivered[0].message
assert.equal(mail.role, 'user')
assert.equal(mail.source.kind, 'plugin:dsh-meeting', '来源标记必须是 plugin:dsh-meeting')
assert.equal(mail.source.senderSessionId, 'session-fork02')
assert.equal(mail.source.senderName, 'agent-fork02')
assert.equal(mail.source.hops, 1)
assert.match(mail.source.traceId, /^[0-9a-f-]{36}$/)
assert.match(mail.content[0].text, /来自「agent-fork02」/)
assert.match(mail.content[0].text, /你那边表格修好了吗/)

// 2) 正在跑 → steer
const steerSend = await send.execute({ name: 'agent-root01', text: '插一句' }, exec)
assert.equal(steerSend.delivered, 'steer', 'running 目标应走 steer')

// 3) 发给自己 → 拒绝
const selfSend = await send.execute({ name: 'agent-fork02', text: '自言自语' }, exec)
assert.match(selfSend.message, /不能发给自己/)
assert.equal(delivered.length, 2, '被拒的消息不能进入投递')

// 4) replyTo 沿同一条 trace 续跳
const replySend = await send.execute(
  { name: 'agent-live05', text: '收到', replyTo: firstSend.messageId },
  exec,
)
assert.equal(replySend.hops, 2)
assert.equal(replySend.traceId, firstSend.traceId, '回复必须沿用原 trace')
assert.equal(delivered.at(-1).message.source.hops, 2)

// 5) 超过 4 跳 → 拒绝（换一对成员，避免先撞上限速）
let last = replySend
for (let hop = 3; hop <= 5; hop++) {
  last = await send.execute({ name: 'agent-root01', text: '第 ' + hop + ' 跳', replyTo: last.messageId }, exec)
}
assert.match(last.message, /超过 4 跳/, '第 5 跳必须被拒')

// 6) 同一对成员 60 秒内第 4 条 → 限速（live05 此前已收 2 条）
await send.execute({ name: 'agent-live05', text: '第三条' }, exec)
const blocked = await send.execute({ name: 'agent-live05', text: '第四条' }, exec)
assert.match(blocked.message, /60 秒内/, '第 4 条必须被限速')

// 7) 正文超过 8KB → 拒绝，而不是把整段历史搬过去
const huge = await send.execute({ name: 'agent-root01', text: 'x'.repeat(8001) }, exec)
assert.match(huge.message, /超过 8000 字上限/)

// ---------------------------------------------------------------- 叫醒
ctx.emit('session/created', { id: 'session-late07', header: { id: 'session-late07', cwd: '/p/late' } })
await new Promise((resolve) => setTimeout(resolve, 30))

const wakeSend = await send.execute({ name: 'agent-late07', text: '醒醒，帮我看个东西' }, exec)
assert.equal(wakeSend.delivered, 'wake', '冷会话应该走 wake')
assert.equal(resumed.length, 1)
assert.equal(resumed[0].resumeSessionId, 'session-late07', 'resume 要用目标自己的 id')
assert.deepEqual(mounted, ['resolved:writer'], 'preset 必须被挂回去，否则目标会以默认组合回话')
assert.equal(resumed[0].agentOptions.model, 'deepseek-v4', '必须恢复模型路由，否则 {{model}} 没有值')
assert.equal(
  resumed[0].agentOptions.reasoningEffort,
  undefined,
  'adapter 默认的 reasoningEffort 不应被写死',
)

assert.equal(assembleHooks.length, 1, '叫醒后要补上 {{model}} 的提示词变量')
const assembledWoken = await assembleHooks[0]({}, {}, async () => ({ sections: [], variables: {} }))
assert.equal(assembledWoken.variables.model, 'deepseek-v4', '提示词变量里要有 model')
assert.equal(assembledWoken.variables.provider, 'deepseek', '提示词变量里要有 provider')

const woken = delivered.find((entry) => entry.to === 'session-late07')
assert.ok(woken, '叫醒后要把消息 followup 给新 agent')
assert.match(woken.message.content[0].text, /醒醒，帮我看个东西/)

// 没有 cwd 的成员：拒绝而不是 resume 一个无目录会话
const noCwd = await send.execute({ name: 'agent-nocwd4', text: '在吗' }, exec)
assert.match(noCwd.message, /没有工作目录/)

// 8) 有 sessionController 时优先走宿主的组合路径（preset + 模型选择一起装）
ctx.provide('sessionController', {
  resolveAgent: async (id) => {
    if (id === 'session-late09') return { error: { message: 'writer held by another owner' } }
    return { agent: fakeAgent(id, 'idle') }
  },
})
ctx.emit('session/created', { id: 'session-late08', header: { id: 'session-late08', cwd: '/p/late' } })
await new Promise((resolve) => setTimeout(resolve, 30))
const resumesBeforeController = resumed.length
const viaController = await send.execute({ name: 'agent-late08', text: '走控制器' }, exec)
assert.equal(viaController.delivered, 'wake')
assert.equal(resumed.length, resumesBeforeController, '有控制器时不应再自己 resume')
assert.ok(
  delivered.some((entry) => entry.to === 'session-late08' && entry.via === 'followup'),
  '控制器拿到的 agent 应收到消息',
)

// 9) 控制器明确报错时，把原因原样抛给调用者，而不是假装成功
ctx.emit('session/created', { id: 'session-late09', header: { id: 'session-late09', cwd: '/p/late' } })
await new Promise((resolve) => setTimeout(resolve, 30))
const controllerError = await send.execute({ name: 'agent-late09', text: '在吗' }, exec)
assert.match(controllerError.message, /writer held by another owner/, '控制器的错误原因要透传')

// ---------------------------------------------------------------- 审计
await new Promise((resolve) => setTimeout(resolve, 50))
const auditLines = (await readFile(join(dir, 'messages.ndjson'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
assert.ok(auditLines.length >= 8, '每次投递尝试都该留痕')
assert.ok(auditLines.some((line) => line.ok === true && line.traceId !== ''))
assert.ok(auditLines.some((line) => line.ok === false && line.reason === 'self'))
assert.ok(auditLines.some((line) => line.ok === false && line.reason === 'hop-limit'))
assert.ok(auditLines.some((line) => line.ok === false && line.reason === 'rate-limit'))
assert.ok(auditLines.every((line) => typeof line.at === 'number'))

// ---------------------------------------------------------------- 群聊 API
await new Promise((resolve) => setTimeout(resolve, 60))
const apiRoute = routes.find((route) => route.path === '/dsh-meeting/api')
assert.ok(apiRoute, '应注册 /dsh-meeting/api')
assert.equal(apiRoute.kind, 'exact')

const callApi = async (headers) => {
  const chunks = []
  const response = {
    statusCode: 0,
    writeHead(code) { this.statusCode = code },
    end(body) { if (body !== undefined) chunks.push(String(body)) },
  }
  await apiRoute.handler(
    { method: 'GET', url: '/dsh-meeting/api', headers: headers || { host: 'dsh.zhbc.bid:3003', 'sec-fetch-site': 'same-origin' } },
    response,
  )
  return { status: response.statusCode, body: chunks.join('') }
}

const ok = await callApi()
assert.equal(ok.status, 200, '同源 GET 应 200')
const snapshot = JSON.parse(ok.body)
assert.ok(Array.isArray(snapshot.members) && snapshot.members.length > 0)
const byName = new Map(snapshot.members.map((member) => [member.name, member]))
assert.equal(byName.get('agent-live05').status, 'idle', '成员状态应来自 live agent')
assert.equal(byName.get('agent-root01').status, 'running')
assert.ok(snapshot.events.some((event) => event.kind === 'read'), 'read 事件应进快照')
assert.ok(
  snapshot.events.some((event) => event.kind === 'send' && typeof event.preview === 'string' && event.preview !== ''),
  'send 事件应带摘要',
)
assert.equal(snapshot.events.at(-1).seq, snapshot.lastSeq, 'seq 应与 lastSeq 对齐')

const crossSite = await callApi({ host: 'dsh.zhbc.bid:3003', 'sec-fetch-site': 'cross-site' })
assert.equal(crossSite.status, 403, '跨站请求必须被拒')
const foreignOrigin = await callApi({ host: 'dsh.zhbc.bid:3003', origin: 'https://evil.example' })
assert.equal(foreignOrigin.status, 403, '异源 Origin 必须被拒')

console.log('smoke OK —', Object.keys(again.members).length, '个成员；工具', [...tools.keys()].join(', '))
