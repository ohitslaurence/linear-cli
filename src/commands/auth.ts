import { Command, Prompt } from "@effect/cli";
import { Console, Effect, Redacted } from "effect";
import {
  clearApiKey,
  resolveKeySource,
  saveApiKey,
  sourceLabel,
} from "../auth";
import { Linear, verifyApiKey } from "../client";
import { ValidationError } from "../errors";
import { jsonOption, orUndef, render, textOpt } from "./common";

const login = Command.make(
  "login",
  {
    json: jsonOption,
    key: textOpt(
      "key",
      "API key, to skip the interactive prompt (for CI / agents).",
    ),
  },
  ({ json, key }) =>
    Effect.gen(function* () {
      const provided = orUndef(key);
      const entered =
        provided ??
        Redacted.value(
          yield* Prompt.run(
            Prompt.password({ message: "Linear API key (input hidden):" }),
          ),
        );
      const apiKey = entered.trim();
      if (apiKey.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            operation: "auth login",
            message: "No API key provided.",
          }),
        );
      }
      // Confirm the key works before persisting it.
      const viewer = yield* verifyApiKey(apiKey);
      const path = yield* saveApiKey(apiKey);
      yield* render(json, { status: "logged-in", viewer, path }, () =>
        `Logged in as ${viewer.name} <${viewer.email}>.\nKey saved to ${path}.`,
      );
    }),
).pipe(
  Command.withDescription(
    "Verify a Linear API key and save it to ~/.config/linear/env.",
  ),
);

const status = Command.make("status", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const source = yield* resolveKeySource;
    if (source === "none") {
      yield* render(json, { authenticated: false }, () =>
        "Not authenticated. Run `linear auth login`.",
      );
      return yield* Effect.sync(() => process.exit(1));
    }
    const linear = yield* Linear;
    const viewer = yield* linear.whoami();
    yield* render(json, { authenticated: true, source, viewer }, () =>
      `Logged in as ${viewer.name} <${viewer.email}> (key from ${sourceLabel(source)}).`,
    );
  }),
).pipe(
  Command.withDescription("Show whether a working API key is configured."),
);

const logout = Command.make("logout", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const removed = yield* clearApiKey;
    const envVarStillSet = process.env["LINEAR_API_KEY"] !== undefined;
    yield* render(json, { removed, envVarStillSet }, () => {
      const lines = [
        removed
          ? "Removed the saved API key from ~/.config/linear/env."
          : "No saved API key to remove.",
      ];
      if (envVarStillSet)
        lines.push("Note: LINEAR_API_KEY is still set in your environment.");
      return lines.join("\n");
    });
  }),
).pipe(Command.withDescription("Remove the saved API key."));

const auth = Command.make("auth", {}, () =>
  Console.log("Run `linear auth login`, `linear auth status`, or `linear auth logout`."),
).pipe(
  Command.withDescription("Manage authentication."),
  Command.withSubcommands([login, status, logout]),
);

export const authCommands = [auth];
