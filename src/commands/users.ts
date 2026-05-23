import { Args, Command } from "@effect/cli";
import { Effect } from "effect";
import { Linear } from "../client";
import * as fmt from "../formatters";
import { jsonOption, limitOpt, orUndef, render, textOpt } from "./common";

const users = Command.make("users", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const linear = yield* Linear;
    const data = yield* linear.listUsers();
    yield* render(json, data, () => fmt.formatUsersCSV(data));
  }),
).pipe(Command.withDescription("List workspace users."));

const userIssues = Command.make(
  "user-issues",
  {
    json: jsonOption,
    userId: Args.text({ name: "user-id" }).pipe(
      Args.withDescription("User id."),
    ),
    state: textOpt("state", "Filter by state (active | completed | canceled)."),
    limit: limitOpt(100),
  },
  ({ json, userId, state, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getUserIssues(userId, orUndef(state), limit);
      yield* render(json, data, () => fmt.formatIssueListCSV(data));
    }),
).pipe(Command.withDescription("List issues assigned to a user."));

const userComments = Command.make(
  "user-comments",
  {
    json: jsonOption,
    userId: Args.text({ name: "user-id" }).pipe(
      Args.withDescription("User id."),
    ),
    since: textOpt("since", "Only comments on/after this date (YYYY-MM-DD)."),
    limit: limitOpt(100),
  },
  ({ json, userId, since, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getUserComments(userId, orUndef(since), limit);
      yield* render(json, data, () => fmt.formatCommentsCSV(data));
    }),
).pipe(Command.withDescription("List comments authored by a user."));

const userActivity = Command.make(
  "user-activity",
  {
    json: jsonOption,
    userId: Args.text({ name: "user-id" }).pipe(
      Args.withDescription("User id."),
    ),
    since: textOpt("since", "Activity on/after this date (default: 30 days ago)."),
  },
  ({ json, userId, since }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getUserActivity(userId, orUndef(since));
      yield* render(json, data, () => fmt.formatActivityByDay(data));
    }),
).pipe(Command.withDescription("Summarise a user's recent activity by day."));

const issueHistory = Command.make(
  "issue-history",
  {
    json: jsonOption,
    issueId: Args.text({ name: "issue-id" }).pipe(
      Args.withDescription("Issue id or identifier."),
    ),
  },
  ({ json, issueId }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getIssueHistory(issueId);
      yield* render(json, data, () => fmt.formatHistoryEntries(data));
    }),
).pipe(Command.withDescription("Show the change history of an issue."));

export const userCommands = [
  users,
  userIssues,
  userComments,
  userActivity,
  issueHistory,
];
