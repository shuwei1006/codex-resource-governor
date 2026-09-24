# Changelog

## 0.2.0 — 2026-09-24

- Distinguish Model Profile (Primary / Economy), Task Priority (High / Medium / Low), Quota Policy (Quality First / Balanced / Save Quota), and Reasoning Effort throughout English and Chinese setup, TUI, CLI help, explanations, and documentation.
- **Breaking:** replace `--normal-model` / `--normal-effort` and the `normal` profile with `--primary-model` / `--primary-effort` and `primary`. Task priority values are `high` / `medium` / `low`; quota policies are `quality-first` / `balanced` / `save-quota`. Configuration and task state now require schema version 2; legacy files are rejected without overwriting them. Start with a new storage directory after backing up the old one. Quota thresholds and selection behavior are unchanged.

## 0.1.0 — 2026-09-24

- Automatic Codex binary discovery supports cross-terminal commands when Codex is supplied by the VS Code extension or ChatGPT App instead of the shell `PATH`.
- Configuration inspection exposes `config --path` and `config --show`, and successful saves report and verify the exact file path.
- Explicit auto/manual/off session control with validated fixed model/effort, native pass-through, TUI selection, and control revision checks. Legacy keep retains its Normal semantics.

- Native App/VS Code handoff via `run --open`, `config --open-in`, `open`, `list`, and the TUI O key; desktop follow-up selection remains outside Governor.
- Experimental VS Code stdio proxy applies Governor policy to managed native `turn/start` requests while preserving native approvals and input.

- `run "prompt"` automatically names and executes a task; `--name` is optional and the existing `--prompt` syntax remains supported.
- `interrupt <id>` can stop a managed turn from another terminal, and `delete <id>` safely removes its local record.
- Official Codex App Server stdio integration with generated-schema capability checks.
- Quota-aware policy engine with priority, Keep mode, and persistent per-window cycle holds.
- Managed threads, next-turn model/effort overrides, streaming text, and explicit approval handling.
- English/Chinese CLI configuration and single-screen Ink TUI.
- Private atomic JSON storage, offline protocol tests, and Node 20/22 macOS/Ubuntu CI.
