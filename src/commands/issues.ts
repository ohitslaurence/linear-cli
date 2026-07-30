import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { Linear } from "../client";
import * as fmt from "../formatters";
import {
  intOpt,
  jsonOption,
  limitOpt,
  listOpt,
  orUndef,
  render,
  reqText,
  textOpt,
} from "./common";

const issues = Command.make(
  "issues",
  {
    json: jsonOption,
    assignee: textOpt("assignee", "Filter by assignee id, or 'me'."),
    state: textOpt(
      "state",
      "Filter by state: open (not done/cancelled) | active | completed | canceled, or a literal state name.",
    ),
    team: textOpt("team", "Filter by team key (e.g. SPR)."),
    project: textOpt("project", "Filter by project id."),
    cycle: textOpt("cycle", "Filter by cycle id."),
    label: textOpt("label", "Filter by label name (e.g. today). Case-insensitive."),
    limit: limitOpt(50),
  },
  ({ json, assignee, state, team, project, cycle, label, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.listIssues({
        assignee: orUndef(assignee),
        state: orUndef(state),
        team: orUndef(team),
        project: orUndef(project),
        cycle: orUndef(cycle),
        label: orUndef(label),
        limit,
      });
      yield* render(json, data, () => fmt.formatIssueListCSV(data));
    }),
).pipe(Command.withDescription("List issues with optional filters."));

const issue = Command.make(
  "issue",
  {
    json: jsonOption,
    identifier: Args.text({ name: "identifier" }).pipe(
      Args.withDescription("Issue identifier, e.g. SPR-123."),
    ),
  },
  ({ json, identifier }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getIssue(identifier);
      yield* render(json, data, () => fmt.formatIssueDetail(data));
    }),
).pipe(Command.withDescription("Show full details for one issue."));

const create = Command.make(
  "create",
  {
    json: jsonOption,
    title: reqText("title", "Issue title."),
    team: reqText("team", "Team id the issue belongs to."),
    description: textOpt("description", "Issue description (markdown)."),
    priority: intOpt("priority", "Priority 0=none 1=urgent 2=high 3=medium 4=low."),
    estimate: intOpt("estimate", "Estimate in points."),
    assignee: textOpt("assignee", "Assignee user id."),
    project: textOpt("project", "Project id."),
    state: textOpt("state", "Workflow state id."),
    dueDate: textOpt(
      "due-date",
      "Due date as YYYY-MM-DD. Set it whenever the ask names a deadline — an undated urgent ticket is indistinguishable from an undated one that isn't.",
    ),
    cycle: textOpt("cycle", "Cycle id."),
    milestone: textOpt("milestone", "Project milestone id."),
    label: listOpt("label", "Label names, comma-separated. Must already exist — see `linear labels`."),
    parent: textOpt("parent", "Parent issue id or identifier (creates a sub-issue)."),
  },
  ({
    json,
    title,
    team,
    description,
    priority,
    estimate,
    assignee,
    project,
    state,
    dueDate,
    cycle,
    milestone,
    label,
    parent,
  }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const labelIds = yield* linear.resolveLabelIds(label);
      const data = yield* linear.createIssue({
        title,
        teamId: team,
        description: orUndef(description),
        priority: orUndef(priority),
        estimate: orUndef(estimate),
        assigneeId: orUndef(assignee),
        projectId: orUndef(project),
        stateId: orUndef(state),
        dueDate: orUndef(dueDate),
        cycleId: orUndef(cycle),
        projectMilestoneId: orUndef(milestone),
        ...(labelIds.length > 0 ? { labelIds } : {}),
        parentId: orUndef(parent),
      });
      yield* render(json, data, () => fmt.formatCreatedIssue(data));
    }),
).pipe(Command.withDescription("Create an issue (use --parent for a sub-issue)."));

const update = Command.make(
  "update",
  {
    json: jsonOption,
    id: Args.text({ name: "id" }).pipe(
      Args.withDescription("Issue id or identifier."),
    ),
    title: textOpt("title", "New title."),
    description: textOpt("description", "New description (markdown)."),
    priority: intOpt("priority", "Priority 0-4."),
    estimate: intOpt("estimate", "Estimate in points."),
    state: textOpt("state", "Workflow state id."),
    dueDate: textOpt(
      "due-date",
      "Due date as YYYY-MM-DD. Set it whenever the ask names a deadline — an undated urgent ticket is indistinguishable from an undated one that isn't.",
    ),
    assignee: textOpt("assignee", "Assignee user id."),
    project: textOpt("project", "Project id."),
    cycle: textOpt("cycle", "Cycle id."),
    milestone: textOpt("milestone", "Project milestone id."),
  },
  ({
    json,
    id,
    title,
    description,
    priority,
    estimate,
    state,
    dueDate,
    assignee,
    project,
    cycle,
    milestone,
  }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.updateIssue(id, {
        title: orUndef(title),
        description: orUndef(description),
        priority: orUndef(priority),
        estimate: orUndef(estimate),
        stateId: orUndef(state),
        dueDate: orUndef(dueDate),
        assigneeId: orUndef(assignee),
        projectId: orUndef(project),
        cycleId: orUndef(cycle),
        projectMilestoneId: orUndef(milestone),
      });
      yield* render(json, data, () => fmt.formatIssueDetail(data));
    }),
).pipe(Command.withDescription("Update fields on an existing issue."));

const search = Command.make(
  "search",
  {
    json: jsonOption,
    query: Args.text({ name: "query" }).pipe(
      Args.withDescription("Full-text search query."),
    ),
    limit: limitOpt(50),
  },
  ({ json, query, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.searchIssues(query, limit);
      yield* render(json, data, () => fmt.formatIssueListCSV(data));
    }),
).pipe(Command.withDescription("Full-text search across issues."));

const comment = Command.make(
  "comment",
  {
    json: jsonOption,
    issueId: Args.text({ name: "issue-id" }).pipe(
      Args.withDescription("Issue id or identifier."),
    ),
    body: Args.text({ name: "body" }).pipe(
      Args.withDescription("Comment body."),
      Args.repeated,
    ),
  },
  ({ json, issueId, body }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const id = yield* linear.addComment(issueId, body.join(" "));
      yield* render(json, { id }, () => fmt.formatComment(id));
    }),
).pipe(Command.withDescription("Add a comment to an issue."));


/**
 * Linking is opt-in rather than automatic on create, because whether a Slack
 * thread should see an issue depends on who is in it. An internal thread wants
 * the link so the asker can follow the work; a thread shared with a customer,
 * partner or auditor should not receive internal identifiers.
 */
const attachSlack = Command.make(
  "attach-slack",
  {
    json: jsonOption,
    id: Args.text({ name: "issue-id" }).pipe(
      Args.withDescription("Issue identifier, e.g. SPR-1234."),
    ),
    url: Args.text({ name: "slack-url" }).pipe(
      Args.withDescription("Slack message or thread permalink."),
    ),
    noSync: Options.boolean("no-sync").pipe(
      Options.withDescription(
        "Record the link privately: it appears on the issue in Linear, and nothing is posted to Slack. Use for threads where the ticket must stay internal.",
      ),
    ),
  },
  ({ json, id, url, noSync }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.linkSlackThread(id, url, !noSync);
      yield* render(json, data, () =>
        `Linked ${data.issue} ↔ Slack thread.\n${data.issueUrl}\n` +
          (data.syncToCommentThread
            ? "Slack: Linear posted the issue in the thread; replies sync as comments both ways."
            : "Slack: nothing posted — the link is visible only from Linear."),
      );
    }),
).pipe(
  Command.withDescription(
    "Link a Slack thread to an issue, so the thread gets status updates.",
  ),
);

/**
 * Add and remove labels without touching the rest.
 *
 * Deliberately not a `--label` flag on `update`. Linear's update mutation takes
 * `labelIds` as the complete set, so a flag that reads like "add this label"
 * would silently drop every other label on the issue. Separate verbs make the
 * intent unambiguous and the read-merge-write happens in the client.
 */
const label = Command.make(
  "label",
  {
    json: jsonOption,
    id: Args.text({ name: "id" }).pipe(
      Args.withDescription("Issue identifier, e.g. SPR-1234."),
    ),
    names: Args.text({ name: "labels" }).pipe(
      Args.withDescription("Label names, comma-separated. Must already exist."),
    ),
  },
  ({ json, id, names }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const add = names
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
      const data = yield* linear.changeLabels(id, { add });
      yield* render(json, data, () =>
        `${data.identifier} labels: ${data.labels.join(", ") || "(none)"}`,
      );
    }),
).pipe(Command.withDescription("Add labels to an issue, keeping existing ones."));

const unlabel = Command.make(
  "unlabel",
  {
    json: jsonOption,
    id: Args.text({ name: "id" }).pipe(
      Args.withDescription("Issue identifier, e.g. SPR-1234."),
    ),
    names: Args.text({ name: "labels" }).pipe(
      Args.withDescription("Label names to remove, comma-separated."),
    ),
  },
  ({ json, id, names }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const remove = names
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
      const data = yield* linear.changeLabels(id, { remove });
      yield* render(json, data, () =>
        `${data.identifier} labels: ${data.labels.join(", ") || "(none)"}`,
      );
    }),
).pipe(Command.withDescription("Remove labels from an issue, keeping the rest."));

const labels = Command.make(
  "labels",
  { json: jsonOption, team: textOpt("team", "Scope to a team key (e.g. SPR).") },
  ({ json, team }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.listLabels(orUndef(team));
      yield* render(json, data, () =>
        ["name,group,id", ...data.map((l) => `${l.name},${l.group ?? "-"},${l.id}`)].join(
          "\n",
        ),
      );
    }),
).pipe(
  Command.withDescription(
    "List labels by name, so --label never means pasting a UUID.",
  ),
);

const labelCreate = Command.make(
  "label-create",
  {
    json: jsonOption,
    name: reqText("name", "Label name."),
    team: textOpt("team", "Team id to scope it to. Omit for a workspace label."),
    color: textOpt("color", "Hex colour, e.g. #f2994a."),
    description: textOpt("description", "What the label means."),
  },
  ({ json, name, team, color, description }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.createLabel({
        name,
        teamId: orUndef(team),
        color: orUndef(color),
        description: orUndef(description),
      });
      yield* render(json, data, () => `${data.name} — ${data.id}`);
    }),
).pipe(
  Command.withDescription(
    "Create a label. Idempotent: returns the existing label if the name is taken.",
  ),
);

export const issueCommands = [
  issue,
  issues,
  create,
  update,
  search,
  comment,
  attachSlack,
  label,
  unlabel,
  labels,
  labelCreate,
];
