#!/usr/bin/env bun
import { Command, HelpDoc, ValidationError as CliValidationError } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { ConfigError, Effect, Layer } from "effect";
import { Linear } from "./client";
import { ConfigProviderLive } from "./config";
import {
  ExitCode,
  LinearAuthError,
  ValidationError,
  errorPayload,
  type LinearCliError,
} from "./errors";
import { toJson } from "./formatters";
import { writeErr, writeOut } from "./output";
import { authCommands } from "./commands/auth";
import { cycleCommands } from "./commands/cycles";
import { docCommands } from "./commands/docs";
import { inboxCommands } from "./commands/inbox";
import { issueCommands } from "./commands/issues";
import { projectCommands } from "./commands/projects";
import { userCommands } from "./commands/users";
import { viewCommands } from "./commands/views";

const [firstCommand, ...restCommands] = [
  ...authCommands,
  ...issueCommands,
  ...inboxCommands,
  ...userCommands,
  ...projectCommands,
  ...docCommands,
  ...viewCommands,
  ...cycleCommands,
];

const root = Command.make("linear", {}, () =>
  writeOut(
    "linear — a fast CLI for Linear.\nRun `linear --help` to see all commands, or `linear <command> --help` for one.",
  ),
).pipe(
  Command.withDescription("A fast CLI for Linear, for humans and AI agents."),
  Command.withSubcommands([firstCommand!, ...restCommands]),
);

const cli = Command.run(root, {
  name: "Linear CLI",
  version: "0.1.0",
});

/** Application services: the Linear client, built from config. */
const MainLayer = Layer.mergeAll(
  Linear.Default.pipe(Layer.provide(ConfigProviderLive)),
  BunContext.layer,
);

/**
 * Whether the caller asked for machine-readable output.
 *
 * Read from the raw argv rather than the parsed options because failures
 * happen on both sides of parsing — a bad flag never reaches a handler, and a
 * caller redirecting stdout to a file still needs JSON in it either way.
 */
const jsonMode = process.argv.includes("--json");

const exitWith = (code: number): Effect.Effect<never> =>
  Effect.sync(() => process.exit(code));

/**
 * Terminal boundary: report the failure, then exit with a code the caller can
 * branch on.
 *
 * In `--json` mode the envelope goes to **stdout**. Writing only to stderr is
 * what turns a failed run into a 0-byte output file, which every downstream
 * `jq` then reads as a legitimately empty result — a health check that flags
 * nothing because it read nothing. A machine-readable error object where the
 * data was supposed to be makes that impossible to miss.
 */
const renderFailure = (error: LinearCliError): Effect.Effect<never> =>
  (jsonMode
    ? writeOut(toJson(errorPayload(error)))
    : writeErr(error.displayMessage)
  ).pipe(Effect.zipRight(exitWith(error.exitCode)));

const ESC = 0x1b;

/**
 * Drop the SGR colour codes `HelpDoc.toAnsiText` emits.
 *
 * Done by code point rather than by regex: the pattern would have to embed a
 * literal escape character, which is precisely the sort of thing that survives
 * an edit as an invisible byte nobody can see in review.
 */
const stripAnsi = (text: string): string => {
  let out = "";
  let inEscape = false;
  for (const ch of text) {
    if (inEscape) {
      if (ch === "m") inEscape = false;
      continue;
    }
    if (ch.codePointAt(0) === ESC) inEscape = true;
    else out += ch;
  }
  return out;
};

/**
 * A usage error (unknown flag, missing argument, blank filter value). The CLI
 * framework has already printed the usage docs to stderr; this adds the
 * machine-readable half and the exit code.
 */
const renderUsageFailure = (
  error: CliValidationError.ValidationError,
): Effect.Effect<never> => {
  if (!jsonMode) return exitWith(ExitCode.validation);
  const message =
    stripAnsi(HelpDoc.toAnsiText(error.error)).replace(/\s+/g, " ").trim() ||
    "Invalid command line.";
  return renderFailure(new ValidationError({ operation: "cli", message }));
};

const missingKeyMessage =
  "LINEAR_API_KEY is not set. Create a personal API key at " +
  "Linear → Settings → API, then `export LINEAR_API_KEY=...` " +
  "or add it to ~/.config/linear/env.";

/**
 * No usable API key. Kept apart from {@link renderFailure} so a human gets the
 * setup instructions verbatim rather than wrapped in "Authentication failed
 * (config): …", while `--json` still receives the identical error envelope.
 */
const renderMissingKey = (): Effect.Effect<never> =>
  jsonMode
    ? renderFailure(
        new LinearAuthError({ operation: "config", message: missingKeyMessage }),
      )
    : writeErr(missingKeyMessage).pipe(Effect.zipRight(exitWith(ExitCode.auth)));

const program = cli(process.argv).pipe(
  Effect.provide(MainLayer),
  // Render our typed failures cleanly; each carries a `displayMessage`.
  Effect.catchTags({
    LinearAuthError: renderFailure,
    LinearNotFoundError: renderFailure,
    RateLimitError: renderFailure,
    NetworkError: renderFailure,
    ValidationError: renderFailure,
    LinearApiError: renderFailure,
  }),
  // A missing/invalid API key surfaces as a ConfigError. Report it as the auth
  // failure it is, so `--json` callers see one consistent error shape.
  Effect.catchIf(ConfigError.isConfigError, renderMissingKey),
  // Bad arguments, including a blank value for a filter that would otherwise
  // have been silently ignored.
  Effect.catchIf(CliValidationError.isValidationError, renderUsageFailure),
);

BunRuntime.runMain(program);
