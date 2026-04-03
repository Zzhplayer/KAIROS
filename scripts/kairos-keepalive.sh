#!/bin/bash
# KAIROS keepalive wrapper — starts KAIROS daemon and restarts if it dies.
# Called by launchd (RunAtLoad + KeepAlive) for persistent auto-start.

set -e

KAIROS_DIR="/tmp/KAIROS"
KAIROS_BIN="bun"
KAIROS_ENTRY="src/entrypoints/cli.tsx"
PID_FILE="/Users/happy/.claude/debug/kairos-daemon.pid"
LOG_DIR="/Users/happy/.claude/debug"
LOG_FILE="$LOG_DIR/kairos-daemon.log"

mkdir -p "$LOG_DIR"

start_kairos() {
  if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
      echo "$(date): KAIROS already running as PID $OLD_PID" >> "$LOG_FILE"
      return 0
    else
      echo "$(date): Stale PID file (PID $OLD_PID dead), removing" >> "$LOG_FILE"
      rm -f "$PID_FILE"
    fi
  fi

  echo "$(date): Starting KAIROS daemon..." >> "$LOG_FILE"
  cd "$KAIROS_DIR"

  # Start KAIROS in background, redirect logs
  KAIROS_ENABLED=true \
  KAIROS_WORKER_COUNT=2 \
  nohup bun run "$KAIROS_ENTRY" >> "$LOG_FILE" 2>&1 &
  NEW_PID=$!
  echo "$NEW_PID" > "$PID_FILE"
  echo "$(date): KAIROS started as PID $NEW_PID" >> "$LOG_FILE"
}

# Monitor loop — restart if process dies
while true; do
  start_kairos

  if [ -f "$PID_FILE" ]; then
    CURRENT_PID=$(cat "$PID_FILE")
    if ! kill -0 "$CURRENT_PID" 2>/dev/null; then
      echo "$(date): KAIROS PID $CURRENT_PID died, restarting..." >> "$LOG_FILE"
      rm -f "$PID_FILE"
      sleep 2
      continue
    fi
  fi

  # Check every 30 seconds
  sleep 30 &
  wait $!
done
