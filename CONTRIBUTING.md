# Contributing

Thanks for helping improve KAIROS.

KAIROS is an early-stage project for proactive OSS maintenance automation. Good contributions are small, testable, and explain how they affect daemon reliability, maintainer workflow, or security.

## Development Setup

```bash
git clone https://github.com/Zzhplayer/KAIROS.git
cd KAIROS
bun install
bun run typecheck
```

## Local Commands

```bash
bun run daemon
bun run webhook
bun run typecheck
```

## Contribution Guidelines

- Open an issue before large behavior changes.
- Keep daemon changes conservative and easy to reason about.
- Do not commit real tokens, webhook secrets, Feishu credentials, or private session logs.
- Add or update documentation when changing environment variables, task config, or webhook behavior.
- Keep user-local paths configurable when practical.
- Prefer small pull requests that can be reviewed independently.

## Pull Request Checklist

- [ ] `bun run typecheck` passes.
- [ ] New environment variables are documented in `README.md`.
- [ ] Webhook and daemon changes include a short security note in the PR description.
- [ ] Logs do not expose secrets or private prompt/session content.

## Areas That Need Help

- GitHub webhook hardening and better event coverage.
- Tests for cron parsing, task cooldowns, and IPC result handling.
- Release-note and changelog automation for maintainers.
- Documentation for deploying the daemon safely.
