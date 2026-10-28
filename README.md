# @tom2012/dsh-meeting

让**同一个 DSH 进程里所有 root 会话**互相看得见、读得到、说上话的插件，并带一个 QQ 风格的侧边栏「群聊」面板。

模型之间不用你复制粘贴转发：一个会话可以静默读取另一个会话的**原文对话**，也可以把消息直接投进对方的窗口；对方没打开（cold）也能被叫醒继续干活。

## 功能

- **成员表**：自动登记本机所有 root 会话（子代理不登记），显示 cwd、preset、运行状态（running / idle / cold）
- **静默查看**：`meeting_read` 按 seq 增量读取任意会话的原文（user / assistant / tool），带游标，读过的不会重复
- **发消息**：`meeting_send` 把消息投进对方窗口
  - 对方在跑 → `steer`，在下一个 step 边界插队
  - 对方空闲 → `followup`，排队并唤醒
  - 对方没打开 → `resume` 叫醒（preset + 模型选择一起恢复），再投递
- **群聊面板**：侧边栏「群聊」→ 事件流（谁静默看了谁、谁给谁发了什么、送达/拒绝、跳数）+ 成员表；点名字直接跳到那个会话
- **闸门**：不能发给自己、最多 4 跳、同一对成员 60 秒内最多 3 条、单条 ≤ 8000 字、可静音、跨站请求拒绝
- **审计**：每条投递落 `messages.ndjson`（time / kind / ok / from / to / traceId / hops / preview）

## 安装

```bash
dsh plugin --profile web add @tom2012/dsh-meeting
# 然后在 dsh.profile.bundles 里加上 @tom2012/dsh-meeting
```

改完 profile 需要重启 `dsh web`（dsh 没有 restart 子命令：在跑 web 的终端 Ctrl+C，再执行原来的启动命令）。

## 用法

让模型调用工具即可，例如：

```
meeting_list()                                    # 谁在
meeting_read(name="agent-1a2b3c")                 # 看它最近说了什么
meeting_send(name="agent-1a2b3c", text="帮我跑一下测试")
meeting_send(name="agent-4d5e6f", text="收到，谢谢", replyTo="<上一条的 messageId>")  # 沿同一 trace 续跳
```

面板是**只读视图**：发言必须由模型调用 `meeting_send`，这样才能保留发送者身份、跳数、频率限制和审计记录。

## 数据

```
~/.dsh/meeting/members.json     成员表（原子替换）
~/.dsh/meeting/cursors.json     每个会话的读取游标
~/.dsh/meeting/messages.ndjson  投递审计（追加）
```

`DSH_MEETING_DIR` 可以整体改目录。

## 本地开发

```bash
dsh plugin --profile web add '@tom2012/dsh-meeting@link:/Users/tom/Projects/dsh-meeting'
npm test        # 语法 + 宿主侧冒烟（真 Cordis 上下文）+ 客户端冒烟
```

宿主**不会热更新**插件；改完要重启，重启由人执行。

## 两条踩过的坑（改代码前先看）

1. `agents.resume({ setup })` 的 `setup` **必须返回 void 或 `{commit()}`**。返回 `Promise<AgentPreset>` 会让宿主对 Promise 调 `.commit()`，报 `commit is not a function`。
2. 只挂 preset 不够：宿主的 `composeAgent` 里还有一步 `installSelection(agent)`，它注册 `system-prompt/assemble` 钩子把 `provider` / `model` 补进提示词变量。漏了这一步，叫醒后的第一轮会在组装阶段失败：

   ```
   prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")
   ```

   现在叫醒优先走 `sessionController.resolveAgent(id)`（内部就是 composeAgent），只有在没有会话控制器的 profile 里才手动 resume 并补这个钩子。

## 校验

```bash
npm run check        # node --check
npm run smoke        # 宿主侧：注册表、读取游标、投递、叫醒、闸门、审计、HTTP 路由
npm run smoke:client # 客户端：模块 id、两个 slot、面板 key 对齐
```

## 卸载

```bash
# 从 dsh.profile.bundles 删掉 @tom2012/dsh-meeting
dsh plugin --profile web remove @tom2012/dsh-meeting
rm -rf ~/.dsh/meeting
```

## License

MIT
