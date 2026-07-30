import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { Linear } from "../client";
import * as fmt from "../formatters";
import type { DryRunReport } from "../types";
import {
  dryRunOption,
  jsonOption,
  limitOpt,
  orUndef,
  render,
  reqText,
  textArg,
  textOpt,
} from "./common";

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
    viewId: textArg("view-id", "Custom view id."),
    limit: limitOpt(50),
  },
  ({ json, viewId, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getViewIssues(viewId, limit);
      yield* render(json, data, () => fmt.formatIssueListCSV(data));
    }),
).pipe(
  Command.withDescription(
    "List the issues in a custom view, with assignee, due date and labels.",
  ),
);

/**
 * Create a saved view from the same filter vocabulary `linear issues` uses.
 *
 * Set-up otherwise ends with "now go build this view in the UI" — the one step
 * a script cannot verify, and the one everybody gets slightly different.
 */
const viewCreate = Command.make(
  "view-create",
  {
    json: jsonOption,
    dryRun: dryRunOption,
    name: reqText("name", "View name."),
    description: textOpt("description", "What the view is for."),
    team: textOpt("team", "Scope to a team: key (SPR), name, or id."),
    private: Options.boolean("private").pipe(
      Options.withDescription(
        "Keep the view to yourself. Views are shared with the workspace by default, because a set-up step nobody else can see is one nobody else can follow.",
      ),
    ),
    assignee: textOpt("assignee", "Filter: 'me', an email, a display name, or an id."),
    state: textOpt("state", "Filter: open | active | completed | canceled, or a state name."),
    label: textOpt("label", "Filter by label name."),
    project: textOpt("project", "Filter by project id."),
  },
  ({ json, dryRun, name, description, team, private: isPrivate, assignee, state, label, project }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const teamValue = orUndef(team);
      const resolvedTeam = teamValue
        ? yield* linear.resolveTeam(teamValue)
        : undefined;
      const filter = {
        assignee: orUndef(assignee),
        state: orUndef(state),
        label: orUndef(label),
        project: orUndef(project),
        team: resolvedTeam?.key,
      };

      if (dryRun) {
        const report: DryRunReport = {
          dryRun: true,
          operation: "view-create",
          targets: [name],
          requested: { ...filter, name, team: teamValue, shared: !isPrivate },
          resolved: [{ name, teamId: resolvedTeam?.id, shared: !isPrivate }],
        };
        return yield* render(json, report, () => fmt.formatDryRun(report));
      }

      const data = yield* linear.createView({
        name,
        description: orUndef(description),
        teamId: resolvedTeam?.id,
        shared: !isPrivate,
        filter,
      });
      yield* render(json, data, () => fmt.formatCreatedView(data));
    }),
).pipe(
  Command.withDescription(
    "Create a saved view using the same filters as `linear issues`.",
  ),
);

const favorites = Command.make("favorites", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const linear = yield* Linear;
    const data = yield* linear.listFavorites();
    yield* render(json, data, () => fmt.formatFavoritesCSV(data));
  }),
).pipe(Command.withDescription("List favorited views, projects, and cycles."));

export const viewCommands = [views, view, viewCreate, favorites];
