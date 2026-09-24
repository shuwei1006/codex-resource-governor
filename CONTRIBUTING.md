# Contributing

Use Node.js 20 or newer, install with `npm ci`, and run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm pack --dry-run` before opening a pull request. Keep changes within the CLI/TUI MVP.

The pure policy engine lives in `src/policy.ts`. Transport and capability detection are separate from task state and UI. A policy change should include boundary, missing-quota, and reset-cycle cases. A transport change should include a fixture protocol test. Never add real account data, credentials, Codex state, private file paths, or live model requests to tests/CI.

For protocol changes, generate schemas from the installed Codex with `codex app-server generate-json-schema --out /tmp/governor-schema` and check the official documentation. Describe the tested binary version and differences. Do not add guessed fields or hardcode account model lists.

All tests use isolated temporary directories. Manual `doctor --live-turn` uses account quota and should only be run intentionally on a developer's account. Include actual validation outcomes in the pull request; distinguish fixture tests from live verification.

Keep English and Chinese user documentation aligned. New UI strings should support both languages. Public command names and protocol identifiers remain English.

Contributions are licensed under the project's MIT license. Report security issues privately using SECURITY.md instead of a public issue.
