# Codex Resource Governor

[English](README.md)

同时开着几个 Codex 任务时，额度往往要留给最重要的事：发布修复可能需要更强的模型，整理文档则未必。额度监视器能告诉你还剩多少，具体到哪个任务、下一条消息该用什么模型，通常仍要自己逐一判断。

Codex Resource Governor 把这一步放到任务开始前。你设定 Normal 和 Economy 两套模型及思考强度，给任务标记优先级，再选择 Quality、Balanced 或 Saver 策略。它通过 Codex App Server 读取账号额度和可用模型，在**每一轮用户消息开始前**选择配置；一轮已经开始，就不会中途切换。与 [Codex Usage Monitor](https://github.com/Corread8/codex-usage-monitor)、[Codex Monitor](https://github.com/manuelsh/codex-monitor) 这类查看额度或回顾用量的工具相比，它关注的是下一轮如何执行，两者也可以配合使用。

它最适合多个受管理会话同时运行、额度开始紧张的情况。High 优先级保持 Normal；Normal 和 Low 可以随着额度收紧降低思考强度或切到 Economy。Economy 由你自己指定，本项目不根据模型名称推断价格，也不承诺固定节省比例。如果只用一个会话且额度充足，直接使用 Codex 通常更简单。

这是独立的 MIT 开源项目，不是 OpenAI 官方产品。v0.1 提供本地 CLI/TUI，只管理它创建的任务；Codex 仍负责登录、会话历史、工具调用和审批。桌面 App、IDE 或其他 CLI 自行创建的会话不会自动纳入管理。

## 安装与首次配置

先准备好：

- **Node.js 20 或更新版本**，以及随 Node 安装的 npm；建议使用当前主版本的最新补丁。
- **可执行的 Codex CLI**，且支持 `app-server`。Governor 使用它启动 Codex，不会代替你安装 Codex。macOS 上会先检查 `PATH`，再尝试寻找 VS Code Codex 扩展或 ChatGPT App 中的可执行文件；Linux/WSL2 请确保 `codex` 在 `PATH` 中。需要指定路径时，设置 `CODEX_GOVERNOR_CODEX=/absolute/path/to/codex`。
- **已在 Codex 登录 ChatGPT 账号**。在终端运行 `codex login` 完成登录；Governor 复用该登录，不需要另填 API Key。仅使用 API Key 的账号无法使用这里的 ChatGPT 额度管理。

如果终端找不到 `codex`，先设置 `CODEX_GOVERNOR_CODEX` 为实际可执行文件路径，再运行 `"$CODEX_GOVERNOR_CODEX" login`。安装后用 `codex-governor doctor`（源码方式用 `node dist/cli.js doctor`）检查路径、登录和接口是否可用。

本项目面向 macOS、Linux；Windows 建议使用 WSL2。还需为 Codex 本身预留内存：至少按 4 GB 规划，8 GB 更宽裕。Governor 的 npm 依赖由 `npm ci` 或 `npm install` 安装，无需逐个安装 React、Ink 等包。

npm 包发布后，可直接安装：

```sh
npm install -g codex-resource-governor
codex-governor doctor
codex-governor config --lang zh-CN
codex-governor
```

配置向导首先选择 English / 简体中文，再选择 Normal 模型与推理强度、Economy 模型与推理强度、策略。所有可选值来自当前账号的 `model/list`。Economy 由用户自行选择；接口模型列表不代表价格排序，也不能保证具体节省比例。

语言选择放在安装后的首次配置中，npm 生命周期不弹交互提示，避免自动安装卡住。默认英文，也可设置 `CODEX_GOVERNOR_LANG=zh-CN`；`--lang` 优先。

也可以从 GitHub 源码安装（需要 Git）：

```sh
git clone https://github.com/shuwei1006/codex-resource-governor.git
cd codex-resource-governor
npm ci
npm run build
node dist/cli.js doctor
node dist/cli.js config --lang zh-CN
```

源码方式可以继续用 `node dist/cli.js run "任务描述"`；如需使用全局 `codex-governor` 命令，可在项目目录运行 `npm link`。开发者可以运行 `npm test` 检查项目。GitHub 和 npm 是两处独立的发布渠道；发布前，上述远程安装命令暂不可用。

## 命令

| 命令 | 用途 |
| --- | --- |
| `codex-governor` | 打开 TUI；首次启动进入配置 |
| `codex-governor doctor` | 检查运行环境、登录、schema 和接口能力 |
| `codex-governor config` | 配置 Normal / Economy / Policy / 语言 |
| `codex-governor run --priority high "做一个关于中秋节的祝福卡片"` | 自动命名、创建任务并立即执行 |
| `codex-governor list [--json]` | 查看任务 ID 与 Codex Thread ID |
| `codex-governor open <id> --target app\|vscode\|both` | 在原生客户端打开已完成的任务 |
| `codex-governor integration vscode --codex /path/to/codex` | 生成实验性 IDE 选模代理的启动器和设置片段 |
| `codex-governor priority <id> high\|normal\|low` | 调整优先级 |
| `codex-governor mode <id> auto\|manual\|off` | 自动选模／手动固定／原生控制；兼容 keep |
| `codex-governor interrupt <id>` | 按任务 ID 中断运行中的 turn，支持从另一个终端操作 |
| `codex-governor delete <id>` | 删除本地任务记录；运行中会先中断 |
| `codex-governor policy quality\|balanced\|saver` | 切换策略 |
| `codex-governor explain <id>` | 解释下一轮为何调整 |

任务 ID 支持不产生歧义的前缀。`run --cwd /path/to/project "任务描述"` 指定工作目录，默认使用当前目录。已有任务在 TUI 详情中按 Enter 继续输入。`interrupt <id>` 会启动独立的 App Server 会话，恢复保存的 thread，再使用保存的 turn ID 请求中断，因此可以在另一个终端执行。`delete <id>` 只删除 Governor 的本地记录，不删除 Codex 中的 thread 历史；如果任务仍在运行，必须先成功中断才会删除记录。

一句话直接创建并执行：

```sh
codex-governor run --priority high "做一个关于中秋节的祝福卡片"
```

系统会在本地生成任务名 `中秋节祝福卡片`，创建 Codex Thread，根据当前额度、优先级与策略选择模型/推理强度，再通过 `turn/start` 发送完整任务描述。交互终端会自动打开详情并开始执行，不需要再次按 Enter。重定向输出时则等待执行完成并打印回复，交互审批会明确拒绝。

自动命名使用本地文本规则：取首句/首行、精简常见请求前缀并限制为 32 个 Unicode 字符（含省略号），不额外调用模型。名称仅用于显示，发送给 Codex 的任务内容不会因此缩短。也可以手动指定名称：

```sh
codex-governor run --name "节日卡片" --priority high "做一个关于中秋节的祝福卡片"
```

原有 `run --name "任务名" --prompt "任务描述"` 仍可使用，`--prompt` 与位置参数不能同时提供。仅传 `run --name "任务名"` 时，保留旧的交互行为：创建任务并打开详情，等待输入。空白任务描述会在创建线程前报错。

非交互配置可传 `--normal-model`、`--normal-effort`、`--economy-model`、`--economy-effort`、`--policy`、`--lang`。首次使用必须提供完整模型配置，之后仅提供需修改的字段。模型和 effort 必须真实存在于账号返回结果中。

## 典型使用场景

当多个 Codex 会话共享相对紧张的账号额度时，Governor 的价值最明显。它不是后台任务调度器；每个任务都是由用户明确启动和继续的独立 Codex Thread。一次用户输入提交后，到本轮完成、失败或被中断为止，算一个 **turn**。这一轮中的工具调用、终端命令和文件修改都属于同一个 turn。运行期间模型与思考强度保持不变，Governor 只在下一轮开始前重新判断。

### 多个会话并行时保护重要任务

让发布修复始终使用 Normal 配置，同时允许常规任务在额度紧张时降低推理强度或切换 Economy：

```sh
codex-governor run --priority high "修复阻塞发布的登录回归问题"
codex-governor run --priority normal "为设置页面补充测试"
codex-governor run --priority low "整理并总结归档的设计文档"
```

Auto 模式下，High 优先级始终使用配置好的 Normal 模型与思考强度；Normal 和 Low 根据当前额度与策略调整。这是最典型的场景：同时运行多个会话、任务重要程度不同、可用额度有限。

### 重要长任务首轮保证质量，后续修改按额度调整

PPT、报告、网站或大型重构通常需要高质量的第一版，而后续小修改可以根据额度调整：

```sh
codex-governor run --priority high "制作产品发布会 PPT 的第一份完整版本"
# 第一轮完成后：
codex-governor priority <任务ID> normal
```

第一轮从开始到结束都保持 Normal 配置。之后每次输入“修改第三页”或“检查导出文件”等新要求前，Governor 都会刷新额度，再选择 Normal、降低一级思考强度或 Economy。制作过程中不会执行到一半突然切换模型。

### 保守执行常规或批量任务

对于更关注吞吐量、无需始终保持最高推理质量的任务，可以使用 Low 优先级和 Saver 策略：

```sh
codex-governor policy saver
codex-governor run --priority low "统一整理项目文档格式"
codex-governor run --priority low "汇总已经完成的测试日志"
```

Saver 会比 Balanced 和 Quality 更早收紧配置。实际使用哪个 Economy 模型由首次配置决定；Governor 不推断模型价格或成本。

### 为连续多轮敏感操作固定模型

代码审查、迁移或可复现性检查可能要求连续多轮固定使用同一个模型与思考强度，此时使用 Manual：

```sh
codex-governor mode <任务ID> manual --model <模型ID> --effort high
```

该组合不会被额度或优先级覆盖，直到用户明确修改模式。使用 `codex-governor mode <任务ID> auto` 可恢复自动控制。

### 临时把选择权交回原生客户端

如果受管理的 VS Code 会话需要临时使用原生模型选择器，先关闭该任务的选模管理：

```sh
codex-governor mode <任务ID> off
```

IDE 代理随后会保留原生 `turn/start` 中的选择；切回 Auto 后恢复额度管理。Codex 桌面 App 和直接执行 `codex resume` 的消息仍不经过 Governor 拦截。

如果只偶尔使用一个会话、额度充足，或者全部交互都在 Codex 桌面 App 中完成，Governor 带来的收益较少，直接使用原生 Codex 通常更简单。

## 会话控制模式

`auto` 按策略自动选模；`manual` 固定明确指定的模型与思考强度，额度和优先级不会覆盖；`off` 将选择权交回原生客户端。旧 `keep` 仍表示使用最新 Normal 配置。

```sh
codex-governor mode <任务ID> manual --model <模型ID> --effort <思考强度>
codex-governor mode <任务ID> off
codex-governor mode <任务ID> auto
codex-governor explain <任务ID>
```

Manual 必须同时提供两个参数并通过模型目录校验，直到主动切换才结束。模式修改仅影响之后预留的轮次，不中断当前执行。Off 下 Governor 不发送新输入，IDE 代理原样透传，历史 Current 可能过期。TUI 按 M 可选择模式及手动组合；在原生选择器手动选模前先切 off，不能仅根据字段差异自动识别手动意图。桌面 App 和未接入代理的原生 CLI 在所有模式下仍使用各自设置。详见 [控制权与冲突规则](docs/session-control.md)。

## 在 Codex App 和 VS Code 中继续任务

首次任务在 Governor 中执行，**成功完成后**可自动打开同一个 Codex 会话：

```sh
codex-governor run --priority high --open both "做一个关于中秋节的祝福卡片"

# 保存偏好；之后 run 不必再写 --open
codex-governor config --open-in both

# 打开已有任务，或只打印链接
codex-governor list
codex-governor open <任务ID> --target vscode
codex-governor open <任务ID> --target app
codex-governor open <任务ID> --target both --print
```

`--open none` 可覆盖自动打开偏好。运行中、状态不明或尚未提交输入的任务不会直接交接，以免两个客户端同时继续同一线程。自动打开失败时保留任务和结果，安装对应应用后再使用 `open`，不需要重新执行任务。`open --print` 只输出链接，不启动应用。

Governor 会尝试用 `thread/name/set` 同步任务名称，启动时同时打印任务 ID 和 Codex Thread ID。桌面 App 使用官方 `codex://threads/<thread-id>` 链接；VS Code 使用当前扩展的 `vscode://openai.chatgpt/local/<thread-id>` 路由，后者是版本相关的集成入口。两端都必须使用同一台机器、同一份 Codex 本地会话存储（相同的 `CODEX_HOME`）；这不是云同步或跨机器共享。

| 原生界面 | 查看历史并继续交互 | 后续每轮由 Governor 选模 |
| --- | --- | --- |
| VS Code 的 Codex 扩展 | 支持按线程打开 | 配置下面的实验性代理后支持受管理任务的 `turn/start` |
| Codex 桌面 App | 支持按线程打开 | **不支持**；新消息使用 App 自身的模型设置 |

这里实现的是完成后的会话交接，不是运行中画面的实时镜像。App 尚无已确认可用的公开逐轮选模拦截接口；深链接也不提供该能力。不要同时在 App 和 IDE 中给同一线程发送新消息。直接使用 `codex resume` 同样不会经过 Governor 代理。

### 在 VS Code 中保留自动选模

先完成 Governor 模型配置并构建，再生成启动器：

```sh
npm run build
node dist/cli.js integration vscode --codex "$(command -v codex)"
```

命令只在 Governor 数据目录生成一个启动器，并打印类似以下的 JSON；**不会自动修改 VS Code 设置**：

```json
{
  "chatgpt.cliExecutable": "/absolute/path/to/codex-governor-ide"
}
```

将实际输出的键值合并到 VS Code 的 **Preferences: Open User Settings (JSON)**，然后执行 **Developer: Reload Window**。保留其他设置。此项是官方标注为 development-only 的覆盖设置，可能随扩展升级变化。优先通过 `--codex` 指定当前扩展自带的真实 Codex 可执行文件以减少版本差异；升级或移动项目后重新生成启动器。恢复默认时删除 `chatgpt.cliExecutable` 并重新加载窗口。

此后，打开 Governor 创建的任务，在 IDE 中发送下一条消息：代理会刷新账号模型列表、额度和 Governor 配置，再写入本轮实际的 `model`、`effort`；也会更新 Plan 等 collaboration mode 中具有优先权的对应字段。输入、图片、审批、安全设置和通知由原生客户端处理。代理只管理 `state.json` 已登记的线程，其他原生会话直接透传；不会导入或接管其他任务。仅覆盖 `turn/start`，不宣称管理独立 review 或其他自动触发的推理入口。Codex 输出日志中的 `[Governor]` 行记录实际选择；原生模型选择器可能仍显示其自身选择，以实际发送值及 Governor 的 Current 为准。

源码运行时上面的其他 `codex-governor ...` 命令也可写成 `node dist/cli.js ...`。详细接口依据与验证边界见 [原生接入说明](docs/native-integration.md)。

## TUI 使用

主界面显示当前策略、5h/周额度和任务列表，按终端高度分页。每个任务分别展示：

```text
当前:   <Normal 模型> · high
下一轮: <Economy 模型> · medium
```

“当前”是提交给当前或上一轮的模型/effort，不是服务端实时回执证明。“下一轮”是最新策略结果。运行中的 turn 不会因自动降档而中途换模型。

- ↑/↓：选择任务或滚动详情；Enter：详情/输入下一轮。
- P：优先级；M：Auto/Manual/Off（兼容 Keep）；E：解释；C：配置；N：新建任务；O：选择 App / VS Code / 两者打开。
- R：立即刷新；I：中断所选任务；D：确认后删除本地记录；Esc：返回；Q / Ctrl+C：退出并请求中断本会话正在执行的 turn。
- 命令与文件修改审批支持“允许一次 / 拒绝”；用户问题支持文字回答。其他服务端请求类型会明确拒绝，不会静默授权。

详情流式显示模型文本，仅保留最近一轮最多约 32,000 字符的尾部。完整会话由 Codex 保存。

## 策略

阈值是**本项目默认值，并非 OpenAI 官方规则**，全部使用严格“小于”。

| 策略 | Normal/Low 降一级推理强度 | 切 Economy |
| --- | --- | --- |
| quality | 剩余 <10% | 剩余 <5%，仅 Low |
| balanced（默认） | 剩余 <20% | 剩余 <10%，Normal/Low |
| saver | 剩余 <40% | 剩余 <20%，Normal/Low |

Auto 中的 High 优先级与旧 Keep 模式使用 Normal 配置；Manual/Off 不受该规则覆盖。有效额度取可用的 5h/周窗口剩余百分比最小值。窗口按时长 300 / 10080 分钟识别，不假定 primary 一定是 5h。优先选择全局 `codex` bucket；不会把某模型的额度当作全局额度。未知时长、过期快照、异常百分比和缺失数据都视为不可用，不当作 0。

同一周期内自动控制只会 `Normal → Lower Reasoning → Economy`。每个任务分别记录两个窗口的降档约束：旧重置时间已经过去，且新的有效快照提供了更晚的重置时间，才解除该窗口的约束。5h 重置不会解除周窗口触发的限制。缺失额度/重置时间时保持已有约束，不新增自动降档。

High/Keep 暂时绕过周期约束，切回 Auto 后可能重新应用。更改策略或配置不清除周期记录，但用户主动配置新模型/effort 会影响下一轮的实际选择。推理强度仅从真实可用档位降低一级，不会每次刷新再降一级。遇到未来未知档位或没有更低档位时保持原值，不猜测顺序。

每 30 秒、额度通知到达时和每次发起 turn 前刷新。其他 CLI 进程的修改会在下一次刷新时出现在 TUI，按 R 可立即刷新。同一任务通过原子状态预留防止重复提交。

## 兼容性与 doctor

需求目标基线为 Codex CLI **0.154.0**，实际本机验证记录见 [兼容性说明](docs/compatibility.md)。不按版本号硬阻断新版本，而是生成本机 CLI 的真实 schema 并检测能力。必需接口/字段缺失会明确报错，不读取或修改日志来伪造控制。

默认 doctor 检查 Node、Codex 路径与版本、schema、stdio 握手、`account/read`、全局额度、模型分页列表和临时 `thread/start`。对 `turn/start` 采用不存在的线程做无推理探测，并检查 schema 中的 model/effort 字段。这能证明协议能力，**不等于实际推理成功**。

```sh
codex-governor doctor --live-turn
```

额外执行一轮只读、仅回复 OK 的真实调用，会消耗账号额度。CI 不执行此项。该检查不能证明模型之间的实际额度节省比例。

额度服务失败时 doctor 返回失败；已配置任务仍可在额度未知、保留已有约束的情况下工作。连接断开或写操作超时不会自动重试可能已接受的 turn；任务标记为 unknown，重新提交前恢复线程并检查是否仍有运行中的 turn。

## 存储与隐私

默认路径为 `$XDG_CONFIG_HOME/codex-resource-governor` 或 `~/.config/codex-resource-governor`。可用 `CODEX_GOVERNOR_HOME` 指定独立存储目录，用 `CODEX_GOVERNOR_CODEX` 指定 Codex 可执行文件。

未指定 `CODEX_GOVERNOR_CODEX` 时，Governor 会依次检查 `PATH`、macOS 上最新安装的 VS Code/OpenAI 扩展，以及 ChatGPT App 内置文件。因此，即使没有全局安装 `codex`，也能从第二个终端执行管理命令。

运行 `codex-governor config --path` 可查看配置文件的准确路径，运行 `codex-governor config --show` 可直接查看已保存配置；这两个查询命令不会连接 Codex。

配置与状态是 zod 校验的 JSON，使用 fsync、原子重命名及短时文件锁，POSIX 下文件权限为 0600。状态包含任务名称/路径、线程 ID、优先级/模式、周期约束、提交的模型配置和最近响应尾部。Governor 不额外保存用户 prompt，Codex 按自己的会话机制保存。

无后端、数据库、Governor 遥测或凭据存储；复用 Codex 登录。Governor 自身的子进程明确关闭 analytics 与 OpenTelemetry exporter；实验性 IDE 代理保留原生客户端的启动选项和遥测配置。执行 Codex 必需的服务请求仍会发生。Governor 创建任务时采用 workspace-write 沙箱与 on-request 审批；IDE 后续输入保留原生客户端的安全设置。

## 开发与发布

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

测试使用临时 JSON 目录和模拟 stdio 服务，不读取 ChatGPT 凭据。GitHub Actions 配置 Node 20/22 × Ubuntu/macOS；本地通过不代表远程矩阵已经运行。

贡献、漏洞报告、实现说明与发布步骤分别见 [CONTRIBUTING](CONTRIBUTING.md)、[SECURITY](SECURITY.md)、[架构说明](docs/architecture.md) 和 [发布清单](docs/releasing.md)。MVP 不包含后台调度、外部线程接管、价格推断、网页界面或额度预测。

协议依据：[OpenAI 官方 App Server 文档](https://developers.openai.com/codex/app-server)，以及本机 Codex 生成的真实 schema。

尚未发送首条消息的线程可能还没有 Codex 持久化记录。重连时，Governor 会保留任务 ID，并只为确认从未提交过 turn 的任务重新创建空线程；对可能已提交过的任务，历史缺失会明确报错，不会自动重建或重放输入。
