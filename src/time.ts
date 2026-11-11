import { badRequest } from "./errors.js";

const TIMESTAMP_COMPONENTS =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;

// Real-world UTC offsets range from -12:00 to +14:00. Anything past that
// matches the pattern but PostgreSQL rejects it ("time zone displacement out
// of range"), which used to surface as a 500 instead of a 400.
const MAX_OFFSET_HOURS = 14;

/**
 * The route-level JSON schema (src/logs/schema.ts TIMESTAMP_PATTERN) only
 * checks the string shape and that an offset is present — it can't express
 * "February 30th doesn't exist". `Date.parse` doesn't reliably reject that
 * either: V8 silently rolls invalid components over into the next valid
 * date instead of returning NaN for several ISO-8601-like inputs.
 *
 * This re-parses the literal Y-M-D h:m:s digits (ignoring the offset) and
 * round-trips them through `Date.UTC`: if the calendar date isn't real,
 * UTC getters on the resulting Date won't match what was typed, because
 * `Date.UTC` rolls over out-of-range fields the same way `new Date(...)`
 * does. The offset is deliberately excluded from this check — rolling a
 * valid local time into a different UTC calendar day (e.g. 23:30-03:00) is
 * normal and must not be flagged as invalid. The offset itself is only
 * range-checked (see MAX_OFFSET_HOURS).
 */
export function assertValidTimestamp(value: string): void {
  const match = TIMESTAMP_COMPONENTS.exec(value);
  if (!match) {
    throw badRequest("INVALID_TIMESTAMP", `"${value}" is not a valid ISO 8601 timestamp with an explicit offset.`);
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr, offsetHourStr, offsetMinuteStr] =
    match as unknown as [string, string, string, string, string, string, string, string?, string?];

  if (offsetHourStr !== undefined && offsetMinuteStr !== undefined) {
    const offsetMinutes = Number(offsetHourStr) * 60 + Number(offsetMinuteStr);
    if (Number(offsetMinuteStr) > 59 || offsetMinutes > MAX_OFFSET_HOURS * 60) {
      throw badRequest("INVALID_TIMESTAMP", `"${value}" has an out-of-range UTC offset (allowed: -14:00 to +14:00).`);
    }
  }
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);

  const roundTripMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const roundTrip = new Date(roundTripMs);
  const isRealCalendarDateTime =
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() + 1 === month &&
    roundTrip.getUTCDate() === day &&
    roundTrip.getUTCHours() === hour &&
    roundTrip.getUTCMinutes() === minute &&
    roundTrip.getUTCSeconds() === second;

  if (!isRealCalendarDateTime) {
    throw badRequest("INVALID_TIMESTAMP", `"${value}" is not a real calendar date/time.`);
  }
}

/**
 * The [from, to) interval is empty when from >= to. Answering that with
 * 200 [] (listing) or 422 EMPTY_BATCH (analysis) hides a client mistake
 * behind a "no data" result, so it's rejected explicitly. Both values must
 * already have passed assertValidTimestamp.
 */
export function assertValidRange(from: string, to: string): void {
  if (Date.parse(from) >= Date.parse(to)) {
    throw badRequest("INVALID_RANGE", `"from" (${from}) must be earlier than "to" (${to}).`);
  }
}
