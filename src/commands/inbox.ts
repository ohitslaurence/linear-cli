import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { Linear } from "../client";
import * as fmt from "../formatters";
import { jsonOption, limitOpt, render } from "./common";

const inbox = Command.make(
  "inbox",
  {
    json: jsonOption,
    unread: Options.boolean("unread").pipe(
      Options.withDescription("Show unread notifications only."),
    ),
    limit: limitOpt(50),
  },
  ({ json, unread, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getInbox({ unreadOnly: unread, limit });
      yield* render(json, data, () => fmt.formatInboxCSV(data));
    }),
).pipe(
  Command.withDescription(
    "List inbox notifications (read + unread; --unread for unread only).",
  ),
);

const markRead = Command.make(
  "mark-read",
  {
    json: jsonOption,
    id: Args.text({ name: "notification-id" }).pipe(
      Args.withDescription("Notification id."),
    ),
  },
  ({ json, id }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      yield* linear.markNotificationRead(id);
      yield* render(json, { id, status: "read" }, () => "Marked as read.");
    }),
).pipe(Command.withDescription("Mark a notification as read."));

const markAllRead = Command.make("mark-all-read", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const linear = yield* Linear;
    yield* linear.markAllNotificationsRead();
    yield* render(json, { status: "all-read" }, () =>
      "All notifications marked as read.",
    );
  }),
).pipe(Command.withDescription("Mark every notification as read."));

const archive = Command.make(
  "archive",
  {
    json: jsonOption,
    id: Args.text({ name: "notification-id" }).pipe(
      Args.withDescription("Notification id."),
    ),
  },
  ({ json, id }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      yield* linear.archiveNotification(id);
      yield* render(json, { id, status: "archived" }, () =>
        "Notification archived.",
      );
    }),
).pipe(Command.withDescription("Archive a notification."));

const archiveRead = Command.make("archive-read", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const linear = yield* Linear;
    const data = yield* linear.archiveAllRead();
    yield* render(json, data, () =>
      `Archived ${data.archived} read notification(s).`,
    );
  }),
).pipe(Command.withDescription("Archive all read notifications."));

export const inboxCommands = [inbox, markRead, markAllRead, archive, archiveRead];
