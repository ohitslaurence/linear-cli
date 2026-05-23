import { Args, Command } from "@effect/cli";
import { Effect } from "effect";
import { Linear } from "../client";
import * as fmt from "../formatters";
import {
  intOpt,
  jsonOption,
  limitOpt,
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
      "Filter by state: active | completed | canceled, or a literal state name.",
    ),
    team: textOpt("team", "Filter by team key (e.g. SPR)."),
    project: textOpt("project", "Filter by project id."),
    cycle: textOpt("cycle", "Filter by cycle id."),
    limit: limitOpt(50),
  },
  ({ json, assignee, state, team, project, cycle, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.listIssues({
        assignee: orUndef(assignee),
        state: orUndef(state),
        team: orUndef(team),
        project: orUndef(project),
        cycle: orUndef(cycle),
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
    cycle: textOpt("cycle", "Cycle id."),
    milestone: textOpt("milestone", "Project milestone id."),
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
    cycle,
    milestone,
    parent,
  }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.createIssue({
        title,
        teamId: team,
        description: orUndef(description),
        priority: orUndef(priority),
        estimate: orUndef(estimate),
        assigneeId: orUndef(assignee),
        projectId: orUndef(project),
        stateId: orUndef(state),
        cycleId: orUndef(cycle),
        projectMilestoneId: orUndef(milestone),
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

export const issueCommands = [issue, issues, create, update, search, comment];
