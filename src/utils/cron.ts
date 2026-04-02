/**
 * Pure cron expression parser — no external dependencies.
 * Supports 5 fields: minute hour dayOfMonth month dayOfWeek
 * Syntax: *, <step>n, n, n,m, n-m
 */

/** 5-field cron descriptor */
export type CronFields = {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
};

/**
 * Split a cron field segment (e.g. "step-5", "1,3,5", "1-10") into a sorted
 * array of integers. Handles star, step, range, and list syntax.
 */
function parseField(segment: string, min: number, max: number): number[] {
  if (segment === "*") {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  const result = new Set<number>();

  for (const part of segment.split(",")) {
    const trimmed = part.trim();

    if (trimmed.startsWith("*/")) {
      const step = parseInt(trimmed.slice(2), 10);
      if (step > 0) {
        for (let v = min; v <= max; v += step) result.add(v);
      }
    } else if (trimmed.includes("-")) {
      const [startStr, endStr] = trimmed.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      for (let v = start; v <= end; v++) {
        if (v >= min && v <= max) result.add(v);
      }
    } else {
      const val = parseInt(trimmed, 10);
      if (!isNaN(val) && val >= min && val <= max) result.add(val);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}

/**
 * Parse a cron expression string into its component fields.
 * @example parseCronExpression("30 9 * * 1-5")  // weekdays at 9:30
 */
export function parseCronExpression(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression: expected 5 fields, got ${parts.length}`,
    );
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

/**
 * Check whether a given Date matches a cron field set.
 */
function matchesField(val: number, field: number[]): boolean {
  return field.length === 0 || field.includes(val);
}

/**
 * Compute the next Date on or after `from` that matches the cron expression.
 * Advances minute-by-minute; suitable for typical schedule sizes.
 */
export function computeNextCronRun(
  expr: string,
  from: Date = new Date(),
): Date {
  const { minute, hour, dayOfMonth, month, dayOfWeek } =
    parseCronExpression(expr);

  // Start from the next minute boundary to avoid firing in the past second
  const current = new Date(from);
  current.setSeconds(0, 0);
  current.setMinutes(current.getMinutes() + 1);

  // Cap at 2 years out to prevent infinite loops
  const deadline = new Date(current);
  deadline.setFullYear(deadline.getFullYear() + 2);

  while (current <= deadline) {
    if (
      matchesField(current.getMonth() + 1, month) &&
      matchesField(current.getDate(), dayOfMonth) &&
      matchesField(current.getDay(), dayOfWeek) &&
      matchesField(current.getHours(), hour) &&
      matchesField(current.getMinutes(), minute)
    ) {
      return new Date(current);
    }
    current.setMinutes(current.getMinutes() + 1);
  }

  throw new Error("Unable to compute next cron run within 2 years");
}

/** Chinese labels for months and weekdays */
const MONTH_NAMES = [
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
];
const DOW_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/**
 * Convert a cron expression to a human-readable Chinese string.
 * Handles common patterns: daily, hourly, weekly, monthly, weekdays.
 */
export function cronToHuman(expr: string): string {
  const fields = parseCronExpression(expr);
  const { minute, hour, dayOfMonth, month, dayOfWeek } = fields;

  // Helper: describe a range
  const fmt = (arr: number[], labels: string[], fallback: string) => {
    if (arr.length === 0) return fallback;
    if (arr.length === labels.length) return fallback;
    if (arr.length === 1) return labels[arr[0]] ?? String(arr[0]);
    const first = arr[0];
    const last = arr[arr.length - 1];
    if (last - first + 1 === arr.length)
      return `${labels[first]}-${labels[last]}`;
    return arr.map((i) => labels[i] ?? String(i)).join(",");
  };

  // All months
  const isAllMonths = month.length === 12;

  // Weekday-only (Mon-Fri)
  const weekdaySet = new Set([1, 2, 3, 4, 5]);
  const isWeekdays =
    dayOfWeek.length === 5 && dayOfWeek.every((d) => weekdaySet.has(d));

  // Daily
  const isDaily =
    dayOfMonth.length === 31 && dayOfWeek.length === 7 && isAllMonths;

  // Hourly
  const isHourly =
    hour.length === 24 &&
    isAllMonths &&
    dayOfMonth.length === 31 &&
    dayOfWeek.length === 7;

  if (isHourly) {
    if (minute.length === 1) return `每小时的第 ${minute[0]} 分`;
    return `每小时`;
  }

  if (isDaily) {
    const h = hour.length === 1 ? hour[0] : null;
    const m = minute.length === 1 ? minute[0] : null;
    if (h !== null && m !== null)
      return `每天 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    if (h !== null) return `每天 ${h} 时`;
    return `每天`;
  }

  if (isWeekdays) {
    const h = hour.length === 1 ? hour[0] : null;
    const m = minute.length === 1 ? minute[0] : null;
    if (h !== null && m !== null)
      return `每周一到五 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    if (h !== null) return `每周一到五 ${h} 时`;
    return `每周一到五`;
  }

  // Weekly
  if (
    dayOfWeek.length > 0 &&
    dayOfWeek.length < 7 &&
    isAllMonths &&
    dayOfMonth.length === 31
  ) {
    const days = dayOfWeek.map((d) => DOW_NAMES[d]).join("、");
    const h = hour.length === 1 ? hour[0] : null;
    const m = minute.length === 1 ? minute[0] : null;
    if (h !== null && m !== null)
      return `${days} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    return `${days}`;
  }

  // Monthly
  if (
    dayOfMonth.length > 0 &&
    dayOfMonth.length < 31 &&
    isAllMonths &&
    dayOfWeek.length === 7
  ) {
    const dom =
      dayOfMonth.length === 1
        ? `${dayOfMonth[0]}日`
        : `${dayOfMonth[0]}-${dayOfMonth[dayOfMonth.length - 1]}日`;
    const h = hour.length === 1 ? hour[0] : null;
    const m = minute.length === 1 ? minute[0] : null;
    if (h !== null && m !== null)
      return `每月${dom} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    return `每月${dom}`;
  }

  // Fallback: show all fields
  const h =
    hour.length === 1
      ? `${hour[0]}时`
      : hour.length > 0
        ? `${hour.length}个时`
        : "";
  const m =
    minute.length === 1
      ? `${minute[0]}分`
      : minute.length > 0
        ? `${minute.length}个分`
        : "";
  const dom = fmt(
    dayOfMonth,
    Array.from({ length: 31 }, (_, i) => `${i + 1}日`),
    "每天",
  );
  const mon = fmt(month, MONTH_NAMES, "每月");
  const dow = fmt(dayOfWeek, DOW_NAMES, "");

  return [mon, dom, dow, h, m].filter(Boolean).join(" ");
}
