// 离线校验 client.js 的接线：ModuleLoader 注册、两个 slot、图标组件。
// 不渲染面板（那需要真 React 与浏览器），只保证 apply 不抛、注册项正确。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

const registrations = []
const injected = []
let loaded = null

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition
    },
  },
}

const document = {
  querySelector: () => null,
  createElement: () => ({ setAttribute() {}, textContent: '' }),
  head: { appendChild() {} },
}
globalThis.document = document

const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
}

const ctx = {
  slots: {
    inject(name, callback) {
      injected.push(name)
      return callback()
    },
    register(options, component) {
      registrations.push({ options, component })
      return { dispose() {} }
    },
  },
  get: () => undefined,
}

const fakeRequire = (name) => {
  assert.equal(name, 'react', 'client 只应 require react')
  return react
}

// 执行浏览器侧模块
new Function('window', 'document', 'require', source)(globalThis.window, document, fakeRequire)

assert.ok(loaded, 'ModuleLoader.load 应被调用一次')
assert.equal(loaded.id, '@tom2012/dsh-meeting', '模块 id 必须等于包名')

const plugin = loaded.factory(fakeRequire)
assert.ok(Array.isArray(plugin.inject) && plugin.inject.includes('slots'), '应注入 slots')
assert.equal(typeof plugin.apply, 'function')

plugin.apply(ctx)

assert.deepEqual(injected, ['sidebar.panellist', 'main'], '应注册侧边栏入口与主面板')
const sidebar = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
const main = registrations.find((entry) => entry.options.name === 'main')
assert.equal(sidebar.options.id, 'meeting')
assert.equal(sidebar.options.label, '群聊')
assert.equal(typeof sidebar.options.order, 'number')
assert.equal(main.options.key, 'meeting', '主面板 key 必须与侧边栏 id 一致')

const icon = sidebar.component()
assert.equal(icon.type, 'svg', '侧边栏入口应渲染一个 svg 图标')

console.log('client smoke OK — id', loaded.id, '；slot', injected.join(', '))
