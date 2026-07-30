import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { Linear } from "../client";
import * as fmt from "../formatters";
import { jsonOption, orUndef, render, textArg } from "./common";

const cycles = Command.make(
  "cycles",
  {
    json: jsonOption,
    // Takes a key, name or id like every other team argument. It used to
    // require the UUID while `issues --team` required the key, and passing the
    // wrong one returned an empty list rather than an error.
    team: textArg("team", "Team key (SPR), name, or id."),
    type: Options.choice("type", ["current", "previous", "next"]).pipe(
      Options.withDescription("Which cycles to show."),
      Options.optional,
    ),
  },
  ({ json, team, type }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.listCycles(team, orUndef(type));
      yield* render(json, data, () => fmt.formatCycles(data));
    }),
).pipe(Command.withDescription("List cycles for a team."));

export const cycleCommands = [cycles];
