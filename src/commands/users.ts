import { Command } from "@effect/cli";
import { Effect } from "effect";
import { Linear, parseSince } from "../client";
import * as fmt from "../formatters";
import {
  jsonOption,
  limitOpt,
  orUndef,
  render,
  textArg,
  textOpt,
} from "./common";

const users = Command.make("users", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const linear = yield* Linear;
    const data = yield* linear.listUsers();
    yield* render(json, data, () => fmt.formatUsersCSV(data));
  }),
).pipe(Command.withDescription("List workspace users."));

/**
 * The authenticated identity, on its own and machine-readable.
 *
 * Set-up scripts need to *verify* whose key they are holding, not parse it out
 * of an auth-status sentence. Running someone else's routine against your key
 * aims every subsequent write at the wrong person's day, and it looks like it
 * worked.
 */
const whoami = Command.make("whoami", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const linear = yield* Linear;
    const data = yield* linear.whoami();
    yield* render(json, data, () => fmt.formatViewer(data));
  }),
).pipe(
  Command.withDescription("Show the user the current API key belongs to."),
);

/** `me` is accepted anywhere a user is named, including here. */
const userArg = textArg(
  "user",
  "User: 'me', an email, a display name, or a user id.",
);

const userIssues = Command.make(
  "user-issues",
  {
    json: jsonOption,
    user: userArg,
    state: textOpt("state", "Filter by state (open | active | completed | canceled)."),
    limit: limitOpt(100),
  },
  ({ json, user, state, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const userId = yield* linear.resolveUserId(user);
      const data = yield* linear.getUserIssues(userId, orUndef(state), limit);
      yield* render(json, data, () => fmt.formatIssueListCSV(data));
    }),
).pipe(Command.withDescription("List issues assigned to a user."));

const sinceOpt = textOpt(
  "since",
  "Only on/after this point: YYYY-MM-DD, or an ISO-8601 instant such as 2026-07-30T14:30:00Z when ordering within a day matters.",
);

const userComments = Command.make(
  "user-comments",
  {
    json: jsonOption,
    user: userArg,
    since: sinceOpt,
    limit: limitOpt(100),
  },
  ({ json, user, since, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const userId = yield* linear.resolveUserId(user);
      const sinceValue = orUndef(since);
      const from = sinceValue
        ? yield* parseSince("user-comments", sinceValue)
        : undefined;
      const data = yield* linear.getUserComments(userId, from, limit);
      yield* render(json, data, () => fmt.formatCommentsCSV(data));
    }),
).pipe(
  Command.withDescription(
    "List comments authored by a user. For one issue's full thread, use `linear comments`.",
  ),
);

const userActivity = Command.make(
  "user-activity",
  {
    json: jsonOption,
    user: userArg,
    since: sinceOpt,
  },
  ({ json, user, since }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const userId = yield* linear.resolveUserId(user);
      const sinceValue = orUndef(since);
      const from = sinceValue
        ? yield* parseSince("user-activity", sinceValue)
        : undefined;
      const data = yield* linear.getUserActivity(userId, from);
      yield* render(json, data, () => fmt.formatActivityByDay(data));
    }),
).pipe(Command.withDescription("Summarise a user's recent activity by day."));

const issueHistory = Command.make(
  "issue-history",
  {
    json: jsonOption,
    issueId: textArg("issue-id", "Issue id or identifier."),
  },
  ({ json, issueId }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getIssueHistory(issueId);
      yield* render(json, data, () => fmt.formatHistoryEntries(data));
    }),
).pipe(Command.withDescription("Show the change history of an issue."));

export const userCommands = [
  whoami,
  users,
  userIssues,
  userComments,
  userActivity,
  issueHistory,
];
