# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

- **Install**: `bun install`
- **Daemon mode**: `KAIROS_ENABLED=true bun run src/entrypoints/cli.tsx`
- **Webhook mode**: `bun run src/entrypoints/cli.tsx webhook`
- **Single worker (debug)**: `KAIROS_WORKER_COUNT=1 KAIROS_ENABLED=true bun run src/entrypoints/cli.tsx`

No build step needed — Bun runs TypeScript directly.

## Architecture

### Supervisor-Worker Model

```
~/.claude/scheduled_tasks.json
           ↓ (every 30s — tick evaluates tasks)
           ↓
Tick handler: evaluate cron schedules, dispatch due tasks
           ↓
cronScheduler → fires at exact minute boundaries (independent)
           ↓
dispatchToWorker() ← single authority for cooldown enforcement
           ↓
Worker Pool ← dispatch via stdin
Worker spawns "/Users/happy/.local/bin/claude -p --dangerously-skip-permissions <prompt>"
           ↓
Worker writes NDJSON → ~/.claude/debug/kairos-ipc/result-{randomUUID}.ndjson
           ↓
Supervisor IPC poller (500ms, self-rescheduling setTimeout) reads result
           ↓
Feishu notification on completion (if configured)
```

### Tick + CronScheduler Cooperation

Both tick and cronScheduler call the same `dispatchToWorker()` function, which enforces a 90s cooldown via `recentlyFired` Map. This prevents double-fire when both mechanisms fire the same task within the cooldown window.

- Tick: fires every 30s, evaluates if task is due
- cronScheduler: fires at minute boundaries, independent of tick
- 90s cooldown: `dispatchToWorker()` checks `Date.now() - lastFired < 90000`

`src/daemon/supervisor.ts` tick handler registered via `onTick()` at startup.

### Key Files

| File | Role |
|---|---|
| `src/daemon/supervisor.ts` | Main daemon — spawns workers, dispatches tasks, polls IPC |
| `src/daemon/worker.ts` | Worker — receives tasks via stdin, executes claude -p, writes NDJSON result |
| `src/daemon/ipc.ts` | File-based IPC — Workers write NDJSON, Supervisor polls every 500ms |
| `src/daemon/cronScheduler.ts` | Dynamic setTimeout chain cron — fires at minute boundaries |
| `src/daemon/dreamScheduler.ts` | 24h DREAM consolidation trigger |
| `src/services/autoDream/autoDream.ts` | Memory consolidation from Claude Code sessions |
| `src/services/autoDream/sessionReader.ts` | Reads Claude Code sessions from `~/.claude/projects/-Users-happy/*.jsonl` |
| `src/proactive/index.ts` | Heartbeat + tick — `onTick(cb)` / `offTick()` |

## Critical Implementation Notes

### Bun setInterval async bug
`setInterval` with an async callback does NOT work reliably in Bun 1.x — the timer fires but async ticks are not awaited, causing pollers to stall silently. **Every polling loop must use a self-rescheduling `setTimeout` chain** (see `ipc.ts` and `cronScheduler.ts`).

### IPC directory
- **Result dir**: `~/.claude/debug/kairos-ipc/` (NDJSON result files)
- **Pending dir**: `~/.claude/debug/kairos-ipc/pending/` (in-flight task markers)
- **CRITICAL**: Every dispatch MUST use a unique randomUUID as the IPC taskId. Using `task.id` (e.g. "tick-test") causes result file collisions when multiple workers dispatch the same task — the second result overwrites the first, poller skips it, worker stays permanently busy.
- Always clean IPC dir on daemon restart: `rm -f ~/.claude/debug/kairos-ipc/result-*.ndjson`

### DREAM data source
Memory consolidation reads from `~/.claude/projects/-Users-happy/*.jsonl` (Claude Code sessions), NOT OpenClaw sessions. Session format per line: `type: "user"|"assistant"`, `message.role`, `message.content` (string or array of text blocks).

### Worker lifecycle
Workers are long-running `spawn("bun", ...)` processes. They send `{type: "ready", workerId}` on stdout when started. The Supervisor uses `proc.on("exit")` to detect death and auto-respawns if `running=true`.

### Cron jitter
`cronScheduler.ts` adds up to 60s random jitter before firing to prevent thundering herd.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `KAIROS_ENABLED` | `false` | Must be `true` to start daemon |
| `KAIROS_WORKER_COUNT` | `2` | Number of parallel workers |
| `KAIROS_FEISHU_NOTIFY_ID` | — | Feishu group/user ID (oc_xxx or ou_xxx) |
| `KAIROS_HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat + tick interval |
| `KAIROS_DREAM_INTERVAL_MS` | `86400000` | DREAM consolidation interval (24h) |
| `KAIROS_CRON_JITTER_MS` | `60000` | Max jitter before cron fire |

Feishu credentials are read from `~/.openclaw/openclaw.json` channels config — KAIROS reuses OpenClaw's bot credentials.
