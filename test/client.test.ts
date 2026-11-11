import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  isUuid,
  parseSince,
  projectDetailOf,
  projectUpdateStatusOf,
  projectUpdatesFilter,
  stateFilter,
} from "../src/client";

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

describe("projectDetailOf", () => {
  const node = {
    id: "p1",
    name: "EU onboarding",
    url: "https://linear.app/x",
    description: "",
    content: "body",
    state: "started",
    startDate: null,
    targetDate: "2026-10-16",
    updatedAt: "2026-10-27T10:44:05.369Z",
    status: { name: "In Progress" },
    lead: { name: "Laurence Davies", displayName: "laurence" },
    teams: { nodes: [{ id: "t1", key: "SPR" }] },
    projectMilestones: {
      nodes: [
        { id: "m2", name: "[M2]", description: null, targetDate: null, progress: 0, sortOrder: 2 },
        { id: "m1", name: "[M1]", description: "d", targetDate: "2026-10-06", progress: 50, sortOrder: 1 },
      ],
    },
    externalLinks: { nodes: [{ id: "l1", label: "Spec", url: "https://notion.so/s" }] },
    documents: { nodes: [] },
  };

  test("orders milestones by sortOrder and maps empty strings to undefined", () => {
    const { project, milestones } = projectDetailOf(node);
    expect(milestones.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(project.description).toBeUndefined();
    expect(project.content).toBe("body");
    expect(project.lead).toBe("laurence");
    expect(project.status).toBe("In Progress");
    expect(project.teamKey).toBe("SPR");
    expect(project.links).toEqual([{ id: "l1", label: "Spec", url: "https://notion.so/s" }]);
  });
});

describe("projectUpdatesFilter", () => {
  test("filters on status type, not the deprecated state comparator", () => {
    expect(projectUpdatesFilter({ state: "started" })).toEqual({
      status: { type: { eq: "started" } },
    });
  });

  test("adds lead and any-team filters only when given", () => {
    expect(
      projectUpdatesFilter({ state: "paused", leadId: "u1", teamId: "t1" }),
    ).toEqual({
      status: { type: { eq: "paused" } },
      lead: { id: { eq: "u1" } },
      accessibleTeams: { some: { id: { eq: "t1" } } },
    });
  });
});

describe("projectUpdateStatusOf", () => {
  const node = {
    id: "p1",
    name: "KYC Pass-Through",
    url: "https://linear.app/x/project/kyc",
    targetDate: "2026-11-23",
    health: "atRisk",
    status: { type: "started" },
    lead: { id: "u1", name: "Alex A", displayName: "alex", email: "alex@x.com" },
    teams: { nodes: [{ key: "GROW" }] },
    lastUpdate: {
      id: "pu1",
      createdAt: "2026-11-09T14:23:49.293Z",
      health: "onTrack",
      body: "In grooming.",
      url: "https://linear.app/x/project/kyc#pu1",
      user: { name: "Alex A", displayName: "alex" },
    },
  };

  test("maps a project with an update to the --json contract", () => {
    expect(projectUpdateStatusOf(node)).toEqual({
      projectId: "p1",
      project: "KYC Pass-Through",
      url: "https://linear.app/x/project/kyc",
      state: "started",
      teamKey: "GROW",
      lead: { id: "u1", name: "alex", email: "alex@x.com" },
      targetDate: "2026-11-23",
      health: "atRisk",
      latestUpdate: {
        id: "pu1",
        createdAt: "2026-11-09T14:23:49.293Z",
        author: "alex",
        health: "onTrack",
        body: "In grooming.",
        url: "https://linear.app/x/project/kyc#pu1",
      },
    });
  });

  test("uses explicit nulls for a project with no lead, team, dates or update", () => {
    const status = projectUpdateStatusOf({
      ...node,
      targetDate: null,
      health: null,
      lead: null,
      teams: { nodes: [] },
      lastUpdate: null,
    });
    expect(status).toMatchObject({
      teamKey: null,
      lead: null,
      targetDate: null,
      health: null,
      latestUpdate: null,
    });
  });
});
