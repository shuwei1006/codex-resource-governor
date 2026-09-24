# Release checklist

1. Confirm the public repository at `https://github.com/shuwei1006/codex-resource-governor` is reachable and the README clone URLs and package metadata point to it.
2. Confirm the npm package name is available to the maintainer. Update the version, lockfile and changelog for the release.
3. Enable private vulnerability reporting and branch protection. Require the four OS/Node CI jobs. No ChatGPT account credentials belong in GitHub Actions.
4. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm pack --dry-run`. Inspect the packed file list and ensure it contains no local state, credentials, or fixture secrets.
5. Run `codex-governor doctor` on each supported platform. Optionally run `doctor --live-turn` on a dedicated developer account; document actual results and versions. The 0.154.0 baseline passed default doctor checks on macOS during development; Linux and real inference on that exact version remain release validation tasks.
6. Run `npm pack`, install the tarball into a disposable prefix, and check `codex-governor --help` and configuration startup.
7. Authenticate using the maintainer's own npm publishing workflow, then intentionally run `npm publish --access public` or an approved trusted-publishing workflow. Publishing is never performed by install hooks or CI in this repository.
8. Tag the reviewed release and publish its release notes after the repository and npm package are ready.

The checked-in CI validates packaging but does not publish. The local implementation does not create repositories, push commits, or register the npm name.

Native integration also requires the manual checks in [native-integration.md](native-integration.md). Fake-protocol tests cannot establish live App rendering or compatibility with every IDE extension version. Keep the IDE proxy marked experimental and do not advertise desktop follow-up governance.
