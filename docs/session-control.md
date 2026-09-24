# 会话控制模式 / Session control

本文描述已实现的会话选模规则。控制对象是 Governor 管理的任务，不是账号的全局模型设置。

## 模式和优先级

| 模式 | 选择来源 | 有效期 |
| --- | --- | --- |
| auto | Governor 的额度、优先级和策略 | 直到显式切换 |
| manual | 明确指定的模型＋思考强度，优先于额度和 High 优先级 | 直到显式切换或重新设置 |
| off | 原生客户端，IDE 代理原样透传请求 | 直到显式切换 |
| keep（旧模式兼容） | 最新的 Normal 配置 | 直到显式切换 |

```sh
codex-governor mode <任务ID> manual --model <模型ID> --effort <思考强度>
codex-governor mode <任务ID> off
codex-governor mode <任务ID> auto
codex-governor explain <任务ID>
```

源码运行时可将 `codex-governor` 替换为 `node dist/cli.js`。TUI 按 M 选择模式；Manual 依次选择模型和思考强度，完成两步后才保存，Esc 取消不改动原模式。

Manual 必须同时指定模型与思考强度，用账号当前模型目录校验。不支持的组合报错并保留原模式；已固定的模型后续不可用时，发送失败，不静默回退。只有用户明确操作才进入 manual，不根据原生请求的模型字段差异猜测用户意图。

切回 auto 清除手动组合并恢复策略；此前额度周期限制仍保留，按真实周期重置规则释放。Manual/off 不新增或清除这些历史限制。Keep 仍跟随 Normal 配置，修改 Normal 会影响其下一轮；它不代表固定上一次执行值，也不代表保留原生选择器。

## 接入边界

| 发送入口 | auto / manual / keep | off |
| --- | --- | --- |
| Governor CLI/TUI | 按上述模式选模 | 阻止发送，提示从原生客户端继续或重新启用管理 |
| 已配置代理的 VS Code | 覆盖本轮请求的 model/effort 及 collaboration mode 对应字段 | 原样透传，不查询额度和 Governor 配置、不记录新轮次 |
| 桌面 App、未接入代理的原生 Codex CLI | 不拦截，使用该客户端自身设置 | 同样不拦截 |

Off 保留任务记录，不等同于 delete。历史 Current 和任务状态可能过期，不代表原生客户端的实时状态。切换 off/auto/keep 的 CLI 命令只更新本地状态，可在 Codex 无法连接时使用。Manual 需要在线校验模型。

在配置代理的 IDE 内，希望直接使用原生模型选择器时，应先切到 off。Auto/manual/keep 均覆盖选择器值，代理日志包含控制模式和实际选择，原生选择器显示不等于实际发送值。此实现不提供桌面自动拦截、全局设置重写或跨客户端手动选择自动同步。

## 运行中切换与并发

- 每个受管理轮次以原子预留为模式生效边界。预留时固定模式和模型组合；后续模式修改影响下一次预留，不改变正在执行的模型，不自动中断。
- `controlRevision` 随模式/手动组合更新递增，组合与模式在一次状态写入中保存。IDE 代理查询模型/额度后若发现修订已变化，在发出输入前报错；不自动重放用户输入。
- 同时修改设置时，以状态锁内最后一次成功写入为准。CLI 成功输出说明模式，用户可通过 explain 检查当前设置；没有基于文件时间戳猜测用户选择来源。
- 模式变化不修改历史 `current`。成功的 turn/start 回执保存 `currentMode`，因此运行中从 auto 切 manual 时可以分别展示当前 auto 配置与下一轮 manual 配置。
- 这些锁只约束已接入 Governor 的进程，不能阻止 App 或未接入代理的 CLI 并发发起轮次。应在一个客户端中继续同一线程。

## 数据兼容与验收

旧状态默认 `manualSelection=null`、`controlRevision=0`、`currentMode=null`；既有 auto/keep 语义不变。历史模式来源未知时显示 unknown，不猜测。不要同时用不支持新模式的旧版本修改同一份状态。

测试覆盖手动组合优先级、非法组合不改变状态、off 原样透传且无需配置、模式切换保留当前轮次、控制变更阻止过期请求、旧状态读取，以及 CLI 的离线退出管理。原生 App 的后续轮次不在这些保证内。

## English summary

Auto uses Governor policy. Manual requires an explicit validated model/effort pair and remains fixed until changed, regardless of quota or priority. Off passes IDE requests through unchanged and disables new Governor prompt dispatch. Legacy Keep follows the latest Normal configuration. Native App/plain CLI traffic remains outside the proxy in every mode.

Changes apply at the next atomic turn reservation. Current retains the last acknowledged selection and its control mode; off-mode history may be stale. Revision checks reject stale proxy preflight without replaying input. Returning to auto clears the manual pair while preserving cycle holds. The native selector does not automatically change control mode; explicitly choose off to honor it.
