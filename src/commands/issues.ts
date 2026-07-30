import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { Linear } from "../client";
import * as fmt from "../formatters";
import type { DryRunReport } from "../types";
import {
  dryRunOption,
  idsArg,
  intOpt,
  jsonOption,
  limitOpt,
  listOpt,
  orUndef,
  render,
  reqText,
  requireBody,
  textArg,
  textOpt,
} from "./common";

const issues = Command.make(
  "issues",
  {
    json: jsonOption,
    assignee: textOpt(
      "assignee",
      "Filter by assignee: 'me', an email, a display name, or a user id.",
    ),
    state: textOpt(
      "state",
      "Filter by state: open (not done/cancelled) | active | completed | canceled, or a literal state name.",
    ),
    team: textOpt("team", "Filter by team key (SPR), name, or id."),
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
    identifier: textArg("identifier", "Issue identifier, e.g. SPR-123."),
  },
  ({ json, identifier }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getIssue(identifier);
      yield* render(json, data, () => fmt.formatIssueDetail(data));
    }),
).pipe(Command.withDescription("Show full details for one issue."));

const comments = Command.make(
  "comments",
  {
    json: jsonOption,
    identifier: textArg("issue-id", "Issue identifier, e.g. SPR-123."),
    limit: limitOpt(100),
  },
  ({ json, identifier, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getIssueComments(identifier, limit);
      yield* render(json, data, () => fmt.formatIssueComments(data));
    }),
).pipe(
  Command.withDescription(
    "Read one issue's comments in order, with authors and thread structure.",
  ),
);

const create = Command.make(
  "create",
  {
    json: jsonOption,
    dryRun: dryRunOption,
    title: reqText("title", "Issue title."),
    team: reqText("team", "Team key (SPR), name, or id."),
    description: textOpt("description", "Issue description (markdown)."),
    priority: intOpt("priority", "Priority 0=none 1=urgent 2=high 3=medium 4=low."),
    estimate: intOpt("estimate", "Estimate in points."),
    assignee: textOpt("assignee", "Assignee: 'me', an email, a display name, or an id."),
    project: textOpt("project", "Project id."),
    state: textOpt("state", "Workflow state name (e.g. 'In Progress') or id."),
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
    dryRun,
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
      const resolvedTeam = yield* linear.resolveTeam(team);
      const labelIds = yield* linear.resolveLabelIds(label);
      const assigneeValue = orUndef(assignee);
      const stateValue = orUndef(state);

      const input = {
        title,
        teamId: resolvedTeam.id,
        description: orUndef(description),
        priority: orUndef(priority),
        estimate: orUndef(estimate),
        assigneeId: assigneeValue
          ? yield* linear.resolveUserId(assigneeValue)
          : undefined,
        projectId: orUndef(project),
        stateId: stateValue
          ? yield* linear.resolveStateId(stateValue, resolvedTeam.key)
          : undefined,
        dueDate: orUndef(dueDate),
        cycleId: orUndef(cycle),
        projectMilestoneId: orUndef(milestone),
        ...(labelIds.length > 0 ? { labelIds } : {}),
        parentId: orUndef(parent),
      };

      if (dryRun) {
        const report: DryRunReport = {
          dryRun: true,
          operation: "create",
          targets: [`new issue in ${resolvedTeam.key}`],
          requested: { title, team, assignee: assigneeValue, state: stateValue },
          resolved: [input],
        };
        return yield* render(json, report, () => fmt.formatDryRun(report));
      }

      const data = yield* linear.createIssue(input);
      yield* render(json, data, () => fmt.formatCreatedIssue(data));
    }),
).pipe(Command.withDescription("Create an issue (use --parent for a sub-issue)."));

/**
 * Update one issue, or several.
 *
 * The id argument takes a comma-separated list because the changes that matter
 * are rarely singular — "everything I planned yesterday moves out of today" is
 * one decision and used to be one API call per ticket.
 *
 * The result is always the `{items, pageInfo}` envelope, whether one issue was
 * updated or ten, so a caller never has to branch on how many it asked for.
 */
const update = Command.make(
  "update",
  {
    json: jsonOption,
    dryRun: dryRunOption,
    ids: idsArg("id", "Issue id or identifier. Comma-separate for a batch."),
    title: textOpt("title", "New title."),
    description: textOpt("description", "New description (markdown)."),
    priority: intOpt("priority", "Priority 0-4."),
    estimate: intOpt("estimate", "Estimate in points."),
    state: textOpt(
      "state",
      "Workflow state name (e.g. 'In Progress') or id. Names resolve against the issue's own team — see `linear states`.",
    ),
    dueDate: textOpt(
      "due-date",
      "Due date as YYYY-MM-DD. Set it whenever the ask names a deadline — an undated urgent ticket is indistinguishable from an undated one that isn't.",
    ),
    assignee: textOpt("assignee", "Assignee: 'me', an email, a display name, or an id."),
    project: textOpt("project", "Project id."),
    cycle: textOpt("cycle", "Cycle id."),
    milestone: textOpt("milestone", "Project milestone id."),
  },
  ({
    json,
    dryRun,
    ids,
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
      const request = {
        title: orUndef(title),
        description: orUndef(description),
        priority: orUndef(priority),
        estimate: orUndef(estimate),
        state: orUndef(state),
        dueDate: orUndef(dueDate),
        assignee: orUndef(assignee),
        project: orUndef(project),
        cycle: orUndef(cycle),
        milestone: orUndef(milestone),
      };

      if (dryRun) {
        const resolved = yield* Effect.forEach(ids, (id) =>
          linear.resolveIssueUpdate(id, request),
        );
        const report: DryRunReport = {
          dryRun: true,
          operation: "update",
          targets: [...ids],
          requested: request,
          resolved,
        };
        return yield* render(json, report, () => fmt.formatDryRun(report));
      }

      const data = yield* linear.updateIssues(ids, request);
      yield* render(json, data, () =>
        data.items.map((i) => fmt.formatIssueDetail(i)).join("\n\n---\n\n"),
      );
    }),
).pipe(
  Command.withDescription(
    "Update fields on one or more issues (comma-separate ids for a batch).",
  ),
);

const search = Command.make(
  "search",
  {
    json: jsonOption,
    query: textArg("query", "Full-text search query."),
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
    dryRun: dryRunOption,
    issueId: textArg("issue-id", "Issue id or identifier."),
    body: Args.text({ name: "body" }).pipe(
      Args.withDescription("Comment body."),
      Args.repeated,
    ),
  },
  ({ json, dryRun, issueId, body }) =>
    Effect.gen(function* () {
      // `Args.repeated` accepts zero occurrences, so this guard is what stops a
      // blank, customer-visible comment being posted by a script whose message
      // variable happened to be empty.
      const text = yield* requireBody("comment", body);
      if (dryRun) {
        const report: DryRunReport = {
          dryRun: true,
          operation: "comment",
          targets: [issueId],
          requested: { body: text },
          resolved: [{ issueId, body: text }],
        };
        return yield* render(json, report, () => fmt.formatDryRun(report));
      }
      const linear = yield* Linear;
      const id = yield* linear.addComment(issueId, text);
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
    dryRun: dryRunOption,
    id: textArg("issue-id", "Issue identifier, e.g. SPR-1234."),
    url: textArg("slack-url", "Slack message or thread permalink."),
    noSync: Options.boolean("no-sync").pipe(
      Options.withDescription(
        "Record the link privately: it appears on the issue in Linear, and nothing is posted to Slack. Use for threads where the ticket must stay internal.",
      ),
    ),
  },
  ({ json, dryRun, id, url, noSync }) =>
    Effect.gen(function* () {
      if (dryRun) {
        const report: DryRunReport = {
          dryRun: true,
          operation: "attach-slack",
          targets: [id],
          requested: { url, syncToCommentThread: !noSync },
          resolved: [{ issue: id, url, syncToCommentThread: !noSync }],
        };
        return yield* render(json, report, () => fmt.formatDryRun(report));
      }
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
const labelChange = (
  name: "label" | "unlabel",
  description: string,
  argHelp: string,
) =>
  Command.make(
    name,
    {
      json: jsonOption,
      dryRun: dryRunOption,
      ids: idsArg("id", "Issue identifier(s), comma-separated, e.g. SPR-1,SPR-2."),
      names: idsArg("labels", argHelp),
    },
    ({ json, dryRun, ids, names }) =>
      Effect.gen(function* () {
        const linear = yield* Linear;
        const opts = name === "label" ? { add: names } : { remove: names };
        if (dryRun) {
          const labelIds = yield* linear.resolveLabelIds(names);
          const report: DryRunReport = {
            dryRun: true,
            operation: name,
            targets: [...ids],
            requested: { labels: names },
            resolved: ids.map(() => ({ [`${name}Ids`]: labelIds })),
          };
          return yield* render(json, report, () => fmt.formatDryRun(report));
        }
        const data = yield* linear.changeLabelsOn(ids, opts);
        yield* render(json, data, () =>
          data.items
            .map((i) => `${i.identifier} labels: ${i.labels.join(", ") || "(none)"}`)
            .join("\n"),
        );
      }),
  ).pipe(Command.withDescription(description));

const label = labelChange(
  "label",
  "Add labels to one or more issues, keeping existing ones.",
  "Label names to add, comma-separated. Must already exist.",
);

const unlabel = labelChange(
  "unlabel",
  "Remove labels from one or more issues, keeping the rest.",
  "Label names to remove, comma-separated.",
);

const labels = Command.make(
  "labels",
  { json: jsonOption, team: textOpt("team", "Scope to a team key (e.g. SPR).") },
  ({ json, team }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.listLabels(orUndef(team));
      yield* render(json, data, () => fmt.formatLabelsCSV(data));
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
    team: textOpt("team", "Team key, name, or id to scope it to. Omit for a workspace label."),
    color: textOpt("color", "Hex colour, e.g. #f2994a."),
    description: textOpt("description", "What the label means."),
  },
  ({ json, name, team, color, description }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const teamValue = orUndef(team);
      const data = yield* linear.createLabel({
        name,
        teamId: teamValue ? (yield* linear.resolveTeam(teamValue)).id : undefined,
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

/**
 * Without this, `--state` meant "paste a UUID you have no way to look up", and
 * so every state write was effectively unavailable.
 */
const states = Command.make(
  "states",
  {
    json: jsonOption,
    team: textOpt("team", "Scope to one team: key (SPR), name, or id."),
  },
  ({ json, team }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.listStates(orUndef(team));
      yield* render(json, data, () => fmt.formatStatesCSV(data));
    }),
).pipe(
  Command.withDescription(
    "List workflow states with their ids, per team.",
  ),
);

const teams = Command.make("teams", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const linear = yield* Linear;
    const data = yield* linear.listTeams();
    yield* render(json, data, () => fmt.formatTeamsCSV(data));
  }),
).pipe(Command.withDescription("List teams with their keys and ids."));

export const issueCommands = [
  issue,
  issues,
  comments,
  create,
  update,
  search,
  comment,
  attachSlack,
  label,
  unlabel,
  labels,
  labelCreate,
  states,
  teams,
];
