import { describe, expect, it } from "vitest";
import { assertValidRange, assertValidTimestamp } from "../../src/time.js";

describe("assertValidTimestamp", () => {
  it("accepts a valid UTC timestamp", () => {
    expect(() => assertValidTimestamp("2026-11-01T08:00:00Z")).not.toThrow();
  });

  it("accepts a valid timestamp with a non-UTC offset, even when it rolls to a different UTC day", () => {
    // 23:30 on the 1st at -03:00 is 02:30 UTC on the 2nd: a real time, not an invalid one.
    expect(() => assertValidTimestamp("2026-11-01T23:30:00-03:00")).not.toThrow();
  });

  it("accepts a timestamp with milliseconds", () => {
    expect(() => assertValidTimestamp("2026-11-01T08:00:00.123Z")).not.toThrow();
  });

  it("rejects a non-existent calendar day (February 30th)", () => {
    expect(() => assertValidTimestamp("2026-02-30T10:00:00Z")).toThrow(/not a real calendar date/);
  });

  it("rejects an out-of-range hour", () => {
    expect(() => assertValidTimestamp("2026-11-01T24:00:00Z")).toThrow(/not a real calendar date/);
  });

  it("rejects a string with no offset", () => {
    expect(() => assertValidTimestamp("2026-11-01T08:00:00")).toThrow(/explicit offset/);
  });

  it("rejects a non-date string", () => {
    expect(() => assertValidTimestamp("not-a-date")).toThrow(/explicit offset/);
  });

  it("rejects UTC offsets outside -14:00..+14:00 (PostgreSQL would reject them with a 500)", () => {
    expect(() => assertValidTimestamp("2026-11-01T00:00:00+16:00")).toThrow(/out-of-range UTC offset/);
    expect(() => assertValidTimestamp("2026-11-01T00:00:00-14:30")).toThrow(/out-of-range UTC offset/);
    expect(() => assertValidTimestamp("2026-11-01T00:00:00+05:60")).toThrow(/out-of-range UTC offset/);
    expect(() => assertValidTimestamp("2026-11-01T00:00:00+14:00")).not.toThrow();
    expect(() => assertValidTimestamp("2026-11-01T00:00:00-12:00")).not.toThrow();
    expect(() => assertValidTimestamp("2026-11-01T00:00:00+05:45")).not.toThrow();
  });

  it("correctly rejects February 29th on a non-leap year but accepts it on a leap year", () => {
    expect(() => assertValidTimestamp("2026-02-29T00:00:00Z")).toThrow(/not a real calendar date/);
    expect(() => assertValidTimestamp("2028-02-29T00:00:00Z")).not.toThrow();
  });
});

describe("assertValidRange", () => {
  it("accepts from strictly before to", () => {
    expect(() => assertValidRange("2026-11-01T00:00:00Z", "2026-11-01T00:00:01Z")).not.toThrow();
  });

  it("compares instants, not strings: offsets are taken into account", () => {
    // 00:00-03:00 is 03:00Z, which is after 01:00Z even though the string sorts first.
    expect(() => assertValidRange("2026-11-01T00:00:00-03:00", "2026-11-01T01:00:00Z")).toThrow(/must be earlier/);
  });

  it("rejects an empty interval (from == to)", () => {
    expect(() => assertValidRange("2026-11-01T00:00:00Z", "2026-11-01T00:00:00Z")).toThrow(/must be earlier/);
  });
});
