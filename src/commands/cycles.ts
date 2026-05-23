import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { Linear } from "../client";
import * as fmt from "../formatters";
import { jsonOption, orUndef, render } from "./common";

const cycles = Command.make(
  "cycles",
  {
    json: jsonOption,
    teamId: Args.text({ name: "team-id" }).pipe(
      Args.withDescription("Team id."),
    ),
    type: Options.choice("type", ["current", "previous", "next"]).pipe(
      Options.withDescription("Which cycles to show."),
      Options.optional,
    ),
  },
  ({ json, teamId, type }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.listCycles(teamId, orUndef(type));
      yield* render(json, data, () => fmt.formatCycles(data));
    }),
).pipe(Command.withDescription("List cycles for a team."));

export const cycleCommands = [cycles];
