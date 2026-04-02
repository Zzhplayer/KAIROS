/**
 * Dream memory — tracks consolidation metadata.
 * Stores last run time so we only process sessions newer than that.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logForDebugging } from "../../utils/logger.ts";

export interface DreamMeta {
  lastRun: string; // ISO timestamp
  sessionsProcessed: number;
  factsExtracted: number;
}

const DREAM_DIR = join(homedir(), ".claude", "dream-memories");
const DREAM_META_PATH = join(DREAM_DIR, "dream-meta.json");
const MEMORIES_PATH = join(DREAM_DIR, "memories.md");

function ensureDir() {
  mkdirSync(DREAM_DIR, { recursive: true });
}

export function loadDreamMeta(): DreamMeta | null {
  try {
    const raw = readFileSync(DREAM_META_PATH, "utf-8");
    const parsed = JSON.parse(raw) as DreamMeta;
    // Validate required fields
    if (typeof parsed.lastRun !== "string") return null;
    return parsed;
  } catch {
    // File missing or corrupted — rename corrupt file and return null
    try {
      const backupPath = DREAM_META_PATH + ".corrupt." + Date.now();
      renameSync(DREAM_META_PATH, backupPath);
      logForDebugging(
        `[dreamMeta] Corrupted meta file renamed to ${backupPath}`,
      );
    } catch {
      // ignore rename failure
    }
    return null;
  }
}

export function saveDreamMeta(meta: DreamMeta): void {
  ensureDir();
  writeFileSync(DREAM_META_PATH, JSON.stringify(meta, null, 2), "utf-8");
}

/**
 * Mark dream as tentatively dispatched — call BEFORE sending to worker.
 * This prevents re-processing if the worker crashes after dispatch but before
 * the result is written. The final meta will be written by the supervisor
 * when the result arrives.
 */
export function markDreamDispatched(): void {
  const existing = loadDreamMeta();
  const meta: DreamMeta = existing ?? {
    lastRun: new Date().toISOString(),
    sessionsProcessed: 0,
    factsExtracted: 0,
  };
  // Don't overwrite lastRun if it already reflects a completed run
  saveDreamMeta(meta);
}

export function getMemoriesPath(): string {
  ensureDir();
  return MEMORIES_PATH;
}
