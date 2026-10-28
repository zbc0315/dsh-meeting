# dsh-meeting 安装与验收

> **当前状态（2026-10-28 13:50）**：安装完成、已重启验证——群聊面板、互发消息、冷会话叫醒三条链路全部在真机上跑通。
> 静态校验通过（`dsh --profile web --dump-config` 能看到 `dsh-meeting` 条目，退出码 0）。
> 顺手发现一件事：`--dump-config` 实际会挂载插件，所以 `~/.dsh/meeting/members.json` 已经生成——
> 42 个 root 会话，0 个 subagent，说明扫盘与过滤在真实数据上是对的。

> 这一步会改动**正在运行的 profile**，所以由人执行；AI 只把命令和验收清单准备好。
> 包本身的离线冒烟（`node tools/smoke.mjs`）已经通过，安装只是让它进入宿主。

## 1. 安装（已完成）

本来需要三条命令，现已在 2026-10-25 17:34 执行完毕，留档备查：

```bash
cd ~/.dsh/profiles/web
pnpm add '@tom2012/dsh-meeting@link:/Users/tom/Projects/dsh-meeting'
# package.json 的 dsh.profile.bundles 里加了 "@tom2012/dsh-meeting"
```

`dsh.profile.bundles` 里加完应该是这样（顺序不敏感，放在内置 bundle 之后即可）：

```jsonc
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@local/dsh-memory",
  "@tom2012/dsh-meeting",
  "dsh-monitor",
  ...
]
```

## 2. 重启

```bash
# 按你平时的方式重启 dsh web（不要用 AI 会话去 kill 宿主）
```

## 3. 验收

### 3.1 起搏检查

```bash
ls ~/.dsh/meeting/
# 期望：members.json（注册表）、cursors.json（读游标）；发过消息后出现 messages.ndjson
```

`members.json` 里应该已经有所有历史 root 会话，且**没有** `origin: "subagent"` 的条目。有任何一条都说明过滤失效。

### 3.2 工具可用

在任意一个对话里让模型调用 `meeting_list`，应当返回成员表（名字 / 短 id / 状态 / cwd）。

### 3.3 DESIGN §10 的四项运行时验证

**2026-10-28 13:49 实测结果**（重启后的宿主 39654，叫醒 `agent-a70244`，2 跳往返）：

| # | 怎么测 | 结果 |
|---|---|---|
| ① 模型是否保留 | A `meeting_send` 给冷会话 B，看 B 回话 | ✅ 正常回话，没有再出现 `{{model}}` 组装失败 |
| ② Web 打开是否正常 | 叫醒后从群聊面板点进 B | ✅ 能加载、能看历史 |
| ③ preset 是否可靠 | 叫醒时走 `sessionController.resolveAgent()`（内部 composeAgent） | ✅ 不再手工挂 preset，preset + 模型选择一起装 |
| ④ steer 时机 | A 对运行中的 B `meeting_send` | ✅ 面板显示「插队送达」，回复在下个边界回到 A |

叫醒链路的两处坑（都在真机上踩到过，详见 DESIGN §5.2）：

1. `setup` 不能返回 Promise（宿主会对返回值调 `.commit()`）；
2. 只挂 preset 不够，还要装模型选择钩子，否则第一轮报 `prompt variable "{{model}}" has no value`。

### 3.4 端到端

两个会话互发一轮，确认：

- 收件方看到的是「【dsh-meeting】来自「X」的消息」；
- `messages.ndjson` 里有两行 `ok:true`，`traceId` 相同、`hops` 分别是 1 和 2；
- 对方消息在 UI 上是 `role:user` 的来源（v0 没有徽标，这是已知的）。

## 4. 回滚

```bash
cd ~/.dsh/profiles/web
# 从 dsh.profile.bundles 删掉 "@tom2012/dsh-meeting"
pnpm remove '@tom2012/dsh-meeting'
# 重启
```

数据留在 `~/.dsh/meeting/`，删不删都不影响卸载。

## 5. 已知代价（不是 bug）

- 插件叫醒的会话归插件 fiber 所有：**插件重载/卸载会让正开着该会话的标签页掉线**，需要重新打开。
- 叫醒会在无人值守时消耗 token；`messages.ndjson` 是唯一的事后追溯。
- 全机公开 + 原文意味着任何会话都能读任何会话；逃生门是手改 `members.json` 里的 `muted` / `allowWake`。
