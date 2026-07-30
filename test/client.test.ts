import { describe, expect, test } from "bun:test";
import { stateFilter } from "../src/client";

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

  test("anything else is a literal state name", () => {
    expect(stateFilter("Prioritized - Current")).toEqual({
      name: { eq: "Prioritized - Current" },
    });
  });
});
