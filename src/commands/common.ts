import { Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { toJson } from "../formatters";

/**
 * Shared building blocks for the command layer.
 *
 * Every command carries `--json` and renders through {@link render}, so the two
 * output modes (human text/CSV vs. stable JSON) stay consistent across the CLI.
 */

/** `--json` flag — present on every command. */
export const jsonOption = Options.boolean("json").pipe(
  Options.withDescription(
    "Emit stable, machine-readable JSON instead of human text/CSV.",
  ),
);

/** An optional string option → `string | undefined` in the handler. */
export const textOpt = (name: string, description: string) =>
  Options.text(name).pipe(Options.withDescription(description), Options.optional);

/** A required string option. */
export const reqText = (name: string, description: string) =>
  Options.text(name).pipe(Options.withDescription(description));

/** An optional integer option → `number | undefined` in the handler. */
export const intOpt = (name: string, description: string) =>
  Options.integer(name).pipe(
    Options.withDescription(description),
    Options.optional,
  );

/** An integer option with a default. */
export const limitOpt = (fallback: number) =>
  Options.integer("limit").pipe(
    Options.withDescription(`Maximum results (default ${fallback}).`),
    Options.withDefault(fallback),
  );

export const orUndef = Option.getOrUndefined;

/** Render a result as JSON (`--json`) or via a lazily-built text representation. */
export const render = (
  json: boolean,
  data: unknown,
  text: () => string,
): Effect.Effect<void> => Console.log(json ? toJson(data) : text());
