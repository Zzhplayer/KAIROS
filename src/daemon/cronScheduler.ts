/**
 * Cron scheduler using dynamic setTimeout — checks every minute.
 * Fires onTask for any tasks whose next scheduled time has arrived.
 */

import { computeNextCronRun } from "../utils/cron.ts";
import { loadCronTasks, type CronTask } from "../utils/cronTasks.ts";
import { logForDebugging } from "../utils/logger.ts";

export interface CronSchedulerOptions {
  /** Called when a task should fire. */
  onFireTask: (task: CronTask) => void;
  /** Called with tasks that were missed while the daemon was stopped. */
  onMissed?: (tasks: CronTask[]) => void;
  /** Override ~/.claude for testing. */
  dir?: string;
}

type ScheduledTask = CronTask & { nextRun: Date };

function jitter(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}

export function createCronScheduler(opts: CronSchedulerOptions) {
  const { onFireTask, onMissed, dir } = opts;

  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scheduled: ScheduledTask[] = [];
  // Guard against re-entering onFireTask for the same task within one tick
  const inFlight = new Set<string>();

  function refreshTasks() {
    const tasks = loadCronTasks(dir);
    const now = new Date();
    const upcoming: ScheduledTask[] = [];

    for (const task of tasks) {
      try {
        const nextRun = computeNextCronRun(
          task.schedule,
          new Date(now.getTime() - 1),
        );
        upcoming.push({ ...task, nextRun });
      } catch (err) {
        logForDebugging(
          `[cronScheduler] Invalid schedule for task ${task.id}: ${String(err)}`,
        );
      }
    }

    scheduled = upcoming;
    return upcoming;
  }

  function scheduleDelay(nextRun: Date, task: CronTask, jitterMs = 0) {
    const delay = nextRun.getTime() - Date.now() + jitterMs;
    if (delay <= 0) {
      // Fire immediately if already due
      inFlight.add(task.id);
      try {
        onFireTask(task);
      } finally {
        inFlight.delete(task.id);
      }
      scheduleNextForTask(task);
      return;
    }

    timer = setTimeout(() => {
      inFlight.add(task.id);
      try {
        onFireTask(task);
      } finally {
        inFlight.delete(task.id);
      }
      scheduleNextForTask(task);
    }, delay);
  }

  function scheduleNextForTask(task: CronTask) {
    // Remove old entry for this task to prevent accumulation
    scheduled = scheduled.filter((st) => st.id !== task.id);
    try {
      const nextRun = computeNextCronRun(task.schedule);
      scheduleDelay(nextRun, task);
    } catch (err) {
      logForDebugging(
        `[cronScheduler] Cannot reschedule task ${task.id}: ${String(err)}`,
      );
    }
  }

  function tick() {
    if (!running) return;
    const now = Date.now();
    const minuteBoundary = new Date(now);
    minuteBoundary.setSeconds(0, 0);
    const minuteAfter = new Date(minuteBoundary.getTime() + 60_000);

    const toFire: ScheduledTask[] = [];
    const firedIds = new Set<string>();

    for (const st of scheduled) {
      // Skip tasks already being dispatched (prevents double-fire from immediate callbacks)
      if (st.nextRun < minuteAfter && !inFlight.has(st.id)) {
        toFire.push(st);
      }
    }

    if (toFire.length > 0) {
      logForDebugging(
        `[cronScheduler] Firing ${toFire.length} task(s) this minute`,
      );
      for (const st of toFire) {
        const jitterMs = jitter(60000);
        scheduleDelay(st.nextRun, st, jitterMs);
      }
      onMissed?.(toFire);
    }

    // Rescan at the next minute boundary
    const delayMs = minuteAfter.getTime() - Date.now();
    timer = setTimeout(tick, Math.max(delayMs, 10_000));
  }

  function start() {
    if (running) return;
    running = true;
    // Cancel any pre-existing timer to prevent double-fires on restart
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    logForDebugging("[cronScheduler] Starting");

    // Load and compute initial schedule
    scheduled = refreshTasks();
    logForDebugging(
      `[cronScheduler] Loaded ${scheduled.length} scheduled task(s)`,
    );

    // Check for missed tasks (tasks with nextRun in the past)
    const now = new Date();
    const missed = scheduled.filter((st) => st.nextRun < now);
    if (missed.length > 0 && onMissed) {
      logForDebugging(
        `[cronScheduler] ${missed.length} task(s) missed while stopped`,
      );
      onMissed(missed);
    }

    // Start the minute ticker
    const now2 = new Date();
    now2.setSeconds(0, 0);
    const delayMs = 60_000 - (now2.getTime() % 60_000);
    timer = setTimeout(tick, delayMs);
  }

  function stop() {
    running = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    logForDebugging("[cronScheduler] Stopped");
  }

  return { start, stop };
}
