/**
 * Cron task persistence — reads/writes ~/.claude/scheduled_tasks.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CronTask {
  id: string;
  prompt: string;
  schedule: string;
  permanent?: boolean;
  createdAt?: string;
}

/** Max jitter added to each cron fire (ms) — set via env */
export const DEFAULT_CRON_JITTER_CONFIG = {
  maxJitterMs: parseInt(process.env["KAIROS_CRON_JITTER_MS"] ?? "60000", 10),
};

function getCronTasksPath(dir?: string): string {
  const base = dir ?? join(homedir(), ".claude");
  return join(base, "scheduled_tasks.json");
}

function ensureDir(dir?: string) {
  try {
    mkdirSync(dir ?? join(homedir(), ".claude"), { recursive: true });
  } catch {
    // ignore
  }
}

/**
 * Load all cron tasks from the JSON file.
 * Returns an empty array if the file does not exist or is invalid.
 */
export function loadCronTasks(dir?: string): CronTask[] {
  const path = getCronTasksPath(dir);
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as CronTask[];
  } catch {
    return [];
  }
}

/**
 * Persist the full task list to the JSON file.
 */
export function saveCronTasks(tasks: CronTask[], dir?: string): void {
  const path = getCronTasksPath(dir);
  ensureDir(dir);
  writeFileSync(path, JSON.stringify(tasks, null, 2), "utf-8");
}
