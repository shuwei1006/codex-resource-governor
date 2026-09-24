# Codex Resource Governor

[简体中文](README.zh-CN.md)

Codex quota can run out while you're still working. When several tasks run at once, you want to save it for the work that matters most: fixing code may need a stronger model, while tidying documentation may not. Most quota monitors show what remains, but choosing and adjusting the model for each task's next message is still up to you.

Codex Resource Governor makes that decision before a task's next turn. Set a Primary and an Economy model/effort pair, give each task a priority, and choose a Quality First, Balanced, or Save Quota policy. Governor reads quota and available models through Codex App Server, then chooses the configuration **before each new user turn**. It never switches models during an active turn. Tools such as [Codex Usage Monitor](https://github.com/Corread8/codex-usage-monitor) and [Codex Monitor](https://github.com/manuelsh/codex-monitor) focus on viewing quota or reviewing usage; Governor focuses on allocating the remaining quota according to task priority.

It is most useful when several managed sessions run at once and quota starts getting tight. High priority keeps Primary; Medium and Low can reduce reasoning effort or move to Economy as quota tightens. You choose the Economy model yourself; Governor does not infer prices from model names or promise a fixed saving. If you usually run a single session and never worry about quota, this project may not be useful to you.

This is an independent MIT-licensed project. It provides a local CLI/TUI and manages only the tasks it creates. Codex still handles login, conversation history, tool calls, and approvals. Given the available integration interfaces, sessions created separately in the Codex desktop App, IDE, or another CLI are not enrolled automatically.

[Install](#install-and-setup) · [Quick start](#quick-start) · [Use cases](#typical-use-cases) · [Policy](#policy-and-quota) · [Session control](#session-control) · [Commands](#command-reference) · [Environment checks](#compatibility-and-doctor)

## Four settings with different roles

| Setting | Display names | What it controls |
| --- | --- | --- |
| Model Profile | Primary / Economy | Two model and reasoning-effort pairs |
| Task Priority | High / Medium / Low | Which tasks retain the Primary profile |
| Quota Policy | Quality First / Balanced / Save Quota | When and for which tasks quota triggers a downgrade |
| Reasoning Effort | The model's supported values, such as `high`, `medium`, or `low` | The reasoning level for an individual turn |

For example, a task with High priority uses the Primary profile, which could be model A with `medium` reasoning effort. High task priority does not require `high` reasoning effort.

## Install and setup

### Requirements

Before installing, have these ready:

- **Node.js 20 or newer** and its bundled npm; use a recent patch release.
- **A Codex executable that supports `app-server`**. Governor launches Codex; it does not install it. On macOS, it checks `PATH`, then the VS Code Codex extension and ChatGPT App bundles. On Linux/WSL2, put `codex` on `PATH`. To select an exact binary, set `CODEX_GOVERNOR_CODEX=/absolute/path/to/codex`.
- **A ChatGPT login in Codex**. Run `codex login` first. Governor reuses that login and does not need a separate API key. API-key-only accounts cannot use this ChatGPT quota management.

If your terminal cannot find `codex`, set `CODEX_GOVERNOR_CODEX` to the actual executable path and run `"$CODEX_GOVERNOR_CODEX" login`. After installation, use `codex-governor doctor` (or `node dist/cli.js doctor` from source) to check the binary, login, and protocol support.

Governor targets macOS and Linux; use WSL2 on Windows. Allow memory for Codex itself: plan for at least 4 GB, with 8 GB more comfortable. npm installs Governor's JavaScript dependencies through `npm ci` or `npm install`; you do not need to install React, Ink, or other packages separately.

### Install from npm

Install the package from [npm](https://www.npmjs.com/package/codex-resource-governor). To use the commands documented on this branch, use the source installation below until the npm package is synchronized.

```sh
npm install -g codex-resource-governor
codex-governor doctor
codex-governor config
codex-governor
```

### First-time setup

The setup wizard asks for English / 简体中文, the Primary model and reasoning effort, the Economy model and reasoning effort, and a policy. Available choices come from your account's `model/list` response. You choose the Economy model yourself.

Language selection happens after installation, during setup. npm lifecycle hooks do not prompt for input, so automated installs will not wait for a response. The default language is English; use `CODEX_GOVERNOR_LANG=zh-CN` or `codex-governor config --lang zh-CN` for Chinese. `--lang` takes precedence.

<details>
<summary>Install from source (for development or local changes)</summary>

You can also install from GitHub source. Git is required:

```sh
git clone https://github.com/shuwei1006/codex-resource-governor.git
cd codex-resource-governor
npm ci
npm run build
node dist/cli.js doctor
node dist/cli.js config
```

With the source build, use `node dist/cli.js run "Task description"`. To use the global `codex-governor` command, run `npm link` from the project directory. Contributors can run `npm test`.

</details>

<details>
<summary>Non-interactive configuration for scripts</summary>

Use `--primary-model`, `--primary-effort`, `--economy-model`, `--economy-effort`, `--policy`, and `--lang`. Initial setup requires the complete model configuration; later updates need only the fields you want to change. Model IDs and reasoning levels must be supported by your account.

</details>

## Quick start

Create and run a task with one sentence:

```sh
codex-governor run --priority high "Create a PPT about Codex"
```

Governor derives a display name locally, creates a Codex thread, selects the model and reasoning effort according to quota, priority, and policy, then sends the complete prompt through `turn/start`. In an interactive terminal, the TUI opens the task details and execution starts automatically, without another Enter. With redirected output, the command waits for completion and prints the response; interactive approval requests are explicitly declined.

<details>
<summary>Custom task names and other run options</summary>

Naming uses local text rules: take the first sentence or line, simplify common request prefixes, and limit the label to 32 Unicode characters, including any ellipsis. Naming does not call a model or shorten the input sent to Codex. You can also specify the name:

```sh
codex-governor run --name "Codex PPT" --priority high "Create a PPT about Codex"
```

The existing `run --name "Title" --prompt "Task description"` syntax still works. Do not combine `--prompt` with a positional prompt. With only `run --name "Title"`, Governor creates the task and opens its details to await input. Blank prompts are rejected before thread creation.

</details>

### Continue, interrupt, and delete tasks

Tasks run in the current directory by default; use `--cwd /path/to/project` to select another directory. In the TUI, open a task's details and press Enter to enter a follow-up request.

```sh
codex-governor list
codex-governor interrupt <id>
codex-governor delete <id>
```

`list` shows both Governor task IDs and Codex thread IDs. Use the Governor task ID for `<id>`; unambiguous prefixes also work. You can run `interrupt` from another terminal. `delete` removes only Governor's local record, preserving the Codex conversation history. A running task must be successfully interrupted before its record can be deleted.

### What counts as a turn?

A **turn** starts when one user message is submitted and ends when that response completes, fails, or is interrupted. Tool calls, shell commands, and file edits made while handling the message belong to that same turn. The model and reasoning effort stay fixed during execution; Governor evaluates the next selection before the next turn starts.

## Typical use cases

These examples use automatic control. To run tasks concurrently, start them in separate terminals; Governor does not create a background task queue.

### Work on frontend, backend, and UX in parallel

When updating a login flow, open three sessions: one for the frontend, one for the backend, and one for UX copy. If the backend login failure is the most urgent issue, assign it High priority, the frontend Medium priority, and the UX copy changes Low priority. Run each command in a separate terminal:

```sh
# Terminal 1: Frontend
codex-governor run --priority medium "Update the frontend login page with a submitting state and API error display"

# Terminal 2: Backend
codex-governor run --priority high "Fix the authentication error in the backend login endpoint and add regression tests"

# Terminal 3: UX
codex-governor run --priority low "Improve the login flow's user-facing messages and record the recommendations in the UX document"
```

In Auto mode, the backend session keeps the Primary profile. Before each turn, the frontend and UX sessions may reduce reasoning effort or switch to Economy based on quota and policy. Priorities reflect the urgency of this particular change; they are not fixed by discipline. Each session runs its own task. Governor selects models but does not coordinate dependencies between sessions.

### Use Primary for the first draft, then adjust revisions to quota

A slide deck, report, website, or large refactor often needs a strong first draft, while smaller follow-up edits can use a configuration suited to the remaining quota:

```sh
codex-governor run --priority high "Create the first complete draft of the product launch deck"
# After the first turn completes:
codex-governor priority <id> medium
```

The first turn stays on Primary throughout. Before each later request, such as “revise slide 3” or “check the exported file,” Governor refreshes quota and chooses Primary, lower reasoning, or Economy. It never switches models halfway through making the deck.

### Use a more conservative policy for routine tasks

Use Low priority with Save Quota for tasks where throughput matters more than maximum reasoning quality:

```sh
codex-governor policy save-quota
codex-governor run --priority low "Normalize formatting across the documentation"
codex-governor run --priority low "Summarize completed test logs"
```

Save Quota starts reducing the configuration earlier than Balanced or Quality First. The Economy model is the one you select during setup; Governor does not infer model prices or costs.

## Policy and quota

Inspect the saved configuration, switch policy, or explain a task's next-turn selection:

```sh
codex-governor config --show
codex-governor policy balanced
codex-governor explain <id>
```

Primary and Economy are your two configured model/effort pairs; `high`, `medium`, and `low` are task priorities. In Auto mode, High uses Primary, while Medium and Low follow the table below. See [session control](#session-control) for Manual and Off.

These thresholds are **project defaults, not official OpenAI rules**. All boundaries use strict “less than.”

| Quota Policy | Reduce Medium/Low reasoning by one supported level | Switch to Economy |
| --- | --- | --- |
| Quality First (`quality-first`) | Below 10% remaining | Below 5%, Low only |
| Balanced (`balanced`, default) | Below 20% remaining | Below 10%, Medium/Low |
| Save Quota (`save-quota`) | Below 40% remaining | Below 20%, Medium/Low |

When both 5-hour and weekly quota windows are available, Governor uses the lower remaining percentage. Within a quota cycle, automatic selection can only stay at its current level or step down; the corresponding restriction is released after that window resets. If quota is temporarily unavailable, existing restrictions remain in place. Unknown quota is not treated as zero.

Quota refreshes every 30 seconds, when updates arrive, and before each turn. Press R in the TUI to refresh immediately, including settings changed from another terminal.

<details>
<summary>Quota windows, downgrades, and reset rules</summary>

High priority in Auto mode and Keep mode use Primary; Manual and Off take precedence. Effective quota is the minimum remaining percentage across valid 5-hour and weekly windows. Windows are identified by duration (300 / 10080 minutes); `primary` is not assumed to mean 5 hours. Governor prefers the global `codex` bucket and does not treat model-specific quota as global. Unknown durations, expired snapshots, invalid percentages, and missing data are unavailable, not zero.

Within a cycle, automatic selection only moves from `Primary → Lower Reasoning → Economy`. Each task records separate restrictions for the two windows. A window's restriction is released only after its old reset time has passed and a fresh, valid snapshot reports a later reset time. A 5-hour reset does not release a weekly restriction. Missing quota or reset times retain existing restrictions without adding a new downgrade.

High and Keep temporarily bypass cycle restrictions; switching back to Auto can reapply them. Changing policy or configuration does not clear cycle records, although explicitly configuring another model/effort pair affects future selections. Reasoning drops by only one supported level, not another level on every refresh. Unknown future reasoning levels, or models with no lower supported level, keep their current setting.

An atomic reservation prevents duplicate starts for the same task.

</details>

## Command reference

| Command | Purpose |
| --- | --- |
| `codex-governor` | Open the TUI; first launch offers setup |
| `codex-governor doctor` | Check the environment, login, schema, and App Server capabilities |
| `codex-governor config` | Configure Primary / Economy model profiles, Quota Policy, and language |
| `codex-governor run --priority high "Create a PPT about Codex"` | Automatically name, create, and execute a task |
| `codex-governor list [--json]` | Show task IDs and Codex thread IDs |
| `codex-governor open <id> --target app\|vscode\|both` | Open a completed task in native Codex clients |
| `codex-governor integration vscode --codex /path/to/codex` | Generate the files and settings instructions to connect VS Code to Governor, so it can select models for follow-up messages in Governor-created tasks. This integration may change with Codex extension updates. |
| `codex-governor priority <id> high\|medium\|low` | Change task priority |
| `codex-governor mode <id> auto\|manual\|off` | Automatic, fixed, or native selection; keep uses the Primary profile. See session control below. |
| `codex-governor interrupt <id>` | Interrupt an active turn, including from another terminal |
| `codex-governor delete <id>` | Delete the local task record; interrupt a running turn first |
| `codex-governor policy quality-first\|balanced\|save-quota` | Switch policy |
| `codex-governor explain <id>` | Explain the next-turn selection |

Use `codex-governor <command> --help` for more options.

## Session control

| Mode | Who chooses the model and reasoning effort? | When to use it |
| --- | --- | --- |
| `auto` | Governor follows quota, priority, and policy | Everyday automatic management |
| `manual` | Your explicit pair stays fixed regardless of quota and priority | Several turns need the same configuration |
| `off` | The native client uses its settings; Governor stops sending new prompts | Choose models yourself in VS Code with the proxy configured |

```sh
codex-governor mode <id> manual --model MODEL_ID --effort EFFORT
codex-governor mode <id> off
codex-governor mode <id> auto
```

Manual requires both a model and a reasoning level supported by your account. It remains active until you switch modes. Changes affect future turns and do not interrupt active work. Press M in the TUI to change modes.

To use the native model selector in VS Code connected to Governor, switch the task to `off` first. The desktop App and plain `codex resume` bypass Governor and always use their own settings. In Off mode, “Current” may only describe the last managed turn.

`keep` uses the latest Primary configuration. See [session control and conflict rules](docs/session-control.md) for details.

## Using the TUI

The main screen shows the current policy, 5-hour/weekly quota, and a task list paginated to fit the terminal. Each task shows:

```text
Current:   <Primary model> · Reasoning Effort: high
Next turn: <Economy model> · Reasoning Effort: medium
```

“Current” is the model/effort submitted for the current or last turn, not a live server-side attestation. “Next turn” is the latest policy selection. Automatic downgrades never switch the model of an active turn.

| Key | Action |
| --- | --- |
| ↑ / ↓, Enter | Select tasks or scroll details; open details or enter a follow-up |
| N, C | Create a task; open configuration |
| P, M, E | Change priority; switch control mode; explain the selection |
| O | Open the task in the App, VS Code, or both |
| R | Refresh immediately |
| I, D | Interrupt the task; confirm deletion of its local record |
| Esc | Go back |
| Q / Ctrl+C | Exit and request interruption of turns running in this session |

Command and file-change approvals support “Allow once / Deny”; user questions accept text answers. Other server-initiated request types are explicitly declined.

Task details stream model output and retain only the latest turn's tail, up to about 32,000 characters. Codex stores the full conversation.

## Continue tasks in Codex App and VS Code

A task runs in Governor first. **After that turn completes successfully**, it can open the same Codex conversation automatically:

```sh
codex-governor run --priority high --open both "Create a PPT about Codex"

# Save the preference for later run commands:
codex-governor config --open-in both

# Open an existing task, or print its links:
codex-governor list
codex-governor open <id> --target vscode
codex-governor open <id> --target app
codex-governor open <id> --target both --print
```

`--open none` overrides the saved preference. Running, uncertain, or never-submitted tasks cannot be handed off, to avoid two clients continuing the same thread at once. Failed application launches retain the task and result; install the relevant app and retry `open` without rerunning the task. `open --print` prints links without opening applications.

The App and VS Code must run on the same machine and use the same local Codex conversation storage (`CODEX_HOME`). This opens a conversation after execution has completed; it is not a live mirror of another process. Do not send messages to the same thread from both clients at once.

| Client | Open history and continue | Governor selection on later turns |
| --- | --- | --- |
| VS Code Codex extension | Open by thread | Managed `turn/start` calls, after configuring the experimental proxy below |
| Codex desktop App | Open by thread | **Not supported**; new messages use App settings |

### Keep automatic selection in VS Code

This integration is experimental. Complete Governor's model configuration first, then generate the integration files:

```sh
codex-governor integration vscode --codex /absolute/path/to/codex
```

Replace the path with your actual Codex executable. If `codex` is on `PATH`, use `command -v codex` to find it. Prefer the executable bundled with your current VS Code extension to reduce version mismatches.

The command generates a launcher in Governor's data directory and prints JSON like this. **It does not edit VS Code settings automatically**:

```json
{
  "chatgpt.cliExecutable": "/absolute/path/to/codex-governor-ide"
}
```

Add the setting printed by your command to VS Code's **Preferences: Open User Settings (JSON)**, retaining other settings. Then run **Developer: Reload Window**.

When you continue a Governor-created task in VS Code, subsequent messages follow that task's control mode for model and reasoning selection. Other native sessions are not enrolled automatically. The native client still handles input, images, approvals, and security settings.

The native model selector may continue to show its own choice. Check the `[Governor]` lines in Codex output logs and Governor's “Current” field for the configuration actually submitted. Independent reviews and other inference entry points are outside this integration's scope.

The setting may change with extension updates. Regenerate the integration files and check them after upgrades or moving the Governor installation. To restore the default setup, remove `chatgpt.cliExecutable` and reload the window.

For source installs, run `npm run build` first and replace `codex-governor` above with `node dist/cli.js`. See [native integration details](docs/native-integration.md) for interface references, launcher limitations, and verification scope.

## Compatibility and doctor

Governor does not require a fixed Codex CLI version. It checks whether the installed version provides the required App Server capabilities and reports missing fields or methods clearly. Model and reasoning settings are submitted through Codex App Server, not by reading or editing logs. See [compatibility evidence](docs/compatibility.md) for tested versions and scope.

After installing or upgrading Codex, run the environment check:

```sh
codex-governor doctor
```

The default check covers Node, the Codex path, login, quota, the model catalog, and the interfaces needed to create a conversation and submit requests. It does not run real inference: **passing these checks does not guarantee a successful model call**.

To verify a real call:

```sh
codex-governor doctor --live-turn
```

This runs one read-only request to reply “OK” and consumes account quota. CI does not run it, and it does not measure quota savings between models.

<details>
<summary>Unavailable quota, disconnections, and conversation recovery</summary>

A quota service failure causes doctor to fail. Configured tasks can still work with unknown quota while retaining existing cycle restrictions. A disconnected or timed-out write is not automatically retried if the turn may already have been accepted. The task is marked `unknown`; resume the thread and check for an active turn before submitting again.

A thread that has never received a message may not yet have persisted Codex history. On reconnect, Governor can recreate a thread confirmed to be unused while retaining your task ID. If a turn may have been submitted, missing history produces an explicit error; Governor will not recreate the thread or replay input automatically.

</details>

## Storage and privacy

The default directory is `$XDG_CONFIG_HOME/codex-resource-governor`, or `~/.config/codex-resource-governor`. Use `CODEX_GOVERNOR_HOME` for a separate storage directory and `CODEX_GOVERNOR_CODEX` for an explicit Codex executable.

Run `codex-governor config --path` for the exact configuration file path, or `codex-governor config --show` to inspect saved settings. Neither command connects to Codex.

Configuration and state are schema-validated JSON, written using fsync, atomic rename, and a short file lock. Files have owner-only permissions (0600) on POSIX systems. State includes task names and directories, thread IDs, priority and mode, cycle restrictions, submitted model configuration, and the latest response tail. Governor does not store an extra copy of user prompts; Codex stores conversations through its own mechanisms.

Governor has no backend, database, telemetry, or credential store; it reuses Codex login. Its own App Server subprocess disables analytics and OpenTelemetry exporters. The experimental IDE proxy retains the native client's launch options and telemetry configuration. Codex still contacts its required services. Governor-created tasks use workspace-write sandboxing with on-request approval; later IDE messages retain the native client's security settings.

## Development and release

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

Tests use temporary JSON directories and a simulated stdio server without reading ChatGPT credentials. GitHub Actions is configured for Node 20/22 on Ubuntu/macOS; passing locally does not establish that the remote matrix has run.

See [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [architecture](docs/architecture.md), and the [release checklist](docs/releasing.md) for contribution, vulnerability reporting, implementation, and publishing details. The MVP does not include background scheduling, external thread takeover, price inference, a web UI, or quota prediction.

Protocol references: the [official Codex App Server documentation](https://developers.openai.com/codex/app-server) and schemas generated by the installed CLI.
