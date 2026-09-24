# Native Codex integration

## Scope

`run --open app|vscode|both` opens the existing local thread after the initial turn succeeds. `config --open-in` persists the preference; `open <id>` handles existing records. Open failures do not replay model input. `list --json` provides the mapping between Governor IDs and Codex UUIDs. `open --print` needs neither a GUI nor an App Server connection.

App can display and continue the conversation using a documented deep link. Desktop continuation is **not governed**: neither deep links nor documented UserPromptSubmit hook outputs provide model/effort overrides. No App binary modification, credential interception, database editing, or polling rewrite of global model settings is used.

The VS Code route was inspected in installed `openai.chatgpt` version `26.5917.62051` (`registerUriHandler`, `/local/:conversationId`). It is a version-dependent extension route, not a stable OpenAI public API. OS acceptance of a link does not prove the target extension successfully rendered it. Both clients must resolve the same local `CODEX_HOME`; remote/WSL hosts are not automatically bridged.

## Experimental IDE middleware

`integration vscode --codex <real-binary>` generates a private executable launcher with absolute Node, proxy, storage and binary paths. It prints the `chatgpt.cliExecutable` user setting. It does not change global editor settings or reload a running editor. The launcher supports macOS/Linux; a WSL extension requires a launcher within that WSL environment.

The proxy preserves the native initialize payload, including experimental capabilities, and routes bidirectional JSONL through a real stdio App Server. Client request IDs are correlated separately from server requests and internal quota/model reads. It forwards native server-request replies, including refusals/errors, without granting approvals itself. Non-server CLI invocations (such as version/schema checks) delegate to the real executable. Recursion and non-stdio listeners are rejected.

For a registered thread's `turn/start`, the proxy:

Control modes now qualify this flow: off forwards the native request unchanged without quota/config reads; manual validates and enforces the fixed pair without quota selection; auto/legacy keep use policy selection. Control revision changes during preflight reject stale dispatch. See [session control](session-control.md).

1. Reads current Governor configuration and validates the ChatGPT account and live catalog.
2. Reads quota; protocol-level quota unavailability retains existing cycle holds.
3. Reserves the task with an atomic state update; a live owner prevents duplicate starts.
4. Sets top-level `model`/`effort` and, when present, collaboration settings `model`/`reasoning_effort`.
5. Preserves all other native parameters, input items, approvals and notifications.
6. Records acknowledged selection and turn ID; completion writes the bounded output tail.

Fast completion events are serialized behind the start acknowledgement. Disconnects and uncertain submissions are marked unknown without replay. Deleted task records are never recreated by late events. Unmanaged conversations are forwarded without quota/config reads. Deleting a Governor record also opts its thread out of IDE governance. Native review operations, subagent choices, and other inference methods are outside `turn/start` interception.

The proxy honors the native client's telemetry/launch flags; Governor itself adds no telemetry. Native code/tool execution uses the native client's security settings. This experimental setting overrides a bundled executable and can become incompatible with extension updates. Prefer the extension's bundled executable, validate after upgrades, and remove `chatgpt.cliExecutable` to restore the default path.

## Validation and remaining manual checks

Automated tests use a real proxy process with a fake Codex subprocess to exercise handshake capabilities, request/response correlation, approval refusal round trips, error data, immediate completion events, persisted state, and model overrides. Unit tests verify full input preservation, collaboration-mode precedence, priority changes, active-turn guards, link construction, and partial opener failure.

These tests do not prove live desktop rendering or a real IDE follow-up inference.

Local smoke evidence (2026-09-24, macOS): a generated launcher with spaces and an apostrophe in its path delegated `--version` to the extension-bundled `codex-cli 0.155.0-alpha.16.3`, completed a real initialization with experimental capabilities, and returned `model/list` successfully through the proxy. No thread was created and no inference was submitted. The initial sandboxed attempt could not initialize Codex's state database; the permitted retry completed successfully.

Before release, in a disposable project:

1. Configure the launcher, reload VS Code, run a small Governor task with `--open both`.
2. Confirm App and IDE show the same prompt/result and title.
3. Send a follow-up in the IDE; verify `[Governor]` and `explain <id>` report the actual selection and approvals still work.
4. Change priority/mode from another terminal, complete the active turn, and verify the next IDE turn uses the new decision.
5. Confirm an unrelated native thread retains its original model and approval behavior.
6. Remove the setting, reload, and verify the extension returns to its bundled executable.

## Sources

- [App deep links](https://developers.openai.com/codex/app/commands): `codex://threads/<thread-id>` opens a local chat.
- [IDE developer settings](https://developers.openai.com/codex/ide/settings): `chatgpt.cliExecutable` is explicitly development-only.
- [App Server protocol](https://developers.openai.com/codex/app-server): initialization, stdio transport, thread naming, and turn overrides.
- [Hooks](https://developers.openai.com/codex/hooks): documented UserPromptSubmit output supports context/blocking, not a model override.
