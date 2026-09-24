# Architecture

The CLI uses Commander; the TUI uses Ink/React. Domain input and server output are validated with zod. There is no HTTP service, database, scheduler, or credential handling.

| Module | Responsibility |
| --- | --- |
| `domain.ts` | Persisted schemas and live model validation |
| `rpc.ts` | Child-process stdio JSONL, initialization, correlation, requests, timeouts, shutdown |
| `capabilities.ts` | Installed schema probes, paginated catalog, ChatGPT check, doctor |
| `policy.ts` | Pure quota normalization, decisions, cycle holds, fixed explanations |
| `control.ts` | Atomic mode/selection changes and control revisions; see [session control](session-control.md) |
| `task-name.ts` | Local, bounded task labels derived from prompts without model calls |
| `storage.ts` | Private JSON files, fsync + rename, serialized mutations |
| `governor.ts` | Managed threads, reservations, turn lifecycle, approval routing |
| `ui.tsx` | Bilingual setup, single-screen task list, detail, prompt, approvals |
| `native.ts` | Local thread links, guarded handoff, private IDE launcher generation |
| `ide-proxy.ts` | Managed native turn policy overrides and lifecycle bookkeeping |
| `codex-proxy.ts` | Experimental IDE executable adapter and bidirectional JSONL forwarding |
| `cli.tsx` | Public commands, interactive/headless sessions, native handoff |

Every connection sends `initialize` and then `initialized` before application RPC. Server requests and notifications are distinct from responses. No output is parsed from Codex diagnostic stderr; only the official JSONL stdout protocol controls state. Stderr is retained as a bounded diagnostic tail for failures.

`run "prompt"` derives a display name locally (unless `--name` overrides it) and immediately executes the new task. The full prompt, rather than its shortened name, is sent as turn input. New tasks call `thread/start`. Existing tasks call `thread/resume` before sending more input. Before `turn/start`, Governor refreshes quota/config and the model catalog, reserves the task atomically, verifies that no known turn is active, computes the next selection, and explicitly sends `model` and `effort`. Notifications are queued behind the start acknowledgement so an immediate completion cannot be overwritten by a late running state.

Current is updated only when a start acknowledgement arrives. Quota, priority, policy, or mode changes affect Next. Model output streams in memory; its bounded tail is persisted at completion or session close. The Codex thread is the source of full conversation history. Unknown outcomes remain unknown rather than being represented as success.

Cross-process interruption writes a request into the latest atomic task record. The process that owns the active App Server connection polls the request and sends `turn/interrupt`, because a second connection cannot resume or interrupt a thread held by the active writer. Record deletion interrupts active or uncertain turns first and proceeds only after that request succeeds. Deletion removes Governor state only; late completion notifications are ignored when their record no longer exists.

Each quota window has its own monotonic stage and observed reset timestamp. Per-window bookkeeping prevents unrelated resets or temporarily missing data from restoring a previously reduced configuration. The effective percentage is the minimum of currently valid windows; retained holds can keep a task more constrained than the current percentage alone would suggest.

The child process forces analytics and OpenTelemetry exporters off. Authentication remains entirely with Codex. Thread sandbox/approval settings are workspace-write/on-request. Command/file-change approvals are handled individually, questions receive typed text responses, and unimplemented request types receive protocol errors. No approval is silently granted.

The optional IDE proxy instead preserves the native client's launch flags, initialization capabilities, sandbox policy, and approval handling. Only registered thread `turn/start` requests receive Governor policy overrides. App deep links provide a completed-turn handoff without intercepting desktop input. See [native integration](native-integration.md) for limits and configuration.

Codex can discard an unused thread without a persisted rollout. After reconnecting, Governor may recreate that empty thread while preserving its logical task ID. This is allowed only when no turn has ever been submitted and no current selection or turn ID exists. The `hasSubmitted` flag is persisted before the RPC write; uncertain submissions fail conservatively rather than replaying input into a new thread.

## Storage format 2

Configuration uses `version: 2`, `primary` and `economy` profiles, and a `quality-first`, `balanced`, or `save-quota` quota policy. Task state also uses `version: 2` and `high`, `medium`, or `low` task priority. Old flags and version 1 files are rejected; there is no runtime alias or automatic migration. Back up old storage and configure a new `CODEX_GOVERNOR_HOME` before using 0.2.0.
