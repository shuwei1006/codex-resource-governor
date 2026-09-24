# Security policy

v0.1 is a local application that starts the user's installed Codex binary. It inherits the local environment, uses Codex authentication, and submits user-approved tasks in a workspace-write sandbox. Approval handling is part of the trust boundary; unsupported interactive requests must fail closed. Governor never grants persistent approval rules.

Governor sends no telemetry and stores no authentication tokens. Its private JSON state can still contain sensitive task names, directories, thread identifiers, and response text. Do not share that directory or complete App Server diagnostics without reviewing and redacting them. Terminal escape sequences from remote text are stripped in the TUI.

The optional development-only IDE proxy forwards the native client's security settings and approval requests/replies. It never accepts approvals on the user's behalf. It changes model/effort only for registered thread `turn/start` requests and preserves native telemetry configuration. Its private launcher contains executable/storage paths, not credentials. Deep links are generated only from validated thread UUIDs and launched without a shell. Desktop App follow-ups bypass Governor; opening a link does not establish governance. See [native integration](docs/native-integration.md).

Report vulnerabilities through the repository's **Security → Advisories → Report a vulnerability** once the maintainer enables private reporting. If private reporting is unavailable, open a minimal issue asking for a private contact channel without disclosing the vulnerability. Never post credentials, exploit details, or private logs in public issues.

Only the latest v0.1 patch is intended to receive fixes. This is a best-effort community policy, not a response-time guarantee. Before the first public release, the maintainer must enable private vulnerability reporting and keep dependencies reviewed.
