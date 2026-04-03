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
(sends proactive Feishu "Task Triggered" card before dispatch)
           ↓
cronScheduler → fires at exact minute boundaries (independent)
           ↓
Worker Pool ← dispatch via stdin
Worker spawns "bun run claude -p --dangerously-skip-permissions <prompt>"
           ↓
Worker writes NDJSON result → ~/.claude/debug/kairos-ipc/result-{taskId}.ndjson
           ↓
Supervisor IPC poller (500ms, self-rescheduling setTimeout) reads result
           ↓
Feishu notification on completion (if configured)
```

### Tick Mechanism

Every 30s (`KAIROS_HEARTBEAT_INTERVAL_MS`), the tick callback evaluates all scheduled tasks:
- Compute `nextCronRun` for each task from current minute
- Fire if `nextRun <= currentTime` AND task not fired in last 90s (cooldown)
- Send proactive Feishu "Task Triggered" card before dispatching
- CronScheduler fires at minute boundaries independently — tick and cron cooperate via 90s cooldown

`src/proactive/index.ts`: `onTick(cb)` / `offTick()` register tick callbacks.
`src/daemon/supervisor.ts`: tick handler registered at startup, unregistered at shutdown.

### Key Files

| File | Role |
|---|---|
| `src/daemon/supervisor.ts` | Main daemon — spawns workers, dispatches tasks, polls IPC |
| `src/daemon/worker.ts` | Worker — receives tasks via stdin, executes via claude -p, writes result |
| `src/daemon/ipc.ts` | File-based IPC — Workers write NDJSON, Supervisor polls |
| `src/daemon/cronScheduler.ts` | Dynamic setTimeout cron — NOT setInterval. Fires at minute boundaries |
| `src/daemon/dreamScheduler.ts` | 24h DREAM consolidation trigger |
| `src/services/autoDream/autoDream.ts` | Memory consolidation — runs claude -p on Claude Code sessions |
| `src/services/autoDream/sessionReader.ts` | Reads Claude Code sessions from `~/.claude/projects/-Users-happy/*.jsonl` |
| `src/proactive/index.ts` | Heartbeat activation (calls `activateProactive`) |

## Critical Implementation Notes

### Bun setInterval async bug
`setInterval` with an async callback does NOT work reliably in Bun 1.x — the timer fires but async ticks are not awaited, causing pollers to stall silently. **Every polling loop must use a self-rescheduling `setTimeout` chain** (see `ipc.ts` line ~110 and `cronScheduler.ts`).

### IPC directory
- **Result dir**: `~/.claude/debug/kairos-ipc/` (NDJSON result files)
- **Pending dir**: `~/.claude/debug/kairos-ipc/pending/` (in-flight task markers)
- Result files are deleted after the poller processes them — if a daemon restarts with stale result files present, workers get permanently marked `busy` and all cron fires are discarded.

### DREAM data source
Memory consolidation reads from `~/.claude/projects/-Users-happy/*.jsonl` (Claude Code sessions), NOT OpenClaw sessions. Session format per line: `type: "user"|"assistant"`, `message.role`, `message.content` (string or array of text blocks).

### Worker lifecycle
Workers are long-running `spawn("bun", ...)` processes. They send `{type: "ready", workerId}` on stdout when started. The Supervisor uses `proc.on("exit")` to detect death and auto-respawns if `running=true`.

### Cron jitter
`cronScheduler.ts` adds up to 60s random jitter before firing to prevent thundering herd. The jitter is applied per-task via `scheduleDelay(task.nextRun, task, jitter(60000))`.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `KAIROS_ENABLED` | `false` | Must be `true` to start daemon |
| `KAIROS_WORKER_COUNT` | `2` | Number of parallel workers |
| `KAIROS_FEISHU_NOTIFY_ID` | — | Feishu group/user ID (oc_xxx or ou_xxx) |
| `KAIROS_HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat + tick interval (single timer, both fire together) |
| `KAIROS_DREAM_INTERVAL_MS` | `86400000` | DREAM consolidation interval (24h) |
| `KAIROS_CRON_JITTER_MS` | `60000` | Max jitter before cron fire |

Feishu credentials are read from `~/.openclaw/openclaw.json` channels config — KAIROS reuses OpenClaw's bot credentials.
