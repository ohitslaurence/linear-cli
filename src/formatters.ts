import type {
  Comment,
  CreatedDocument,
  CreatedProject,
  Cycle,
  CustomView,
  Favorite,
  HistoryEntry,
  Inbox,
  IssueDetail,
  IssueSummary,
  LinearUser,
  ProjectMilestone,
  ProjectStatus,
  ProjectSummary,
  UpdatedProject,
  UserActivity,
} from "./types";

/**
 * Human-friendly (CSV/text) formatters. Default CLI output. The `--json` path
 * never touches these — it serialises the raw domain objects (see
 * {@link toJson}), so the two output modes stay independently stable.
 */

const escapeField = (value: string | undefined | null): string => {
  if (!value) return "-";
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const formatPriority = (priority: number): string => {
  switch (priority) {
    case 0:
      return "none";
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 3:
      return "medium";
    case 4:
      return "low";
    default:
      return String(priority);
  }
};

const formatDate = (date: Date | string | undefined): string => {
  if (!date) return "-";
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** Stable machine-readable serialisation used by every command's `--json`. */
export const toJson = (data: unknown): string => JSON.stringify(data, null, 2);

export const formatIssueListCSV = (issues: readonly IssueSummary[]): string => {
  if (issues.length === 0) return "No issues found.";
  const header = "id,title,state,priority,team";
  const rows = issues.map((i) =>
    [
      i.identifier,
      escapeField(i.title),
      escapeField(i.state),
      formatPriority(i.priority),
      escapeField(i.team),
    ].join(","),
  );
  return [header, ...rows].join("\n");
};

export const formatIssueDetail = (issue: IssueDetail): string => {
  const lines: string[] = [
    `${issue.identifier}: ${issue.title}`,
    `URL: ${issue.url}`,
    "",
    `State: ${issue.state || "-"}`,
    `Priority: ${formatPriority(issue.priority)}`,
    `Team: ${issue.team || "-"}`,
  ];

  if (issue.assignee) lines.push(`Assignee: ${issue.assignee}`);
  if (issue.project) lines.push(`Project: ${issue.project}`);
  if (issue.milestone) lines.push(`Milestone: ${issue.milestone}`);
  if (issue.parent) lines.push(`Parent: ${issue.parent}`);
  if (issue.estimate) lines.push(`Estimate: ${issue.estimate} pts`);
  if (issue.dueDate) lines.push(`Due: ${issue.dueDate}`);
  if (issue.labels.length > 0) lines.push(`Labels: ${issue.labels.join(", ")}`);

  lines.push("");
  lines.push(`Created: ${formatDate(issue.createdAt)} by ${issue.creator || "-"}`);
  lines.push(`Updated: ${formatDate(issue.updatedAt)}`);

  if (issue.description) {
    lines.push("");
    lines.push("--- Description ---");
    const maxLen = 2000;
    lines.push(
      issue.description.length > maxLen
        ? issue.description.slice(0, maxLen) + "\n...[truncated]"
        : issue.description,
    );
  }

  return lines.join("\n");
};

export const formatCreatedIssue = (issue: IssueDetail): string =>
  `Created: ${issue.identifier} - ${issue.title}\nURL: ${issue.url}`;

export const formatComment = (id: string): string => `Comment added: ${id}`;

export const formatInboxCSV = (inbox: Inbox): string => {
  const lines: string[] = [
    `Inbox: ${inbox.summary.unread} unread of ${inbox.summary.total} total`,
  ];

  if (inbox.notifications.length === 0) {
    lines.push("No notifications.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("id,type,issue,title,actor,date");
  for (const n of inbox.notifications) {
    lines.push(
      [
        n.id,
        n.type,
        escapeField(n.issueIdentifier),
        escapeField(n.issueTitle || n.projectName),
        escapeField(n.actor),
        formatDate(n.createdAt),
      ].join(","),
    );
  }
  return lines.join("\n");
};

export const formatUsersCSV = (users: readonly LinearUser[]): string => {
  if (users.length === 0) return "No users found.";
  const header = "id,name,email,active,admin";
  const rows = users.map((u) =>
    [
      u.id,
      escapeField(u.name),
      escapeField(u.email),
      u.active ? "yes" : "no",
      u.admin ? "yes" : "no",
    ].join(","),
  );
  return [header, ...rows].join("\n");
};

export const formatCommentsCSV = (comments: readonly Comment[]): string => {
  if (comments.length === 0) return "No comments found.";
  const header = "date,issue,body";
  const rows = comments.map((c) => {
    const body = c.body.length > 100 ? c.body.slice(0, 100) + "..." : c.body;
    return [
      formatDate(c.createdAt),
      escapeField(c.issueIdentifier),
      escapeField(body.replace(/\n/g, " ")),
    ].join(",");
  });
  return [header, ...rows].join("\n");
};

export const formatActivityByDay = (activity: UserActivity): string => {
  const lines: string[] = [
    `Activity since ${activity.sinceDate}`,
    `Total: ${activity.summary.totalActivities} (${activity.summary.comments} comments, ${activity.summary.stateChanges} state changes, ${activity.summary.assignments} assignments, ${activity.summary.priorityChanges} priority changes)`,
    "",
  ];

  const days = Object.keys(activity.byDay).sort((a, b) => b.localeCompare(a));
  if (days.length === 0) {
    lines.push("No activity found.");
    return lines.join("\n");
  }

  for (const day of days) {
    const dayActivities = activity.byDay[day];
    if (!dayActivities || dayActivities.length === 0) continue;
    lines.push(`## ${day} (${dayActivities.length} activities)`);
    for (const a of dayActivities) {
      let detail = "";
      if (a.type === "comment" && a.details.body) detail = a.details.body;
      else if (a.type === "state_change")
        detail = `${a.details.fromState || "?"} → ${a.details.toState || "?"}`;
      else if (a.type === "priority_change")
        detail = `${formatPriority(a.details.fromPriority ?? 0)} → ${formatPriority(a.details.toPriority ?? 0)}`;
      else if (a.type === "assignment") detail = "self-assigned";
      lines.push(`- [${a.type}] ${a.issueIdentifier}: ${detail}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
};

export const formatHistoryEntries = (
  entries: readonly HistoryEntry[],
): string => {
  if (entries.length === 0) return "No history entries found.";
  const lines: string[] = [`History (${entries.length} entries)`, ""];

  for (const entry of entries) {
    const prefix = `${formatDate(entry.createdAt)} ${entry.actorName ? `- ${entry.actorName}:` : "-"}`;
    const changes: string[] = [];
    if (entry.fromState && entry.toState)
      changes.push(`${entry.fromState} → ${entry.toState}`);
    if (entry.fromAssignee || entry.toAssignee) {
      if (entry.toAssignee && !entry.fromAssignee)
        changes.push(`Assigned to ${entry.toAssignee}`);
      else if (!entry.toAssignee && entry.fromAssignee)
        changes.push(`Unassigned from ${entry.fromAssignee}`);
      else changes.push(`Reassigned: ${entry.fromAssignee} → ${entry.toAssignee}`);
    }
    if (entry.fromPriority !== undefined && entry.toPriority !== undefined)
      changes.push(
        `Priority: ${formatPriority(entry.fromPriority)} → ${formatPriority(entry.toPriority)}`,
      );
    if (entry.addedLabels?.length)
      changes.push(`Added labels: ${entry.addedLabels.join(", ")}`);
    if (entry.removedLabels?.length)
      changes.push(`Removed labels: ${entry.removedLabels.join(", ")}`);
    if (changes.length > 0) lines.push(`${prefix} ${changes.join("; ")}`);
  }

  return lines.join("\n");
};

export const formatProjectsCSV = (
  projects: readonly ProjectSummary[],
): string => {
  if (projects.length === 0) return "No projects found.";
  const header = "id,name,team,state,updated";
  const rows = projects.map((p) =>
    [p.id, escapeField(p.name), p.teamKey, p.state, formatDate(p.updatedAt)].join(
      ",",
    ),
  );
  return [header, ...rows].join("\n");
};

export const formatProjectDetail = (
  project: ProjectSummary,
  milestones: readonly ProjectMilestone[],
): string => {
  const lines = [
    `Project: ${project.name} (${project.teamKey}, ${project.state})`,
    `ID: ${project.id}`,
    "",
  ];
  if (milestones.length === 0) {
    lines.push("Milestones: none");
  } else {
    lines.push("Milestones:");
    lines.push("id,name,targetDate,progress");
    for (const m of milestones) {
      lines.push(
        [
          m.id,
          escapeField(m.name),
          m.targetDate ?? "-",
          `${Math.round(m.progress)}%`,
        ].join(","),
      );
    }
  }
  return lines.join("\n");
};

export const formatProjectStatuses = (
  statuses: readonly ProjectStatus[],
): string => {
  if (statuses.length === 0) return "No project statuses found.";
  const header = "id,name,type,position";
  const rows = statuses.map((s) =>
    [s.id, escapeField(s.name), s.type, s.position].join(","),
  );
  return [header, ...rows].join("\n");
};

export const formatCreatedProject = (project: CreatedProject): string => {
  const lines = [
    `Created project: ${project.id}`,
    `Name: ${project.name}`,
    `State: ${project.state}`,
  ];
  if (project.initiativeId)
    lines.push(`Initiative: linked (${project.initiativeId})`);
  if (project.url) lines.push(`URL: ${project.url}`);
  return lines.join("\n");
};

export const formatUpdatedProject = (project: UpdatedProject): string =>
  [
    `Updated project: ${project.id}`,
    `Name: ${project.name}`,
    `State: ${project.state}`,
    project.url ? `URL: ${project.url}` : undefined,
  ]
    .filter((l): l is string => l !== undefined)
    .join("\n");

export const formatCreatedMilestone = (milestone: ProjectMilestone): string => {
  const lines = [`Created milestone: ${milestone.id}`, `Name: ${milestone.name}`];
  if (milestone.targetDate) lines.push(`Target: ${milestone.targetDate}`);
  return lines.join("\n");
};

export const formatProjectUpdatePosted = (id: string): string =>
  `Project update posted: ${id}`;

export const formatCreatedDocument = (doc: CreatedDocument): string =>
  `Created: ${doc.title}\nURL: ${doc.url}`;

export const formatViewsCSV = (views: readonly CustomView[]): string => {
  if (views.length === 0) return "No views found.";
  const header = "id,name,shared,owner";
  const rows = views.map((v) =>
    [
      v.id,
      escapeField(v.name),
      v.shared ? "shared" : "private",
      escapeField(v.owner),
    ].join(","),
  );
  return [header, ...rows].join("\n");
};

export const formatFavoritesCSV = (favorites: readonly Favorite[]): string => {
  if (favorites.length === 0) return "No favorites found.";
  const header = "id,type,title,viewId,projectId,cycleId";
  const rows = favorites.map((f) =>
    [
      f.id,
      f.type,
      escapeField(f.title),
      f.viewId ?? "-",
      f.projectId ?? "-",
      f.cycleId ?? "-",
    ].join(","),
  );
  return [header, ...rows].join("\n");
};

export const formatCycles = (cycles: readonly Cycle[]): string => {
  if (cycles.length === 0) return "No cycles found.";
  const header = "id,number,name,starts,ends,completed,total,progress";
  const rows = cycles.map((c) =>
    [
      c.id,
      c.number,
      escapeField(c.name),
      formatDate(c.startsAt),
      formatDate(c.endsAt),
      c.completedIssueCount,
      c.totalIssueCount,
      `${Math.round(c.progress)}%`,
    ].join(","),
  );
  return [header, ...rows].join("\n");
};
