import { Args, Command } from "@effect/cli";
import { Effect } from "effect";
import { Linear } from "../client";
import * as fmt from "../formatters";
import { jsonOption, limitOpt, render } from "./common";

const views = Command.make("views", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const linear = yield* Linear;
    const data = yield* linear.listViews();
    yield* render(json, data, () => fmt.formatViewsCSV(data));
  }),
).pipe(Command.withDescription("List custom views."));

const view = Command.make(
  "view",
  {
    json: jsonOption,
    viewId: Args.text({ name: "view-id" }).pipe(
      Args.withDescription("Custom view id."),
    ),
    limit: limitOpt(50),
  },
  ({ json, viewId, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getViewIssues(viewId, limit);
      yield* render(json, data, () => fmt.formatIssueListCSV(data));
    }),
).pipe(Command.withDescription("List the issues in a custom view."));

const favorites = Command.make("favorites", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const linear = yield* Linear;
    const data = yield* linear.listFavorites();
    yield* render(json, data, () => fmt.formatFavoritesCSV(data));
  }),
).pipe(Command.withDescription("List favorited views, projects, and cycles."));

export const viewCommands = [views, view, favorites];
