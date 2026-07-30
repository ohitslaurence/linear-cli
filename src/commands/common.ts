import { Args, HelpDoc, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { ValidationError } from "../errors";
import { toJson } from "../formatters";
import { writeOut } from "../output";

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

/**
 * `--dry-run` — resolve everything, write nothing.
 *
 * Present on every mutating command so an approval gate can be mechanical
 * ("run it with --dry-run, show me the diff, then run it for real") instead of
 * a paragraph of prose asking the operator to be careful.
 */
export const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription(
    "Resolve and print the change that would be made, then exit without writing.",
  ),
);

/**
 * Why blank values are rejected rather than ignored.
 *
 * An unset `$MY_UUID` expands to the empty string, so `--assignee "$MY_UUID"`
 * arrives as `--assignee ""`. Treating that as "no filter" is the difference
 * between "my issues" and "the whole team's issues" — and for a write, between
 * clearing one person's labels and clearing everyone's. The guard has to fail
 * loudly, because by the time the output looks wrong the damage is done.
 */
const blankMessage = (name: string): string =>
  `'${name}' was given an empty value. Empty is not the same as absent — it ` +
  `almost always means a shell variable was unset. Supply a value, or drop ` +
  `the argument entirely if you meant "no filter".`;

const trimmedOrNone = (raw: string): Option.Option<string> => {
  const value = raw.trim();
  return value.length > 0 ? Option.some(value) : Option.none();
};

/** An optional string option → `string | undefined` in the handler. Rejects blanks. */
export const textOpt = (name: string, description: string) =>
  Options.text(name).pipe(
    Options.filterMap(trimmedOrNone, blankMessage(`--${name}`)),
    Options.withDescription(description),
    Options.optional,
  );

/** A required string option. Rejects blanks. */
export const reqText = (name: string, description: string) =>
  Options.text(name).pipe(
    Options.filterMap(trimmedOrNone, blankMessage(`--${name}`)),
    Options.withDescription(description),
  );

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

/** A required positional argument. Rejects blanks, for the same reason flags do. */
export const textArg = (name: string, description: string): Args.Args<string> =>
  Args.text({ name }).pipe(
    Args.withDescription(description),
    Args.mapEffect((raw) =>
      Option.match(trimmedOrNone(raw), {
        onNone: () => Effect.fail(HelpDoc.p(blankMessage(`<${name}>`))),
        onSome: Effect.succeed,
      }),
    ),
  );

/**
 * A positional taking one id or several, comma-separated.
 *
 * Batch form exists because the morning routine is inherently plural: clearing
 * yesterday's `today` label off eight issues was eight round trips, each with
 * its own chance to fail halfway.
 */
export const idsArg = (
  name: string,
  description: string,
): Args.Args<readonly string[]> =>
  textArg(name, description).pipe(Args.map(splitList));

export const orUndef = Option.getOrUndefined;

/** Render a result as JSON (`--json`) or via a lazily-built text representation. */
export const render = (
  json: boolean,
  data: unknown,
  text: () => string,
): Effect.Effect<void> => writeOut(json ? toJson(data) : text());

const splitList = (raw: string): readonly string[] =>
  raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

/**
 * Comma-separated option → `string[]` (empty when absent).
 *
 * Used for labels, where "one or several" is the normal case and forcing
 * repeated flags for the common one would be worse than parsing a comma.
 */
export const listOpt = (name: string, description: string) =>
  Options.text(name).pipe(
    Options.filterMap(
      (raw) => {
        const parts = splitList(raw);
        return parts.length > 0 ? Option.some(parts) : Option.none();
      },
      blankMessage(`--${name}`),
    ),
    Options.withDescription(description),
    Options.optional,
    Options.map(Option.getOrElse((): readonly string[] => [])),
  );

/**
 * Join a `repeated` text argument back into one body, rejecting an empty result.
 *
 * `Args.repeated` accepts zero occurrences, so `linear comment SPR-1` with no
 * body parsed cleanly and posted an empty, customer-visible comment.
 */
export const requireBody = (
  operation: string,
  parts: readonly string[],
): Effect.Effect<string, ValidationError> => {
  const body = parts.join(" ").trim();
  return body.length > 0
    ? Effect.succeed(body)
    : Effect.fail(
        new ValidationError({
          operation,
          field: "body",
          message: "Refusing to post an empty body. Supply the text to write.",
        }),
      );
};
