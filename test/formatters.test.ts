import { describe, expect, test } from "bun:test";
import * as fmt from "../src/formatters";
import type {
  Cycle,
  IssueComment,
  IssueDetail,
  IssueSummary,
  Paged,
} from "../src/types";

/** The envelope every list command now emits. */
const paged = <T>(items: T[], overrides: Partial<Paged<T>["pageInfo"]> = {}): Paged<T> => ({
  items,
  pageInfo: {
    returned: items.length,
    limit: items.length,
    hasNextPage: false,
    truncated: false,
    ...overrides,
  },
});

const summary: IssueSummary = {
  id: "uuid-1",
  identifier: "SPR-1",
  title: "Fix the thing, now",
  state: "In Progress",
  stateType: "started",
  priority: 2,
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
  updatedAt: new Date("2026-01-03T03:04:05.000Z"),
  dueDate: "2026-01-10",
  team: "Spritz",
  teamKey: "SPR",
  assignee: "Laurence",
  assigneeId: "user-1",
  labels: ["bug", "p1"],
  url: "https://linear.app/x/issue/SPR-1",
};

const detail: IssueDetail = {
  ...summary,
  description: "A description",
  estimate: 3,
  parent: "SPR-9",
  attachments: [
    {
      id: "att-1",
      title: "Fix the thing",
      url: "https://github.com/x/y/pull/42",
      sourceType: "github",
    },
  ],
  children: [
    {
      id: "uuid-2",
      identifier: "SPR-2",
      title: "Sub task",
      state: "Todo",
      stateType: "unstarted",
    },
  ],
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
    expect(fmt.formatIssueListCSV(paged<IssueSummary>([]))).toBe(
      "No issues found.",
    );
  });

  test("emits a header and escapes commas", () => {
    const out = fmt.formatIssueListCSV(paged([summary]));
    const lines = out.split("\n");
    expect(lines[0]).toBe("id,title,state,assignee,due,labels,priority,team");
    // The title contains a comma, so it must be quoted.
    expect(lines[1]).toContain('"Fix the thing, now"');
    expect(lines[1]).toContain("SPR-1");
    expect(lines[1]).toContain("high");
  });

  test("carries assignee, due date and labels — the SLA fields", () => {
    const line = fmt.formatIssueListCSV(paged([summary])).split("\n")[1]!;
    expect(line).toContain("Laurence");
    expect(line).toContain("2026-01-10");
    expect(line).toContain("bug p1");
  });

  test("says so out loud when the list was cut short", () => {
    const out = fmt.formatIssueListCSV(
      paged([summary], { limit: 1, hasNextPage: true, truncated: true }),
    );
    expect(out).toContain("more remain");
  });

  test("stays quiet when nothing was cut short", () => {
    expect(fmt.formatIssueListCSV(paged([summary]))).not.toContain("more remain");
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

  test("shows sub-issues, so a container is not mistaken for work", () => {
    const out = fmt.formatIssueDetail(detail);
    expect(out).toContain("Sub-issues (1):");
    expect(out).toContain("SPR-2 [Todo] Sub task");
  });

  test("shows attachments, which is how 'Done with no PR' becomes visible", () => {
    const out = fmt.formatIssueDetail(detail);
    expect(out).toContain("github: Fix the thing");
    expect(out).toContain("https://github.com/x/y/pull/42");
  });
});

describe("formatIssueComments", () => {
  const at = (iso: string) => new Date(iso);
  const root: IssueComment = {
    id: "c1",
    body: "Any update on this?",
    createdAt: at("2026-01-02T09:00:00.000Z"),
    updatedAt: at("2026-01-02T09:00:00.000Z"),
    author: "Customer",
    threadId: "c1",
  };
  const reply: IssueComment = {
    id: "c2",
    body: "Shipping today.",
    createdAt: at("2026-01-02T11:30:00.000Z"),
    updatedAt: at("2026-01-02T11:30:00.000Z"),
    author: "Laurence",
    parentId: "c1",
    threadId: "c1",
  };

  test("reports an empty thread", () => {
    expect(fmt.formatIssueComments(paged<IssueComment>([]))).toBe(
      "No comments on this issue.",
    );
  });

  test("indents a reply under what it answers", () => {
    const lines = fmt.formatIssueComments(paged([root, reply])).split("\n");
    const replyHead = lines.find((l) => l.includes("Laurence"))!;
    const rootHead = lines.find((l) => l.includes("Customer"))!;
    expect(rootHead.startsWith(" ")).toBe(false);
    expect(replyHead.startsWith("  ")).toBe(true);
  });

  test("keeps times, not just dates — a 4-hour target needs them", () => {
    const out = fmt.formatIssueComments(paged([root, reply]));
    expect(out).toContain("2026-01-02 09:00Z");
    expect(out).toContain("2026-01-02 11:30Z");
  });

  test("still shows a reply whose parent fell outside the page", () => {
    const orphan: IssueComment = { ...reply, parentId: "missing" };
    const out = fmt.formatIssueComments(paged([orphan]));
    expect(out).toContain("Shipping today.");
  });
});

describe("formatDryRun", () => {
  test("names the targets and the resolved change", () => {
    const out = fmt.formatDryRun({
      dryRun: true,
      operation: "update",
      targets: ["SPR-1", "SPR-2"],
      requested: { state: "In Progress", assignee: "me" },
      resolved: [{ stateId: "state-a" }, { stateId: "state-b" }],
    });
    expect(out).toContain("DRY RUN — nothing was written.");
    expect(out).toContain("Targets (2): SPR-1, SPR-2");
    expect(out).toContain("state: In Progress");
    expect(out).toContain("Would send to SPR-1:");
    expect(out).toContain("stateId: state-a");
    expect(out).toContain("Would send to SPR-2:");
    expect(out).toContain("stateId: state-b");
  });
});

describe("toJson (--json shape)", () => {
  test("is stable, indented, and round-trips field names", () => {
    const json = fmt.toJson(paged([summary]));
    const parsed = JSON.parse(json) as {
      items: Array<Record<string, unknown>>;
      pageInfo: Record<string, unknown>;
    };
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      id: "uuid-1",
      identifier: "SPR-1",
      title: "Fix the thing, now",
      state: "In Progress",
      assignee: "Laurence",
      dueDate: "2026-01-10",
      labels: ["bug", "p1"],
      priority: 2,
      url: "https://linear.app/x/issue/SPR-1",
    });
    expect(parsed.pageInfo).toMatchObject({
      returned: 1,
      hasNextPage: false,
      truncated: false,
    });
  });

  test("serialises Date fields to ISO-8601 strings", () => {
    const parsed = JSON.parse(fmt.toJson(summary)) as Record<string, string>;
    expect(parsed["createdAt"]).toBe("2026-01-02T03:04:05.000Z");
  });

  test("omits absent optional fields rather than emitting null", () => {
    const parsed = JSON.parse(fmt.toJson(summary)) as Record<string, unknown>;
    expect("completedAt" in parsed).toBe(false);
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
    const out = fmt.formatCycles(paged([cycle]));
    expect(out.split("\n")[0]).toBe(
      "id,number,name,starts,ends,completed,total,progress",
    );
    expect(out).toContain("50%");
  });
});

describe("formatProjectDetail", () => {
  const project = {
    id: "p1",
    name: "EU onboarding",
    teamKey: "SPR",
    teamId: "t1",
    state: "started",
    updatedAt: "2026-10-27T10:44:05.369Z",
    url: "https://linear.app/spritz/project/eu",
    description: "EU users can onboard and off-ramp EUR",
    content: "## Process checklist\n- Spec: ✅ https://notion.so/spec",
    status: "In Progress",
    lead: "laurence",
    targetDate: "2026-10-16",
    links: [{ id: "l1", label: "Spec", url: "https://notion.so/spec" }],
    documents: [],
  };

  test("shows both descriptions, lead, milestones with descriptions, and links", () => {
    const out = fmt.formatProjectDetail(project, [
      { id: "m1", name: "[M1] EU onboarding", description: "SDK, ToS", targetDate: "2026-10-06", progress: 91.67 },
    ]);
    expect(out).toContain("Project: EU onboarding (SPR, In Progress)");
    expect(out).toContain("Lead: laurence");
    expect(out).toContain("Summary: EU users can onboard and off-ramp EUR");
    expect(out).toContain("--- Description ---\n## Process checklist");
    expect(out).toContain("m1,[M1] EU onboarding,2026-10-06,92%,\"SDK, ToS\"");
    expect(out).toContain("- Spec: https://notion.so/spec");
  });

  test("says (none) when descriptions and links are missing", () => {
    const out = fmt.formatProjectDetail(
      { ...project, description: undefined, content: undefined, links: [] },
      [],
    );
    expect(out).toContain("Summary: (none)");
    expect(out).toContain("--- Description ---\n(none)");
    expect(out).toContain("Milestones: none");
    expect(out).toContain("Links: none");
  });
});

describe("formatHistoryEntries", () => {
  const at = new Date("2026-11-03T22:18:54.000Z");
  test("shows due dates set, moved and cleared", () => {
    const out = fmt.formatHistoryEntries(
      paged([
        { id: "h1", createdAt: at, actorName: "Lucas", toDueDate: "2026-11-03" },
        {
          id: "h2",
          createdAt: at,
          actorName: "Lucas",
          fromDueDate: "2026-11-03",
          toDueDate: "2026-11-05",
        },
        { id: "h3", createdAt: at, fromDueDate: "2026-11-05" },
      ]),
    );
    expect(out).toContain("Lucas: Due date set: 2026-11-03");
    expect(out).toContain("Lucas: Due date: 2026-11-03 → 2026-11-05");
    expect(out).toContain("- Due date cleared (was 2026-11-05)");
  });
});
