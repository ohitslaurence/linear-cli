#!/usr/bin/env bun
import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { ConfigError, Console, Effect, Layer } from "effect";
import { Linear } from "./client";
import { ConfigProviderLive } from "./config";
import type { LinearCliError } from "./errors";
import { cycleCommands } from "./commands/cycles";
import { docCommands } from "./commands/docs";
import { inboxCommands } from "./commands/inbox";
import { issueCommands } from "./commands/issues";
import { projectCommands } from "./commands/projects";
import { userCommands } from "./commands/users";
import { viewCommands } from "./commands/views";

const [firstCommand, ...restCommands] = [
  ...issueCommands,
  ...inboxCommands,
  ...userCommands,
  ...projectCommands,
  ...docCommands,
  ...viewCommands,
  ...cycleCommands,
];

const root = Command.make("linear", {}, () =>
  Console.log(
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

/** Print a message to stderr and exit non-zero. Terminal boundary handling. */
const fail = (message: string): Effect.Effect<never> =>
  Console.error(message).pipe(
    Effect.zipRight(Effect.sync(() => process.exit(1))),
  );

const renderFailure = (error: LinearCliError) => fail(error.displayMessage);

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
  // A missing/!invalid API key surfaces as a ConfigError.
  Effect.catchIf(ConfigError.isConfigError, () =>
    fail(
      "LINEAR_API_KEY is not set. Create a personal API key at " +
        "Linear → Settings → API, then `export LINEAR_API_KEY=...` " +
        "or add it to ~/.config/linear/env.",
    ),
  ),
);

BunRuntime.runMain(program);
