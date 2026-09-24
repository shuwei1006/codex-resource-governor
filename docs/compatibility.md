# Compatibility evidence

Implementation date: 2026-09-24. The requested target baseline, Codex CLI **0.154.0**, passed all default doctor checks against a temporary installation: generated schema, handshake, ChatGPT account, quota, catalog, ephemeral thread creation, and non-inference turn dispatch. Five usable models were returned. No real inference was run against 0.154.0. There is no minimum-version comparison in Governor; required capabilities are checked instead.

The installed binary used during development reports **codex-cli 0.155.0-alpha.16.3**, on macOS ARM64 with Node.js 25.6.0. The following checks passed against that actual binary and a ChatGPT login:

- `codex app-server generate-json-schema`: `TurnStartParams` includes `model` and `effort`; `ThreadStartParams` includes ephemeral, sandbox and approval controls.
- stdio `initialize` → `initialized` handshake.
- `account/read`, with account identity omitted from evidence.
- `account/rateLimits/read`: a weekly window was observed in `primary`, with no 5h window. This is why Governor identifies windows by duration.
- Paginated `model/list`: usable models and supported reasoning values returned. No account-specific catalog is checked into production code.
- Ephemeral read-only `thread/start`.
- `turn/start` dispatch with a nonexistent thread: explicit thread-not-found rejection before inference.
- `doctor --live-turn`: a real read-only turn with explicit model/effort overrides completed successfully.

Default doctor distinguishes schema/dispatch verification from real inference. The live test establishes that explicit overrides are accepted and a turn completes; the current stable `Turn` response does not attest the executed model/effort, and this test does not measure savings.

The generated installed schema, rather than prose examples, is authoritative for wire details. For example, this binary's approval-policy enum uses `on-request` and `untrusted`. Governor sends `on-request` for managed tasks and `never` for the ephemeral doctor probe. Reasoning effort is an open nonempty string; values must be validated against each live model's supported list.

The upstream documentation used for the handshake, thread/turn flow, and quota interpretation is the [official Codex App Server documentation](https://developers.openai.com/codex/app-server). Generated schemas are temporary inspection artifacts, not committed copies of local account state.

CI uses a deterministic fixture server and Node 20/22 on macOS/Ubuntu, with no credentials or real model calls. That is protocol regression coverage, not proof of live service compatibility for every version, OS, or subscription. Maintainers should record additional live versions here before advertising them as tested.

A separate live managed-task smoke test also passed: create a task, disconnect before its first message, reopen it, complete a turn, reconnect again, change to another model/effort advertised by the account, and complete another turn. The temporary test thread was archived after verification. No user Governor configuration was changed.

This exposed a real protocol edge: a newly created thread may have no persisted rollout until its first turn. Governor now retains its own stable task ID and recreates only a provably unused thread when `thread/resume` returns `no rollout found`. A persisted `hasSubmitted` marker is written before sending any prompt; a thread with a potentially accepted turn is never recreated automatically.

The full 84-test offline suite, TypeScript typecheck, ESLint, and build passed locally on **Node.js 20.20.2** and **25.6.0**. `npm ci` from the lockfile, `npm pack --dry-run`, and installation of the packed tarball into a disposable prefix were also verified. The installed `codex-governor --help` entry point worked. The remote GitHub Actions matrix is configured but has not been run in this workspace.
