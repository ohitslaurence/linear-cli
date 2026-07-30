import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { isUuid, parseSince, stateFilter } from "../src/client";

describe("stateFilter", () => {
  // The day view is built on `open`, and the distinction from `active` is the
  // whole reason it exists: `active` means started+unstarted, which silently
  // drops Triage — and freshly captured work is the most likely to matter today.
  test("open excludes only completed and canceled", () => {
    expect(stateFilter("open")).toEqual({
      type: { nin: ["completed", "canceled"] },
    });
  });

  test("active excludes triage and backlog too", () => {
    expect(stateFilter("active")).toEqual({
      type: { in: ["started", "unstarted"] },
    });
  });

  // Case-insensitive: a caller who types `in progress` means the same state as
  // one who types `In Progress`, and an exact match would quietly return zero
  // issues rather than say so.
  test("anything else is a literal state name, matched case-insensitively", () => {
    expect(stateFilter("Prioritized - Current")).toEqual({
      name: { eqIgnoreCase: "Prioritized - Current" },
    });
  });
});

describe("isUuid", () => {
  test("recognises a Linear id", () => {
    expect(isUuid("6a1f2e3d-4b5c-4d6e-8f90-1a2b3c4d5e6f")).toBe(true);
  });

  test("treats a state or team name as a name", () => {
    expect(isUuid("In Progress")).toBe(false);
    expect(isUuid("SPR")).toBe(false);
  });
});

describe("parseSince", () => {
  const parse = (value: string) => Effect.runSync(parseSince("test", value));
  const failure = (value: string) =>
    Effect.runSync(Effect.flip(parseSince("test", value)));

  test("accepts a whole day", () => {
    expect(parse("2026-07-30").toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  // Same-day exchanges are the common case for a four-hour response target, so
  // date granularity would make the ordering of question and answer a coin flip.
  test("accepts an ISO instant and keeps the time", () => {
    expect(parse("2026-07-30T14:30:00Z").toISOString()).toBe(
      "2026-07-30T14:30:00.000Z",
    );
  });

  // An unset shell variable used to widen the window to all time, silently.
  test("rejects an unparseable value instead of dropping the filter", () => {
    expect(failure("yesterday").field).toBe("since");
  });
});
