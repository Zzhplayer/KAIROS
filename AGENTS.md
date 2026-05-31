# Agent Instructions

Use this guide when working on KAIROS with Codex, Claude Code, or another coding agent.

## Project Context

KAIROS is a Bun/TypeScript daemon for proactive maintainer automation. It schedules agent prompts, receives GitHub PR webhook events, dispatches work to local workers, sends Feishu notifications, and consolidates coding-agent session memory.

## Commands

```bash
bun install
bun run typecheck
bun run daemon
bun run webhook
```

There is no build step; Bun runs TypeScript directly.

## Important Constraints

- Use Bun-compatible APIs.
- Keep long-running loops as self-rescheduling `setTimeout` chains; avoid async `setInterval`.
- Do not log secrets, Feishu credentials, GitHub tokens, webhook secrets, or private session content.
- Preserve the supervisor/worker split and the file-based IPC contract unless the PR explicitly migrates it.
- Use unique task ids for IPC result files to avoid collisions.
- Document new environment variables in `README.md`.

## Review Focus

For daemon changes, check:

- Worker lifecycle and respawn behavior.
- IPC cleanup and result collision risks.
- Cron cooldown and duplicate dispatch behavior.
- Webhook signature validation and loop protection.
- Logging of sensitive local data.

For documentation changes, check:

- Commands match `package.json`.
- Environment variable names match the code.
- Examples avoid real secrets and private paths.
