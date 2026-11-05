import type {
  Comment,
  CreatedDocument,
  CreatedProject,
  CreatedView,
  Cycle,
  CustomView,
  DryRunReport,
  Favorite,
  HistoryEntry,
  Inbox,
  IssueComment,
  IssueDetail,
  IssueLabel,
  IssueSummary,
  LinearUser,
  PageInfo,
  Paged,
  ProjectDetail,
  ProjectLink,
  ProjectMilestone,
  ProjectStatus,
  ProjectSummary,
  TeamSummary,
  UpdatedProject,
  UserActivity,
  WorkflowState,
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

/**
 * Date *and* time, for anything ordered within a day.
 *
 * A four-hour response target cannot be judged against "Jul 30" on both the
 * question and the answer.
 */
const formatDateTime = (date: Date | string | undefined): string => {
  if (!date) return "-";
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
};

/** Stable machine-readable serialisation used by every command's `--json`. */
export const toJson = (data: unknown): string => JSON.stringify(data, null, 2);

/**
 * The "you are not seeing everything" line, appended to any truncated list.
 *
 * `--json` callers read `pageInfo.truncated`; a human reading CSV in a terminal
 * gets no such field, and a quietly-short list is exactly as misleading there.
 */
const truncationNote = (page: PageInfo): string | undefined => {
  if (!page.truncated) return undefined;
  const total =
    page.totalCount !== undefined ? ` of ${page.totalCount} matching` : "";
  return `\n(showing ${page.returned}${total} — more remain; raise --limit to see them)`;
};

/** Append the truncation note, if there is one, to a rendered list. */
const withPageNote = <T>(paged: Paged<T>, body: string): string =>
  body + (truncationNote(paged.pageInfo) ?? "");

export const formatIssueListCSV = (paged: Paged<IssueSummary>): string => {
  const issues = paged.items;
  if (issues.length === 0) return "No issues found.";
  const header = "id,title,state,assignee,due,labels,priority,team";
  const rows = issues.map((i) =>
    [
      i.identifier,
      escapeField(i.title),
      escapeField(i.state),
      escapeField(i.assignee),
      i.dueDate ?? "-",
      escapeField(i.labels.join(" ")),
      formatPriority(i.priority),
      escapeField(i.teamKey ?? i.team),
    ].join(","),
  );
  return withPageNote(paged, [header, ...rows].join("\n"));
};

export const formatStatesCSV = (paged: Paged<WorkflowState>): string => {
  if (paged.items.length === 0) return "No workflow states found.";
  const header = "team,name,type,id";
  const rows = paged.items.map((s) =>
    [s.teamKey ?? "-", escapeField(s.name), s.type, s.id].join(","),
  );
  return [header, ...rows].join("\n");
};

export const formatTeamsCSV = (paged: Paged<TeamSummary>): string => {
  if (paged.items.length === 0) return "No teams found.";
  const header = "key,name,id";
  const rows = paged.items.map((t) =>
    [t.key, escapeField(t.name), t.id].join(","),
  );
  return [header, ...rows].join("\n");
};

export const formatLabelsCSV = (paged: Paged<IssueLabel>): string => {
  if (paged.items.length === 0) return "No labels found.";
  const header = "name,group,id";
  const rows = paged.items.map((l) =>
    [escapeField(l.name), escapeField(l.group), l.id].join(","),
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

  // Sub-issues come before the links: a ticket with children is a container,
  // and knowing that changes whether the rest of the page is worth reading.
  if (issue.children.length > 0) {
    lines.push("");
    lines.push(`Sub-issues (${issue.children.length}):`);
    for (const child of issue.children) {
      lines.push(`  ${child.identifier} [${child.state ?? "-"}] ${child.title}`);
    }
  }

  if (issue.attachments.length > 0) {
    lines.push("");
    lines.push("Links:");
    for (const a of issue.attachments) {
      const source = a.sourceType ? `${a.sourceType}: ` : "";
      lines.push(`  ${source}${a.title || a.url}`);
      if (a.title) lines.push(`    ${a.url}`);
    }
  }

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

export const formatCreatedView = (view: CreatedView): string =>
  [
    `Created view: ${view.name}`,
    `ID: ${view.id}`,
    `Visibility: ${view.shared ? "shared with the workspace" : "private"}`,
  ].join("\n");

/**
 * One issue's comments, threaded.
 *
 * Replies are indented under the comment they answer, because a flat list of
 * an exchange reads as agreement when it may have been a correction.
 */
export const formatIssueComments = (paged: Paged<IssueComment>): string => {
  const comments = paged.items;
  if (comments.length === 0) return "No comments on this issue.";

  const replies = new Map<string, IssueComment[]>();
  const roots: IssueComment[] = [];
  for (const c of comments) {
    if (c.parentId === undefined) {
      roots.push(c);
      continue;
    }
    const siblings = replies.get(c.parentId) ?? [];
    siblings.push(c);
    replies.set(c.parentId, siblings);
  }

  const render = (c: IssueComment, depth: number): string[] => {
    const pad = "  ".repeat(depth);
    const head = `${pad}${formatDateTime(c.createdAt)} — ${c.author ?? "unknown"}${
      c.resolvedAt ? " (resolved)" : ""
    }`;
    const body = c.body
      .trim()
      .split("\n")
      .map((line) => `${pad}  ${line}`);
    return [head, ...body, "", ...(replies.get(c.id) ?? []).flatMap((r) => render(r, depth + 1))];
  };

  const orphans = comments.filter(
    (c) => c.parentId !== undefined && !comments.some((p) => p.id === c.parentId),
  );

  const lines = [
    `${comments.length} comment(s)`,
    "",
    ...roots.flatMap((c) => render(c, 0)),
    // A reply whose parent fell outside the page would otherwise vanish
    // entirely — worse than showing it unattached.
    ...orphans.flatMap((c) => render(c, 0)),
  ];
  return withPageNote(paged, lines.join("\n").trimEnd());
};

const formatFields = (fields: object): string[] =>
  Object.entries(fields)
    .filter((entry): entry is [string, unknown] => entry[1] !== undefined)
    .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);

export const formatDryRun = (report: DryRunReport): string => {
  const requested = formatFields(report.requested);
  const lines = [
    "DRY RUN — nothing was written.",
    `Operation: ${report.operation}`,
    `Targets (${report.targets.length}): ${report.targets.join(", ")}`,
    requested.length > 0 ? "Requested:" : "Requested: (nothing)",
    ...requested,
  ];
  for (const [index, resolved] of report.resolved.entries()) {
    lines.push(`Would send to ${report.targets[index] ?? "?"}:`);
    lines.push(...formatFields(resolved));
  }
  return lines.join("\n");
};

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
  return lines.join("\n") + (truncationNote(inbox.pageInfo) ?? "");
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

export const formatCommentsCSV = (paged: Paged<Comment>): string => {
  if (paged.items.length === 0) return "No comments found.";
  const header = "date,issue,author,body";
  const rows = paged.items.map((c) => {
    const body = c.body.length > 100 ? c.body.slice(0, 100) + "..." : c.body;
    return [
      formatDateTime(c.createdAt),
      escapeField(c.issueIdentifier),
      escapeField(c.author),
      escapeField(body.replace(/\n/g, " ")),
    ].join(",");
  });
  return withPageNote(paged, [header, ...rows].join("\n"));
};

export const formatViewer = (viewer: {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly displayName: string;
}): string =>
  [
    `${viewer.name} <${viewer.email}>`,
    `Display name: ${viewer.displayName}`,
    `User id: ${viewer.id}`,
  ].join("\n");

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

export const formatHistoryEntries = (paged: Paged<HistoryEntry>): string => {
  const entries = paged.items;
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
    if (entry.fromDueDate || entry.toDueDate) {
      if (entry.toDueDate && !entry.fromDueDate)
        changes.push(`Due date set: ${entry.toDueDate}`);
      else if (!entry.toDueDate && entry.fromDueDate)
        changes.push(`Due date cleared (was ${entry.fromDueDate})`);
      else changes.push(`Due date: ${entry.fromDueDate} → ${entry.toDueDate}`);
    }
    if (entry.addedLabels?.length)
      changes.push(`Added labels: ${entry.addedLabels.join(", ")}`);
    if (entry.removedLabels?.length)
      changes.push(`Removed labels: ${entry.removedLabels.join(", ")}`);
    if (changes.length > 0) lines.push(`${prefix} ${changes.join("; ")}`);
  }

  return lines.join("\n");
};

export const formatProjectsCSV = (paged: Paged<ProjectSummary>): string => {
  if (paged.items.length === 0) return "No projects found.";
  const header = "id,name,team,state,updated";
  const rows = paged.items.map((p) =>
    [p.id, escapeField(p.name), p.teamKey, p.state, formatDate(p.updatedAt)].join(
      ",",
    ),
  );
  return withPageNote(paged, [header, ...rows].join("\n"));
};

export const formatProjectDetail = (
  project: ProjectDetail,
  milestones: readonly ProjectMilestone[],
): string => {
  const lines = [
    `Project: ${project.name} (${project.teamKey}, ${project.status ?? project.state})`,
    `ID: ${project.id}`,
    `URL: ${project.url}`,
  ];
  if (project.lead) lines.push(`Lead: ${project.lead}`);
  if (project.startDate) lines.push(`Start: ${project.startDate}`);
  if (project.targetDate) lines.push(`Target: ${project.targetDate}`);
  lines.push("", `Summary: ${project.description ?? "(none)"}`);
  lines.push("", "--- Description ---", project.content ?? "(none)", "");
  if (milestones.length === 0) {
    lines.push("Milestones: none");
  } else {
    lines.push("Milestones:");
    lines.push("id,name,targetDate,progress,description");
    for (const m of milestones) {
      lines.push(
        [
          m.id,
          escapeField(m.name),
          m.targetDate ?? "-",
          `${Math.round(m.progress)}%`,
          escapeField(m.description ?? ""),
        ].join(","),
      );
    }
  }
  lines.push("");
  if (project.links.length === 0) {
    lines.push("Links: none");
  } else {
    lines.push("Links:");
    for (const l of project.links) lines.push(`- ${l.label}: ${l.url}`);
  }
  if (project.documents.length > 0) {
    lines.push("Documents:");
    for (const d of project.documents) lines.push(`- ${d.title}: ${d.url}`);
  }
  return lines.join("\n");
};

export const formatProjectStatuses = (paged: Paged<ProjectStatus>): string => {
  if (paged.items.length === 0) return "No project statuses found.";
  const header = "id,name,type,position";
  const rows = paged.items.map((s) =>
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

export const formatUpdatedMilestone = (milestone: ProjectMilestone): string => {
  const lines = [`Updated milestone: ${milestone.id}`, `Name: ${milestone.name}`];
  if (milestone.targetDate) lines.push(`Target: ${milestone.targetDate}`);
  return lines.join("\n");
};

export const formatCreatedProjectLink = (link: ProjectLink): string =>
  `Added link: ${link.label}\nURL: ${link.url}`;

export const formatProjectUpdatePosted = (id: string): string =>
  `Project update posted: ${id}`;

export const formatCreatedDocument = (doc: CreatedDocument): string =>
  `Created: ${doc.title}\nURL: ${doc.url}`;

export const formatViewsCSV = (paged: Paged<CustomView>): string => {
  if (paged.items.length === 0) return "No views found.";
  const header = "id,name,shared,owner";
  const rows = paged.items.map((v) =>
    [
      v.id,
      escapeField(v.name),
      v.shared ? "shared" : "private",
      escapeField(v.owner),
    ].join(","),
  );
  return [header, ...rows].join("\n");
};

export const formatFavoritesCSV = (paged: Paged<Favorite>): string => {
  if (paged.items.length === 0) return "No favorites found.";
  const header = "id,type,title,viewId,projectId,cycleId";
  const rows = paged.items.map((f) =>
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

export const formatCycles = (paged: Paged<Cycle>): string => {
  if (paged.items.length === 0) return "No cycles found.";
  const header = "id,number,name,starts,ends,completed,total,progress";
  const rows = paged.items.map((c) =>
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
