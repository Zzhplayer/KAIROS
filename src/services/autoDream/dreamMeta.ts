/**
 * Dream memory — tracks consolidation metadata.
 * Stores last run time so we only process sessions newer than that.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
    return JSON.parse(raw) as DreamMeta;
  } catch {
    return null;
  }
}

export function saveDreamMeta(meta: DreamMeta): void {
  ensureDir();
  writeFileSync(DREAM_META_PATH, JSON.stringify(meta, null, 2), "utf-8");
}

export function getMemoriesPath(): string {
  ensureDir();
  return MEMORIES_PATH;
}
