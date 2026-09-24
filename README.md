# Codex Resource Governor

[简体中文](README.zh-CN.md)

When several Codex tasks are running, you may want to keep the strongest setup for a release fix while letting routine documentation work use less. Quota monitors show what remains, but deciding what each task should use for its next message usually means checking the limits and changing settings yourself.

Codex Resource Governor makes that decision just before a task's next turn. Set a Normal and an Economy model/effort pair, give each task a priority, and choose a Quality, Balanced, or Saver policy. Governor reads quota and available models through the Codex App Server, then chooses the pair **before each new user turn**. It never switches models during an active turn. Tools such as [Codex Usage Monitor](https://github.com/Corread8/codex-usage-monitor) and [Codex Monitor](https://github.com/manuelsh/codex-monitor) focus on viewing quota or understanding past usage; Governor focuses on the next managed turn. They can work together.

It is most useful when several managed sessions share tight quota. High priority keeps Normal; Normal and Low can reduce reasoning or move to Economy as quota tightens. You choose the Economy model yourself; Governor does not infer prices or promise a particular saving. For one occasional session with plenty of quota, using Codex directly is usually simpler.

This is an independent MIT-licensed project, not an OpenAI product. v0.1 is a local CLI/TUI that manages threads it creates. Codex still handles login, conversation history, tools, and approvals. Threads created separately in the desktop app, IDE, or another CLI are not enrolled automatically.

## Install

Before installing, have these ready:

- **Node.js 20 or newer** and its bundled npm; use a recent patch release.
- **A Codex executable that supports `app-server`**. Governor launches Codex; it does not install it. On macOS, it checks `PATH`, then the VS Code Codex extension and ChatGPT App bundles. On Linux/WSL2, put `codex` on `PATH`. To select an exact binary, set `CODEX_GOVERNOR_CODEX=/absolute/path/to/codex`.
- **A ChatGPT login in Codex**. Run `codex login` first. Governor reuses that login and does not need a separate API key. API-key-only accounts cannot use this ChatGPT quota policy.

If `codex` is not on `PATH`, set `CODEX_GOVERNOR_CODEX` to the actual executable path and run `"$CODEX_GOVERNOR_CODEX" login`. After installation, use `codex-governor doctor` (or `node dist/cli.js doctor` from source) to check the binary, login, and protocol support.

Governor targets macOS and Linux; use WSL2 on Windows. Allow memory for Codex itself: plan for at least 4 GB, with 8 GB more comfortable. npm installs Governor's JavaScript dependencies through `npm ci` or `npm install`; you do not need to install React, Ink, or the other packages separately.

Once the npm package is published, install globally with:

```sh
npm install -g codex-resource-governor
codex-governor doctor
codex-governor config
codex-governor
```

The initial setup asks for **English / 简体中文**, Normal model/effort, Economy model/effort, and policy. Choices come from your live `model/list` response. You select which model you consider economical: the catalog does not establish prices or guarantee savings. There is no interactive npm lifecycle hook; language selection happens during setup, so automated installs cannot hang.

To select Chinese during installation and setup:

```sh
npm install -g codex-resource-governor
codex-governor config --lang zh-CN
```

You can also install from GitHub source (Git is required):

```sh
git clone https://github.com/shuwei1006/codex-resource-governor.git
cd codex-resource-governor
npm ci
npm run build
node dist/cli.js doctor
node dist/cli.js config
```

With the source build, use `node dist/cli.js run "Task description"`. If you want the global `codex-governor` command, run `npm link` from the project directory. Contributors can run `npm test`. GitHub and npm are separate publishing destinations; the remote install commands above work only after the corresponding release is live.

## Commands

| Command | Purpose |
| --- | --- |
| `codex-governor` | Open the TUI (first launch offers setup) |
| `codex-governor doctor` | Probe environment, authentication, schema, and App Server methods |
| `codex-governor config` | Configure Normal / Economy / policy / language |
| `codex-governor run --priority high "Create a Mid-Autumn Festival greeting card"` | Automatically name, create, and execute a task |
| `codex-governor list [--json]` | Show task IDs and Codex thread IDs |
| `codex-governor open <id> --target app\|vscode\|both` | Open a completed task in native Codex clients |
| `codex-governor integration vscode --codex /path/to/codex` | Generate an experimental IDE policy proxy launcher and settings snippet |
| `codex-governor priority <id> high\|normal\|low` | Change task priority |
| `codex-governor mode <id> auto\|manual\|off` | Automatic, fixed, or native selection (legacy keep remains supported) |
| `codex-governor interrupt <id>` | Interrupt an active turn, including one started in another terminal |
| `codex-governor delete <id>` | Delete the local task record; interrupt an active turn first |
| `codex-governor policy quality\|balanced\|saver` | Change policy |
| `codex-governor explain <id>` | Explain the next-turn decision |

Task IDs can be unique prefixes. `run --cwd /path/to/project "Task description"` sets the task directory; otherwise it uses the current directory. Continue a task from its TUI details with Enter. `interrupt <id>` starts its own App Server session, resumes the stored thread, and requests interruption with the stored turn ID, so it works from another terminal. `delete <id>` removes only Governor's local record, not the Codex thread history; if the record is active, interruption must succeed before deletion. Ctrl+C/Q closes the session and requests interruption of its active turns.

Start real work with one sentence:

```sh
codex-governor run --priority high "Create a Mid-Autumn Festival greeting card"
```

Governor derives a display name locally, creates a Codex thread, selects the model/effort according to quota, priority and policy, then sends the complete prompt through `turn/start`. In an interactive terminal, the TUI opens the task details and execution starts automatically, without another Enter. With redirected output, the command waits for completion and prints the response; interactive requests are explicitly declined.

Naming uses local text rules: take the first sentence/line, simplify common request prefixes, and limit the label to 32 Unicode characters including any ellipsis. Naming does not call a model or shorten the input sent to Codex. Override the name when needed:

```sh
codex-governor run --name "Holiday card" --priority high "Create a Mid-Autumn Festival greeting card"
```

The existing `run --name "Title" --prompt "Task description"` syntax still works. Do not combine `--prompt` with a positional prompt. With only `run --name "Title"`, the previous interactive behavior is preserved: create the task and open its details to await input. Blank prompts are rejected before thread creation.

For unattended configuration, provide actual advertised identifiers:

```sh
codex-governor config \
  --normal-model MODEL_FROM_CATALOG --normal-effort EFFORT_FROM_CATALOG \
  --economy-model ECONOMY_FROM_CATALOG --economy-effort EFFORT_FROM_CATALOG \
  --policy balanced --lang en
```

Existing configuration can be updated with only the changed flags. `CODEX_GOVERNOR_LANG=en|zh-CN` sets the initial setup language. `--lang` overrides it.

## Typical use cases

Governor is most useful when several Codex sessions share a limited account quota. It does not schedule work in the background; each task is a separate Codex thread that you start and continue explicitly. A **turn** begins when one user message is submitted and ends when that response completes, fails, or is interrupted. Tool calls, shell commands, and file edits made while handling that message remain part of the same turn. The selected model and reasoning effort stay fixed during an active turn, and Governor evaluates the next selection immediately before the next turn starts.

### Protect an important task while several sessions run

Keep a release fix on the Normal configuration while allowing routine work to reduce reasoning or use Economy as quota tightens:

```sh
codex-governor run --priority high "Fix the release-blocking authentication regression"
codex-governor run --priority normal "Add tests for the settings page"
codex-governor run --priority low "Summarize these archived design notes"
```

High priority always uses the configured Normal model/effort in Auto mode. Normal and Low tasks follow the selected quota policy. This is the clearest fit for Governor: concurrent sessions, different business importance, and limited quota.

### Start a long deliverable at full quality, then economize on revisions

A slide deck, report, website, or refactor often needs the strongest configuration for its first complete draft, while later edits can follow quota pressure:

```sh
codex-governor run --priority high "Create the first complete draft of the product launch deck"
# After the first turn completes:
codex-governor priority <id> normal
```

The first turn remains on Normal for its entire execution. Before each later request, such as “revise slide 3” or “check the exported file,” Governor refreshes quota and chooses Normal, lower reasoning, or Economy. It never changes models halfway through generating the deck.

### Run routine or batch work conservatively

Use Low priority with the Saver policy for tasks where throughput matters more than maximum reasoning quality:

```sh
codex-governor policy saver
codex-governor run --priority low "Normalize formatting across the documentation"
codex-governor run --priority low "Summarize completed test logs"
```

Saver begins tightening earlier than Balanced or Quality. The actual Economy model is the one you selected during configuration; Governor does not infer model price or cost.

### Pin a known model for a sensitive sequence of turns

Manual mode is useful for a review, migration, or reproducibility check that must keep one validated model/effort pair regardless of quota and priority:

```sh
codex-governor mode <id> manual --model MODEL_ID --effort high
```

The pair remains fixed until the mode is explicitly changed. Switch back with `codex-governor mode <id> auto`.

### Temporarily return control to the native client

If a managed VS Code thread needs a one-off choice from the native model selector, turn governance off first:

```sh
codex-governor mode <id> off
```

The IDE proxy then preserves the native `turn/start` selection. Switch to Auto to resume quota-aware selection. Codex desktop App and plain `codex resume` messages remain outside Governor interception.

Governor adds less value for a single occasional session with ample quota, or when all interaction stays in the Codex desktop App. In those cases, the native Codex experience is usually simpler.

## Session control

Auto uses Governor policy. Manual fixes an explicit validated model/effort pair until changed, overriding quota and priority. Off passes native IDE requests unchanged and disables Governor prompt dispatch. Legacy Keep follows the latest Normal configuration.

```sh
codex-governor mode <id> manual --model MODEL_ID --effort EFFORT
codex-governor mode <id> off
codex-governor mode <id> auto
```

Changes affect future turn reservations, not active execution. Invalid manual pairs retain the previous mode. Current records the last acknowledged selection and mode; off-mode native history may be stale. Use TUI M for the manual model/effort picker. Explicitly choose off to honor the native selector; different incoming fields are not proof of a manual user action. App/plain CLI traffic remains outside the proxy in every mode. See [session control and conflict rules](docs/session-control.md).

## Continue in native Codex clients

Open the same conversation automatically **after the Governor turn completes successfully**:

```sh
codex-governor run --open both --priority high "Create a Mid-Autumn Festival greeting card"
codex-governor config --open-in both
codex-governor list
codex-governor open <id> --target vscode
codex-governor open <id> --target app
codex-governor open <id> --target both --print
```

The saved `--open-in` preference applies to subsequent `run` commands; `--open none` overrides it. Running, uncertain, and never-submitted threads cannot be handed off. Failed application launches retain the task and result; retry `open` instead of rerunning the prompt. `--print` prints links without opening applications. The TUI's **O** key offers the same destinations.

Governor attempts to synchronize task titles using `thread/name/set`. It prints both IDs; the native links use the **Codex thread UUID**, not the Governor task ID. App uses the documented `codex://threads/<id>` link; VS Code uses the installed extension's version-dependent `vscode://openai.chatgpt/local/<id>` route. Both clients must share the same local Codex storage (`CODEX_HOME`). This is a completed-turn handoff, not a live view of another process or cloud synchronization.

| Client | Open history and continue | Governor selection on later turns |
| --- | --- | --- |
| VS Code Codex extension | Thread deep link | Managed `turn/start` calls only, after installing the experimental proxy below |
| Codex desktop App | Thread deep link | **Not supported**; messages use App settings |

No public desktop per-turn selection interception interface has been established. Opening a deep link does not enable one. Use one client at a time to continue a thread. A plain `codex resume` also bypasses Governor.

To retain governance in VS Code, build and generate a launcher:

```sh
npm run build
node dist/cli.js integration vscode --codex "$(command -v codex)"
```

Merge the printed `chatgpt.cliExecutable` setting into **Preferences: Open User Settings (JSON)**, retaining other settings, then run **Developer: Reload Window**. The command generates a launcher in Governor's private data directory and does not edit VS Code settings. Prefer the extension's bundled real Codex executable for `--codex` to avoid version mismatches. This official setting is development-only and can break across extension upgrades; regenerate the launcher after upgrades or moving the project. Remove the setting and reload to undo.

For managed threads, the proxy refreshes models, quota, and configuration before each `turn/start`, applies model/effort (including collaboration-mode overrides), and records the result in Governor state. Native prompts, images, approvals, security settings, and notifications are preserved. Unmanaged threads pass through unchanged. Independent review and other inference entry points are outside this interception scope. `[Governor]` entries in Codex output logs report the actual selection; the native model selector may still show its own choice. See [native integration details and verification limits](docs/native-integration.md).

## TUI

```text
CODEX RESOURCE GOVERNOR
Policy: balanced
5h      63% remaining
Weekly  18% remaining

TASKS
› Research HIGH · auto · running
  Current:   <normal model> · high
  Next turn: <normal model> · high
  NORMAL

  Slides NORMAL · auto · running
  Current:   <normal model> · high
  Next turn: <normal model> · medium
  REASONING REDUCED

Enter Details/Prompt  P Priority  M Mode  O Open Codex
E Explain  C Config  N New  R Refresh  I Interrupt  D Delete  Q Quit
```

The screen pages tasks to fit the terminal. Arrow keys navigate tasks and scroll details/explanations. Esc goes back. D opens a confirmation before deleting the selected local record. Details show streamed text; only the latest turn's bounded text tail is retained locally. Codex owns the full thread history. Command/file-change approval prompts support **Allow once / Deny**. User-input questions accept a text answer. Other server-initiated request types are explicitly rejected in v0.1. Pending requests take priority over task navigation.

**Current** is the model/effort submitted for the current or last turn, not a live server-side attestation. **Next turn** is the latest policy selection. Changes never interrupt a running turn to switch its model. Only an explicit interrupt action or closing the session requests cancellation.

## Policy

These thresholds are **project defaults, not official OpenAI rules**. Boundaries are strict `<`, not `<=`.

| Policy | Reduce Normal/Low reasoning one supported level | Switch to Economy |
| --- | --- | --- |
| quality | Below 10% | Below 5%, Low only |
| balanced (default) | Below 20% | Below 10%, Normal/Low |
| saver | Below 40% | Below 20%, Normal/Low |

High priority in Auto mode and legacy Keep mode select the Normal configuration; Manual/Off take precedence. For Auto tasks, the effective remaining percentage is the minimum of the valid 5h and weekly windows. Windows are recognized by their duration (300 / 10080 minutes), never by their position in the response. The global `codex` bucket is preferred; other model-specific buckets are not treated as global quota. Unknown durations, invalid percentages, expired snapshots, and absent data are unavailable, not zero.

Within each window's quota cycle, automatic selections can only tighten:

```text
Normal → Lower Reasoning → Economy
```

Each task stores a separate hold for each quota window. A hold resets only after that window's previous reset time has passed **and** a fresh observation reports a later reset time. Resetting the 5h window cannot release a weekly hold. Missing data/reset times retain existing holds and never create a new downgrade. High/Keep temporarily bypass holds; switching back to Auto can reapply them. Policy/config changes affect future turns but do not erase cycle holds. A user-selected configuration can of course change the actual model/effort.

Known reasoning levels are ordered semantically, but only supported values from `model/list` can be selected. Unknown future effort names and models already at their lowest supported level keep their effort instead of guessing. Reducing effort does not compound on every poll.

Quota is refreshed every 30 seconds, on account notifications, and before each turn. TUI sessions observe changes made by other CLI processes on their next refresh; press R for an immediate refresh. Concurrent starts for the same task are blocked with an atomic reservation.

## Compatibility and doctor

The requested v0.1 target baseline is Codex CLI **0.154.0**. Development also checks the locally installed version; see [compatibility evidence](docs/compatibility.md). There is **no version-number gate**. The runtime generates the installed CLI's schema and probes capabilities. A missing required field/method or a non-ChatGPT account fails clearly. Governor never edits or scrapes Codex logs to simulate control.

Default `doctor` checks Node, binary/version, installed schema, stdio handshake, `account/read`, quota, all `model/list` pages, and an ephemeral `thread/start`. It verifies `turn/start` dispatch with an intentionally nonexistent thread and validates that both override fields exist in the generated schema. This proves protocol support, **not successful inference or quota availability**.

```sh
codex-governor doctor --live-turn
```

This additionally submits a real read-only “OK” request and waits for completion. It consumes account quota and is never used in CI. It cannot demonstrate relative quota savings between models.

If the quota service is temporarily unavailable, `doctor` reports failure. Already configured task management can continue with unknown quota and retained holds. If the App Server disconnects or a mutation times out, Governor does not retry a potentially accepted turn automatically. The task is marked unknown; its thread is resumed and checked before another turn is submitted.

## Storage and privacy

- Default: `$XDG_CONFIG_HOME/codex-resource-governor`, or `~/.config/codex-resource-governor`.
- `CODEX_GOVERNOR_HOME` overrides the directory; `CODEX_GOVERNOR_CODEX` explicitly selects the Codex executable.
- Without an override, Governor checks `PATH`, then the newest installed VS Code/OpenAI extension on macOS, then the ChatGPT App bundle. This allows commands from a second terminal even when `codex` was not installed globally.
- Run `codex-governor config --path` to print the exact configuration path, or `codex-governor config --show` to print the saved configuration. These inspection commands do not connect to Codex.
- `config.json` and `state.json` are schema-validated, written through fsync + atomic rename, and owner-readable/writable only on supported POSIX systems. A short filesystem lock serializes updates.
- State contains managed thread IDs, task names/directories, priority/mode, quota-cycle holds, submitted configuration, and the most recent response tail. Prompts are not copied to Governor storage; Codex persists its own conversations.
- No Governor backend, database, telemetry, login flow, or credential store. Credentials remain with Codex. Governor's own child App Server disables analytics and OpenTelemetry exporters. The experimental IDE proxy preserves the native client's launch options and telemetry configuration. Codex still contacts its required services.
- New/resumed tasks use workspace-write sandboxing with on-request approval. Do not run untrusted tasks in a sensitive project directory.

## Development and release

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

Tests run against isolated JSON directories and a deterministic fake stdio App Server; they do not read your Codex account. GitHub Actions covers Node 20/22 on Ubuntu/macOS without ChatGPT credentials. Local verification does not imply that this remote matrix has already run.

See [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [architecture](docs/architecture.md), and the [release checklist](docs/releasing.md). This MVP intentionally omits background scheduling, arbitrary thread import, automatic price inference, web UI, and quota prediction.

Protocol reference: [official Codex App Server documentation](https://developers.openai.com/codex/app-server). Wire fields are checked against schemas generated by the installed CLI.

An unused thread may not yet have a Codex rollout on disk. After reconnecting, Governor can recreate that empty thread while keeping your task ID. Once any turn may have been submitted, missing thread history is an explicit error; Governor will not recreate it or replay input automatically.
