import type { Recurrence, Task } from "./store.ts";

/**
 * Reading "when" out of the phrasings people actually type.
 *
 * Kept small and predictable on purpose: a scheduler that guesses is worse than
 * one that says it did not understand. Everything it accepts is listed in the
 * error it throws, so a rejection tells you what to write instead.
 */

export interface ParsedWhen {
  dueAt: number;
  /** Seconds between repeats for interval recurrences; null otherwise. */
  repeat: number | null;
  /** Set when the repeat is calendar-anchored rather than a fixed interval. */
  recurrence?: Recurrence;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const USAGE =
  'Use "in 10m", "every 2h", "at 14:30", "every day at 09:00", "every weekday at 08:30", or "every monday at 17:00".';

export function parseWhen(text: string, now = Date.now()): ParsedWhen {
  const raw = text.trim().toLowerCase().replace(/\s+/g, " ");

  // Fixed intervals first: "every 2h" must not be read as a day name.
  const every = /^every ?(\d+) ?(s|sec|secs|seconds?|m|min|mins?|minutes?|h|hr|hrs?|hours?|d|days?)$/.exec(raw);
  if (every) {
    const seconds = toSeconds(Number(every[1]), every[2]!);
    // Intervals stay in `repeat`; a recurrence is only stored when the repeat
    // is calendar-anchored and cannot be expressed as a number of seconds.
    return { dueAt: now + seconds * 1000, repeat: seconds };
  }

  const calendar = parseCalendar(raw, now);
  if (calendar) return calendar;

  const relative = /^(?:in )?(\d+) ?(s|sec|secs|seconds?|m|min|mins?|minutes?|h|hr|hrs?|hours?|d|days?)$/.exec(raw);
  if (relative) {
    return { dueAt: now + toSeconds(Number(relative[1]), relative[2]!) * 1000, repeat: null };
  }

  // An absolute time today, rolling to tomorrow if it has already passed.
  const at = /^(?:at )?(.+)$/.exec(raw);
  const minute = at ? parseTimeOfDay(at[1]!) : null;
  if (minute !== null) {
    let due = atMinuteOn(new Date(now), minute);
    if (due <= now) due += 86_400_000;
    return { dueAt: due, repeat: null };
  }

  throw new Error(`Cannot read "${text}". ${USAGE}`);
}

/**
 * Calendar repeats: "every day at 09:00", "weekdays at 8:30", "every mon and
 * thu at 5pm".
 *
 * The time of day is required. "every day" on its own has no defensible
 * default — picking one silently schedules something for a time nobody chose.
 */
function parseCalendar(raw: string, now: number): ParsedWhen | null {
  const match = /^(?:every |each )?(.+?) at (.+)$/.exec(raw);
  if (!match) return null;

  const days = parseDays(match[1]!);
  if (!days) return null;

  const minute = parseTimeOfDay(match[2]!);
  if (minute === null) throw new Error(`Cannot read the time in "${raw}". ${USAGE}`);

  const recurrence: Recurrence =
    days === "daily" ? { kind: "daily", minute } : { kind: "weekly", minute, days: [...days].sort() };
  const dueAt = nextFromRecurrence(recurrence, now);
  return { dueAt, repeat: null, recurrence };
}

/** A day phrase to weekday numbers, `"daily"` for every day, or null. */
function parseDays(text: string): Set<number> | "daily" | null {
  const phrase = text.trim();
  if (phrase === "day" || phrase === "daily" || phrase === "days") return "daily";
  if (phrase === "weekday" || phrase === "weekdays") return new Set([1, 2, 3, 4, 5]);
  if (phrase === "weekend" || phrase === "weekends") return new Set([0, 6]);

  const days = new Set<number>();
  for (const part of phrase.split(/,| and |\s+/)) {
    const word = part.trim().replace(/s$/, "");
    if (!word) continue;
    const day = WEEKDAYS[word];
    if (day === undefined) return null;
    days.add(day);
  }
  return days.size ? days : null;
}

/** "9", "9:30", "09:30", "9am", "5:15 pm", "noon", "midnight" to minutes past midnight. */
export function parseTimeOfDay(text: string): number | null {
  const raw = text.trim().replace(/\s+/g, "");
  if (raw === "noon" || raw === "midday") return 12 * 60;
  if (raw === "midnight") return 0;

  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(raw);
  if (!match) return null;

  let hour = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const suffix = match[3];
  if (minutes > 59) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === "pm" && hour !== 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
  } else if (hour > 23) return null;

  return hour * 60 + minutes;
}

/**
 * The next time a task should fire after `now`, or null when it is a one-shot.
 *
 * Calendar recurrences are resolved against the local clock rather than added
 * as a fixed number of seconds, so "09:00" survives a late run and both DST
 * changes. Intervals advance from `now`, which is what keeps a Mosaic that was
 * closed for a week from coming back to a hundred queued runs.
 */
export function nextOccurrence(task: Pick<Task, "repeat" | "recurrence">, now = Date.now()): number | null {
  if (task.recurrence) return nextFromRecurrence(task.recurrence, now);
  if (task.repeat === null) return null;
  return now + task.repeat * 1000;
}

export function nextFromRecurrence(recurrence: Recurrence, now: number): number {
  if (recurrence.kind === "interval") return now + recurrence.seconds * 1000;

  const days = recurrence.kind === "weekly" ? new Set(recurrence.days) : null;
  const start = new Date(now);
  // Eight days covers any weekly pattern, including one due later today.
  for (let offset = 0; offset <= 8; offset++) {
    const day = new Date(start);
    day.setDate(day.getDate() + offset);
    if (days && !days.has(day.getDay())) continue;
    const candidate = atMinuteOn(day, recurrence.minute);
    if (candidate > now) return candidate;
  }
  // Unreachable for a non-empty pattern; falling forward a day beats throwing
  // inside a scheduler tick.
  return now + 86_400_000;
}

/** Local midnight on `day`, plus `minute` minutes. */
function atMinuteOn(day: Date, minute: number): number {
  const at = new Date(day);
  at.setHours(0, minute, 0, 0);
  return at.getTime();
}

function toSeconds(n: number, unit: string): number {
  if (unit.startsWith("s")) return n;
  if (unit.startsWith("m")) return n * 60;
  if (unit.startsWith("h")) return n * 3600;
  return n * 86400;
}

/**
 * A run so late that its next one is already due is skipped rather than run.
 *
 * The alternative is a 09:00 briefing arriving at 08:55 the following morning,
 * immediately followed by the real one. Never more than one run per period.
 */
export function isStale(task: Pick<Task, "repeat" | "recurrence" | "dueAt">, now = Date.now()): boolean {
  const next = nextOccurrence(task, task.dueAt);
  return next !== null && next <= now;
}

export function describeWhen(task: Pick<Task, "dueAt" | "repeat" | "recurrence" | "when">, now = Date.now()): string {
  const secs = Math.max(0, Math.round((task.dueAt - now) / 1000));
  const rel = secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.round(secs / 60)}m` : `${Math.round(secs / 3600)}h`;

  const recurrence = task.recurrence;
  if (recurrence && recurrence.kind !== "interval") {
    return `${describeRecurrence(recurrence)}, next in ${rel}`;
  }
  return task.repeat ? `in ${rel}, then every ${Math.round(task.repeat / 60)}m` : `in ${rel}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeRecurrence(recurrence: Recurrence): string {
  if (recurrence.kind === "interval") return `every ${Math.round(recurrence.seconds / 60)}m`;
  const time = formatMinute(recurrence.minute);
  if (recurrence.kind === "daily") return `every day at ${time}`;
  const days = [...recurrence.days].sort();
  const label =
    days.join() === "1,2,3,4,5"
      ? "every weekday"
      : days.join() === "0,6"
        ? "every weekend day"
        : `every ${days.map((d) => DAY_NAMES[d]).join(", ")}`;
  return `${label} at ${time}`;
}

export function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
