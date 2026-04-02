/**
 * AutoDream — periodic memory consolidation service.
 *
 * Consolidation cycle:
 * 1. Load dream meta (last run time)
 * 2. Read recent sessions from OpenClaw agents (main, bot6)
 * 3. Use claude -p to extract key facts and decisions
 * 4. Write consolidated memory to dream-memories.md
 * 5. Register with qmd for retrieval
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  loadDreamMeta,
  saveDreamMeta,
  getMemoriesPath,
  type DreamMeta,
} from "./dreamMeta.ts";
import { readRecentSessions, formatSessionsForLLM } from "./sessionReader.ts";
import { logForDebugging, logError } from "../../utils/logger.ts";

const DREAM_DIR = join(homedir(), ".claude", "dream-memories");

/**
 * Run a prompt through claude -p and return the text output.
 */
async function runClaudePrompt(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      ["run", "claude", "-p", "--dangerously-skip-permissions", prompt],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        logError(
          `[autoDream] claude prompt failed: ${stderr || `exit ${code}`}`,
        );
        resolve("");
      }
    });

    child.on("error", (err) => {
      logError(`[autoDream] claude spawn error: ${String(err)}`);
      resolve("");
    });
  });
}

/**
 * Build the memory consolidation prompt for Claude.
 */
function buildConsolidationPrompt(sessionsText: string): string {
  return `You are a memory consolidation assistant. Given recent conversation sessions below, extract and organize key information into a structured memory document.

Extract:
1. **Facts** — factual information learned or confirmed (preferences, names, decisions, findings)
2. **Decisions** — choices made and their rationale
3. **Open Questions** — things that were discussed but not resolved
4. **Learnings** — insights, patterns, or lessons from the conversation
5. **Context** — ongoing projects, current work, active relationships

Output format: Write a markdown document with sections for each category above.

Important rules:
- Be concise and specific — include actual names, dates, numbers when present
- Only include information that is clearly stated or strongly implied
- Skip vague or trivial exchanges
- If a topic has no relevant information, write "无" for that section
- Write in Chinese where the original conversation is in Chinese

---

${sessionsText}

---

# Memory Consolidation Output
`;
}

/**
 * Write memory document to disk and register with qmd.
 */
async function writeMemoryDocument(memory: string): Promise<number> {
  const memoriesPath = getMemoriesPath();

  // Append with separator
  const header = `\n\n## Consolidation at ${new Date().toISOString()}\n\n`;
  appendFileSync(memoriesPath, header + memory, "utf-8");
  logForDebugging(`[autoDream] Memory written to ${memoriesPath}`);

  // Count facts extracted (rough estimate: count bullet points)
  const bulletCount = (memory.match(/^[-*#]\s/gm) || []).length;
  return bulletCount;
}

/**
 * Register the memories directory as a qmd collection if not already registered.
 */
async function registerWithQmd(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      "qmd",
      [
        "collection",
        "add",
        DREAM_DIR,
        "--name",
        "kairos-dreams",
        "--mask",
        "*.md",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0 || stderr.includes("already exists")) {
        logForDebugging("[autoDream] qmd collection registered");
      }
      // Non-fatal — proceed regardless
      resolve();
    });

    child.on("error", () => {
      // qmd might not be installed — non-fatal
      logForDebugging("[autoDream] qmd not available, skipping registration");
      resolve();
    });
  });
}

/**
 * Execute a full memory consolidation cycle.
 * Called by the worker via dream:trigger message.
 */
export async function executeAutoDream(): Promise<void> {
  logForDebugging("[autoDream] Running memory consolidation cycle");

  // --- Step 1: Load meta ---
  const meta = loadDreamMeta();
  const sinceMs = meta
    ? new Date(meta.lastRun).getTime()
    : Date.now() - 24 * 60 * 60 * 1000;

  // --- Step 2: Read recent sessions ---
  logForDebugging(
    `[autoDream] Reading sessions since ${new Date(sinceMs).toISOString()}`,
  );
  const sessions = readRecentSessions(sinceMs);
  logForDebugging(`[autoDream] Found ${sessions.length} recent sessions`);

  if (sessions.length === 0) {
    logForDebugging("[autoDream] No new sessions — skipping consolidation");
    return;
  }

  // --- Step 3: Format sessions ---
  const sessionsText = formatSessionsForLLM(sessions);
  const totalMessages = sessions.reduce((sum, s) => sum + s.messages.length, 0);
  logForDebugging(
    `[autoDream] ${sessions.length} sessions, ${totalMessages} messages to consolidate`,
  );

  // --- Step 4: Run LLM consolidation ---
  const prompt = buildConsolidationPrompt(sessionsText);
  const memory = await runClaudePrompt(prompt);

  if (!memory.trim()) {
    logError("[autoDream] Consolidation prompt returned empty result");
    return;
  }

  // --- Step 5: Write to disk ---
  const factsCount = await writeMemoryDocument(memory);

  // --- Step 6: Register with qmd ---
  await registerWithQmd();

  // --- Step 7: Update meta ---
  const newMeta: DreamMeta = {
    lastRun: new Date().toISOString(),
    sessionsProcessed: sessions.length,
    factsExtracted: factsCount,
  };
  saveDreamMeta(newMeta);

  logForDebugging(
    `[autoDream] Done — processed ${sessions.length} sessions, extracted ~${factsCount} facts`,
  );
}

// --- Lifecycle ---

let initialized = false;

export function initAutoDream(): void {
  if (initialized) return;
  initialized = true;
  logForDebugging("[autoDream] Initialised");
}
