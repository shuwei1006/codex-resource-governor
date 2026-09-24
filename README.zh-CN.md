# Codex Resource Governor

[English](README.md)

codex跑着跑着就用光了。并行跑几个 Codex 任务时，额度往往要留给最重要的事：修复代码可能需要更强的模型，整理文档则未必。大多数额度监视器都能告诉你还剩多少，但具体到哪个任务、下一条消息该用什么模型，通常仍要自己逐一判断和调整。

Codex Resource Governor 把这一步放到任务开始前。你设定主力配置和节省配置两套模型及思考强度，给任务标记优先级，再选择不同的策略质量优先、均衡或节省优先。它通过 Codex App Server 读取账号额度和可用模型，在**每一轮用户消息开始前**选择配置（一轮已经开始，就不会中途切换）。与 [Codex Usage Monitor](https://github.com/Corread8/codex-usage-monitor)、[Codex Monitor](https://github.com/manuelsh/codex-monitor) 这类查看额度或回顾用量的工具相比，它关注的是如何给任务按优先级分配额度。

它最适合多个受管理会话同时运行、额度开始紧张的情况。
高优先级任务保持主力配置；中、低优先级任务可以随着额度收紧降低思考强度或切到节省配置。
节省配置由你自己指定，本项目不根据模型名称推断价格，也不承诺固定节省比例。
但如果你经常只用一个会话且没有额度焦虑，那这个项目可能对你没什么用途。

这是独立的 MIT 开源项目。提供本地 CLI/TUI，只管理它创建的任务；
Codex 仍负责登录、会话历史、工具调用和审批。
注意，由于开放性限制，Codex桌面 App、IDE 或其他 CLI 《自行创建》的会话不会自动纳入管理。

[安装](#安装与首次配置) · [快速上手](#快速上手) · [使用场景](#典型使用场景) · [策略](#策略与额度) · [会话控制](#会话控制模式) · [命令速查](#命令速查) · [常见环境检查](#兼容性与-doctor)

## 四个概念，分别设置

| 概念 | 界面名称 | 决定什么 |
| --- | --- | --- |
| 执行配置（Model Profile） | 主力配置 / 节省配置（Primary / Economy） | 两套模型与思考强度组合 |
| 任务优先级（Task Priority） | 高 / 中 / 低（High / Medium / Low） | 哪些任务优先使用主力配置 |
| 额度策略（Quota Policy） | 质量优先 / 均衡 / 节省优先 | 额度到什么程度、对哪些任务降低配置 |
| 思考强度（Reasoning Effort） | 模型支持的原始档位，如 `high`、`medium`、`low` | 单轮调用使用的思考强度 |

例如：任务优先级为“高”，使用“主力配置”；主力配置可以是模型 A + `medium` 思考强度。高优先级并不要求 `high` 思考强度。

## 安装与首次配置

### 环境要求

先准备好：

- **Node.js 20 或更新版本**，以及随 Node 安装的 npm；建议使用当前主版本的最新补丁。
- **可执行的 Codex CLI**，且支持 `app-server`。Governor 使用它启动 Codex，不会代替你安装 Codex。macOS 上会先检查 `PATH`，再尝试寻找 VS Code Codex 扩展或 ChatGPT App 中的可执行文件；Linux/WSL2 请确保 `codex` 在 `PATH` 中。需要指定路径时，设置 `CODEX_GOVERNOR_CODEX=/absolute/path/to/codex`。
- **已在 Codex 登录 ChatGPT 账号**。在终端运行 `codex login` 完成登录；Governor 复用该登录，不需要另填 API Key。仅使用 API Key 的账号无法使用这里的 ChatGPT 额度管理。

注意：如果终端找不到 `codex`，先设置 `CODEX_GOVERNOR_CODEX` 为实际可执行文件路径，再运行 `"$CODEX_GOVERNOR_CODEX" login`。安装后用 `codex-governor doctor`（源码方式用 `node dist/cli.js doctor`）检查路径、登录和接口是否可用。

本项目面向 macOS、Linux；
Windows 建议使用 WSL2。
还需为 Codex 本身预留内存：至少按 4 GB 规划，8 GB 更宽裕。Governor 的 npm 依赖由 `npm ci` 或 `npm install` 安装，无需逐个安装 React、Ink 等包。

### 从 npm 安装

可从 [npm](https://www.npmjs.com/package/codex-resource-governor) 安装，安装后即可使用本文中的命令。

```sh
npm install -g codex-resource-governor
codex-governor doctor
codex-governor config --lang zh-CN
codex-governor
```

### 首次配置

配置向导首先选择 English / 简体中文，再选择主力配置的模型与思考强度、节省配置的模型与思考强度、额度策略。所有可选值来自当前账号的 `model/list`。节省配置由用户自行选择；

语言选择放在安装后的首次配置中，npm 生命周期不弹交互提示，避免自动安装卡住。默认英文，也可设置 `CODEX_GOVERNOR_LANG=zh-CN`；`--lang` 优先。

<details>
<summary>从源码安装（开发者或需要本地修改时使用）</summary>

也可以从 GitHub 源码安装（需要 Git）：

```sh
git clone https://github.com/shuwei1006/codex-resource-governor.git
cd codex-resource-governor
npm ci
npm run build
node dist/cli.js doctor
node dist/cli.js config --lang zh-CN
```

源码方式可以继续用 `node dist/cli.js run "任务描述"`；如需使用全局 `codex-governor` 命令，可在项目目录运行 `npm link`。开发者可以运行 `npm test` 检查项目。

</details>

<details>
<summary>脚本中的非交互配置</summary>

非交互配置可传 `--primary-model`、`--primary-effort`、`--economy-model`、`--economy-effort`、`--policy`、`--lang`。首次使用必须提供完整模型配置，之后仅提供需修改的字段。模型和 effort 必须真实存在于账号返回结果中。

</details>

## 快速上手

一句话直接创建并执行：

```sh
codex-governor run --priority high "写一份关于codex的PPT"
```

系统会在本地生成任务名 `codexPPT`，创建 Codex Thread，根据当前额度、优先级与策略选择模型/思考强度，再通过 `turn/start` 发送完整任务描述。交互终端会自动打开详情并开始执行，不需要再次按 Enter。重定向输出时则等待执行完成并打印回复，交互审批会明确拒绝。

<details>
<summary>自定义任务名称与其他 run 写法</summary>

自动命名使用本地文本规则：取首句/首行、精简常见请求前缀并限制为 32 个 Unicode 字符（含省略号），不额外调用模型。名称仅用于显示，发送给 Codex 的任务内容不会因此缩短。也可以手动指定名称：

```sh
codex-governor run --name "Codex PPT" --priority high "写一份关于codex的PPT"
```

原有 `run --name "任务名" --prompt "任务描述"` 仍可使用，`--prompt` 与位置参数不能同时提供。仅传 `run --name "任务名"` 时，保留旧的交互行为：创建任务并打开详情，等待输入。空白任务描述会在创建线程前报错。

</details>

### 继续、停止和删除任务

任务默认在当前目录执行；可用 `--cwd /path/to/project` 指定项目目录。在 TUI 中打开任务详情，按 Enter 输入后续要求。

```sh
codex-governor list
codex-governor interrupt <任务ID>
codex-governor delete <任务ID>
```

`list` 同时显示 Governor 任务 ID 和 Codex Thread ID；这里的 `<任务ID>` 使用前者，也支持无歧义的前缀。`interrupt` 可从另一个终端执行。`delete` 只删除 Governor 的本地记录，Codex 会话历史仍保留；运行中的任务会先尝试中断，中断成功后才删除。

### 什么算一轮任务

一次用户输入提交后，到本轮完成、失败或被中断为止，算一个 **turn**。这一轮中的工具调用、终端命令和文件修改都属于同一个 turn。运行期间模型与思考强度保持不变，Governor 只在下一轮开始前重新判断。

## 典型使用场景

以下示例使用自动控制模式。并行运行任务时，请分别在不同终端启动；Governor 不会自动创建后台任务队列。

### 同时推进前端、后端和 UX 修改

例如修改登录流程时，开三个 session：前端调整页面，后端修复接口，UX 优化提示文案。假设当前最急的是后端登录失败问题，就给后端任务高优先级，前端中优先级，UX 文案调整低优先级。在三个终端中分别执行：

```sh
# 终端 1：前端
codex-governor run --priority medium "修改前端登录页面，补充提交中的状态和接口错误展示"

# 终端 2：后端
codex-governor run --priority high "修复后端登录接口的鉴权错误，并补充回归测试"

# 终端 3：UX
codex-governor run --priority low "优化登录流程的提示文案，将建议整理到 UX 文档中"
```

Auto 模式下，后端 session 始终使用主力配置；前端和 UX session 在每轮消息开始前，根据额度和策略决定是否降低思考强度或切换节省配置。优先级取决于这次修改的紧急程度，并非按前端、后端或 UX 固定划分。三个 session 各自执行任务，Governor 负责选模，不会自动协调它们之间的依赖。

### 首轮使用主力配置，后续修改按额度调整

PPT、报告、网站或大型重构通常需要高质量的第一版，而后续小修改可以根据额度调整：

```sh
codex-governor run --priority high "制作产品发布会 PPT 的第一份完整版本"
# 第一轮完成后：
codex-governor priority <任务ID> medium
```

第一轮从开始到结束都保持主力配置。之后每次输入“修改第三页”或“检查导出文件”等新要求前，Governor 都会刷新额度，再选择主力配置、降低一级思考强度或节省配置。制作过程中不会执行到一半突然切换模型。

### 用更保守的策略执行常规任务

对于更关注吞吐量、无需始终保持最高推理质量的任务，可以使用低优先级和节省优先策略：

```sh
codex-governor policy save-quota
codex-governor run --priority low "统一整理项目文档格式"
codex-governor run --priority low "汇总已经完成的测试日志"
```

节省优先会比均衡和质量优先更早收紧配置。实际使用哪个节省配置的模型由首次配置决定；Governor 不推断模型价格或成本。

## 策略与额度

用以下命令查看当前配置、切换策略，或解释某个任务下一轮的选择：

```sh
codex-governor config --show
codex-governor policy balanced
codex-governor explain <任务ID>
```

主力配置和节省配置是你配置的两套模型与思考强度；`high`、`medium`、`low` 则是任务优先级。Auto 模式下，高优先级任务使用主力配置，中、低优先级任务按下表调整。Manual 和 Off 的规则见[会话控制模式](#会话控制模式)。

阈值是**本项目默认值，并非 OpenAI 官方规则**，全部使用严格“小于”。

| 额度策略 | 中/低优先级任务降一级思考强度 | 切节省配置 |
| --- | --- | --- |
| 质量优先（`quality-first`） | 剩余 <10% | 剩余 <5%，仅低优先级任务 |
| 均衡（`balanced`，默认） | 剩余 <20% | 剩余 <10%，中/低优先级任务 |
| 节省优先（`save-quota`） | 剩余 <40% | 剩余 <20%，中/低优先级任务 |

额度同时存在 5 小时和每周窗口时，取剩余比例较低的一个。同一额度周期内，自动选择只会保持或降低配置；周期重置后才解除对应限制。额度暂时无法读取时保留已有约束，不把未知额度当成 0。

额度每 30 秒、收到更新通知时和每轮开始前刷新。TUI 中按 R 可立即刷新，包括读取其他终端修改的设置。

<details>
<summary>额度窗口、降档与重置的详细规则</summary>

Auto 中的高优先级任务与Keep 模式使用主力配置；Manual/Off 不受该规则覆盖。有效额度取可用的 5h/周窗口剩余百分比最小值。窗口按时长 300 / 10080 分钟识别，不假定 primary 一定是 5h。优先选择全局 `codex` bucket；不会把某模型的额度当作全局额度。未知时长、过期快照、异常百分比和缺失数据都视为不可用，不当作 0。

同一周期内自动控制只会 `主力配置 → 降低思考强度 → 节省配置`。每个任务分别记录两个窗口的降档约束：旧重置时间已经过去，且新的有效快照提供了更晚的重置时间，才解除该窗口的约束。5h 重置不会解除周窗口触发的限制。缺失额度/重置时间时保持已有约束，不新增自动降档。

高优先级/Keep 暂时绕过周期约束，切回 Auto 后可能重新应用。更改策略或配置不清除周期记录，但用户主动配置新模型/effort 会影响下一轮的实际选择。思考强度仅从真实可用档位降低一级，不会每次刷新再降一级。遇到未来未知档位或没有更低档位时保持原值，不猜测顺序。

同一任务通过原子状态预留防止重复提交。

</details>

## 命令速查

| 命令 | 用途 |
| --- | --- |
| `codex-governor` | 打开 TUI；首次启动进入配置 |
| `codex-governor doctor` | 检查运行环境、登录、schema 和接口能力 |
| `codex-governor config` | 配置主力与节省配置 / 额度策略 / 语言 |
| `codex-governor run --priority high "写一份关于codex的PPT"` | 自动命名、创建任务并立即执行 |
| `codex-governor list [--json]` | 查看任务 ID 与 Codex Thread ID |
| `codex-governor open <id> --target app\|vscode\|both` | 在原生客户端打开已完成的任务 |
| `codex-governor integration vscode --codex /path/to/codex` | 为 VS Code 生成接入 Governor 所需的文件和设置说明，你在 VS Code 中继续 Governor 创建的任务时，Governor 才能为后续消息选模型。（这个接入方式可能随 Codex 扩展升级而变化。） |
| `codex-governor priority <id> high\|medium\|low` | 调整优先级 |
| `codex-governor mode <id> auto\|manual\|off` | 自动选模／手动固定／原生控制；keep 使用主力配置 |（见下文会话控制部分）
| `codex-governor interrupt <id>` | 按任务 ID 中断运行中的 turn，支持从另一个终端操作 |
| `codex-governor delete <id>` | 删除本地任务记录；运行中会先中断 |
| `codex-governor policy quality-first\|balanced\|save-quota` | 切换策略 |
| `codex-governor explain <id>` | 解释下一轮为何调整 |

更多参数可用 `codex-governor <命令> --help` 查看。

## 会话控制模式

| 模式 | 模型与思考强度由谁决定 | 适合什么时候使用 |
| --- | --- | --- |
| `auto` | Governor 根据额度、优先级和策略选择 | 日常自动管理 |
| `manual` | 固定你指定的模型与思考强度，额度和优先级不会覆盖 | 连续多轮需要保持相同配置 |
| `off` | 使用原生客户端的设置；Governor 不再发送新输入 | 想在接入代理的 VS Code 中自行选模 |

```sh
codex-governor mode <任务ID> manual --model <模型ID> --effort <思考强度>
codex-governor mode <任务ID> off
codex-governor mode <任务ID> auto
```

Manual 必须同时指定模型和思考强度，并通过当前账号的模型列表校验。它会持续生效，直到你主动切换。模式修改只影响后续轮次，不中断正在执行的任务。TUI 中按 M 也可切换模式。

在已接入 Governor 的 VS Code 中，若要使用原生模型选择器，先切换到 `off`。桌面 App 和直接运行的 `codex resume` 不经过 Governor，始终使用各自的设置。Off 下显示的“当前”配置可能只是上次执行的记录。

`keep` 模式表示使用最新的主力配置。详细规则见[控制权与冲突说明](docs/session-control.md)。

## TUI 使用

主界面显示当前策略、5h/周额度和任务列表，按终端高度分页。每个任务分别展示：

```text
当前:   <主力配置的模型> · 思考强度: high
下一轮: <节省配置的模型> · 思考强度: medium
```

“当前”是提交给当前或上一轮的模型/effort，不是服务端实时回执证明。“下一轮”是最新策略结果。运行中的 turn 不会因自动降档而中途换模型。

| 按键 | 操作 |
| --- | --- |
| ↑ / ↓、Enter | 选择任务、滚动详情；打开详情或输入下一轮 |
| N、C | 新建任务；打开配置 |
| P、M、E | 调整优先级；切换控制模式；查看选模解释 |
| O | 在 App、VS Code 或两者中打开任务 |
| R | 立即刷新 |
| I、D | 中断任务；确认后删除本地记录 |
| Esc | 返回 |
| Q / Ctrl+C | 退出，并请求中断本会话正在执行的轮次 |

命令和文件修改审批支持“允许一次 / 拒绝”；用户问题支持文字回答。其他服务端请求类型会明确拒绝。

详情流式显示模型文本，仅保留最近一轮最多约 32,000 字符的尾部。完整会话由 Codex 保存。

## 在 Codex App 和 VS Code 中继续任务

首次任务在 Governor 中执行，**成功完成后**可自动打开同一个 Codex 会话：

```sh
codex-governor run --priority high --open both "写一份关于codex的PPT"

# 保存偏好；之后 run 不必再写 --open
codex-governor config --open-in both

# 打开已有任务，或只打印链接
codex-governor list
codex-governor open <任务ID> --target vscode
codex-governor open <任务ID> --target app
codex-governor open <任务ID> --target both --print
```

`--open none` 可覆盖自动打开偏好。运行中、状态不明或尚未提交输入的任务不会直接交接，以免两个客户端同时继续同一线程。自动打开失败时保留任务和结果，安装对应应用后再使用 `open`，不需要重新执行任务。`open --print` 只输出链接，不启动应用。

App 和 VS Code 必须使用同一台机器、同一份 Codex 本地会话存储（相同的 `CODEX_HOME`）。打开的是已经完成执行的会话，不是运行画面的实时镜像。请不要同时在两个客户端给同一会话发送新消息。

| 原生界面 | 查看历史并继续交互 | 后续每轮由 Governor 选模 |
| --- | --- | --- |
| VS Code 的 Codex 扩展 | 支持按线程打开 | 配置下面的实验性代理后支持受管理任务的 `turn/start` |
| Codex 桌面 App | 支持按线程打开 | **不支持**；新消息使用 App 自身的模型设置 |

### 在 VS Code 中继续让 Governor 自动选模

如果你用 Governor 创建任务后，希望在 VS Code 的 Codex 插件里继续聊天，并让 Governor 为后续消息选择模型，需要完成下面的一次性设置。

接入后，你仍然使用原来的 Codex 聊天界面。每次发送消息时，Governor 会按任务的控制模式处理选模：Auto 根据额度和优先级自动选择，Manual 使用固定配置，Off 交给 Codex 自己决定。

#### 1. 生成接入文件

先完成 Governor 的模型配置，再运行：

```sh
codex-governor integration vscode --codex /absolute/path/to/codex
```

把 `/absolute/path/to/codex` 替换为实际的 Codex 可执行文件路径。如果终端已经能运行 `codex`，可以用下面的命令查看路径：

```sh
command -v codex
```

建议优先使用当前 VS Code Codex 插件自带的可执行文件，减少版本不一致的问题。

#### 2. 把生成的设置填入 VS Code

命令会在 Governor 数据目录生成一个启动文件，并输出类似下面的设置：

```json
{
  "chatgpt.cliExecutable": "/absolute/path/to/codex-governor-ide"
}
```

在 VS Code 命令面板中：

1. 打开 **Preferences: Open User Settings (JSON)**。
2. 将命令实际输出的 `chatgpt.cliExecutable` 设置加入文件，保留其他设置。
3. 执行 **Developer: Reload Window**，重新加载窗口。

这一步需要手动完成，Governor 不会自动修改你的 VS Code 设置。

#### 3. 继续原来的任务

在 VS Code 中打开 Governor 创建的任务对应的 Codex 会话，继续发送消息即可。任务处于 **Auto** 模式时，Governor 会在每轮消息开始前，根据额度和优先级选择模型与思考强度。

这个接入只管理 Governor 创建的任务。你在 Codex 中另外新建的会话不会自动受到管理，图片、工具审批和安全设置仍由 Codex 处理。独立的代码审查等其他推理入口也不在管理范围内。

**界面的模型名称可能不会同步变化。**查看实际提交的模型与思考强度，请看 Codex 输出日志中的 `[Governor]` 行，或 Governor 的“当前”字段。

这是实验性功能，Codex 插件升级或 Governor 安装位置变化后，可能需要重新生成接入文件。想恢复原来的使用方式，删除 VS Code 设置中的 `chatgpt.cliExecutable`，再重新加载窗口即可。

源码安装用户需先运行 `npm run build`，再将上述命令中的 `codex-governor` 换成 `node dist/cli.js`。更多限制和验证范围见[原生接入说明](docs/native-integration.md)。

### Codex 桌面 App 可以这样接入吗？

目前不支持。你可以在 App 中打开 Governor 创建的会话、查看历史并继续聊天，但后续消息使用 App 自己的模型设置，Governor 无法覆盖。

如果希望后续消息持续由 Governor 自动选模，请在 Governor CLI/TUI 中继续任务，或使用上述 VS Code 实验性接入，并将任务设为 Auto 模式。

## 兼容性与 doctor

Governor 不要求某个固定版本的 Codex CLI，而是检查当前安装的版本是否提供所需接口。缺少关键能力时会明确报错；模型和思考强度通过 Codex App Server 设置，不靠读取或修改日志实现。已验证版本及测试范围见 [兼容性说明](docs/compatibility.md)。

安装或升级 Codex 后，先运行环境检查：

```sh
codex-governor doctor
```

默认检查覆盖 Node、Codex 路径、登录、额度、模型列表，以及创建会话和提交请求所需的接口能力。它不会执行真实推理，**检查通过不等于模型调用一定成功**。

需要验证真实调用时运行：

```sh
codex-governor doctor --live-turn
```

这会执行一轮只读、仅回复 OK 的调用，并消耗账号额度。CI 不执行此项，它也不衡量不同模型的额度节省比例。

<details>
<summary>额度不可用、断线与会话恢复</summary>

额度服务失败时 doctor 返回失败；已配置任务仍可在额度未知、保留已有约束的情况下工作。连接断开或写操作超时不会自动重试可能已接受的 turn；任务标记为 unknown，重新提交前恢复线程并检查是否仍有运行中的 turn。

尚未发送首条消息的线程可能还没有 Codex 持久化记录。重连时，Governor 会保留任务 ID，并只为确认从未提交过 turn 的任务重新创建空线程；对可能已提交过的任务，历史缺失会明确报错，不会自动重建或重放输入。

</details>

## 存储与隐私

默认路径为 `$XDG_CONFIG_HOME/codex-resource-governor` 或 `~/.config/codex-resource-governor`。可用 `CODEX_GOVERNOR_HOME` 指定独立存储目录，用 `CODEX_GOVERNOR_CODEX` 指定 Codex 可执行文件。

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
