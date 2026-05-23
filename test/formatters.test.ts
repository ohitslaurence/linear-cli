import { describe, expect, test } from "bun:test";
import * as fmt from "../src/formatters";
import type { Cycle, IssueDetail, IssueSummary } from "../src/types";

const summary: IssueSummary = {
  id: "uuid-1",
  identifier: "SPR-1",
  title: "Fix the thing, now",
  state: "In Progress",
  priority: 2,
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
  updatedAt: new Date("2026-01-03T03:04:05.000Z"),
  url: "https://linear.app/x/issue/SPR-1",
};

const detail: IssueDetail = {
  ...summary,
  description: "A description",
  estimate: 3,
  team: "Spritz",
  assignee: "Laurence",
  parent: "SPR-9",
  labels: ["bug", "p1"],
};

describe("formatPriority", () => {
  test("maps known priorities", () => {
    expect(fmt.formatPriority(0)).toBe("none");
    expect(fmt.formatPriority(1)).toBe("urgent");
    expect(fmt.formatPriority(4)).toBe("low");
  });
  test("falls back to the raw number", () => {
    expect(fmt.formatPriority(7)).toBe("7");
  });
});

describe("formatIssueListCSV", () => {
  test("reports empty lists", () => {
    expect(fmt.formatIssueListCSV([])).toBe("No issues found.");
  });

  test("emits a header and escapes commas", () => {
    const out = fmt.formatIssueListCSV([summary]);
    const lines = out.split("\n");
    expect(lines[0]).toBe("id,title,state,priority,team");
    // The title contains a comma, so it must be quoted.
    expect(lines[1]).toContain('"Fix the thing, now"');
    expect(lines[1]).toContain("SPR-1");
    expect(lines[1]).toContain("high");
  });
});

describe("formatIssueDetail", () => {
  test("includes parent and labels", () => {
    const out = fmt.formatIssueDetail(detail);
    expect(out).toContain("SPR-1: Fix the thing, now");
    expect(out).toContain("Parent: SPR-9");
    expect(out).toContain("Labels: bug, p1");
    expect(out).toContain("Estimate: 3 pts");
  });
});

describe("toJson (--json shape)", () => {
  test("is stable, indented, and round-trips field names", () => {
    const json = fmt.toJson([summary]);
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: "uuid-1",
      identifier: "SPR-1",
      title: "Fix the thing, now",
      state: "In Progress",
      priority: 2,
      url: "https://linear.app/x/issue/SPR-1",
    });
  });

  test("serialises Date fields to ISO-8601 strings", () => {
    const parsed = JSON.parse(fmt.toJson(summary)) as Record<string, string>;
    expect(parsed["createdAt"]).toBe("2026-01-02T03:04:05.000Z");
  });
});

describe("formatCycles", () => {
  test("renders progress as a percentage", () => {
    const cycle: Cycle = {
      id: "c1",
      number: 4,
      name: "Cycle 4",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-01-14T00:00:00.000Z",
      completedIssueCount: 3,
      totalIssueCount: 6,
      progress: 50,
    };
    const out = fmt.formatCycles([cycle]);
    expect(out.split("\n")[0]).toBe(
      "id,number,name,starts,ends,completed,total,progress",
    );
    expect(out).toContain("50%");
  });
});
