import { Effect } from "effect";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { envFilePath, parseEnvFile } from "./config";
import { ValidationError } from "./errors";

/**
 * Persistence for the API key in `~/.config/linear/env`, plus detection of
 * where the active key is coming from. The file is treated as CLI-managed
 * key/value storage (written `mode 0600`).
 */

export type KeySource = "environment" | "file" | "none";

export const sourceLabel = (source: KeySource): string =>
  source === "environment"
    ? "environment"
    : source === "file"
      ? "~/.config/linear/env"
      : "none";

const readEnvFile = (): Map<string, string> => {
  try {
    return parseEnvFile(readFileSync(envFilePath(), "utf8"));
  } catch {
    return new Map<string, string>();
  }
};

const serialise = (map: ReadonlyMap<string, string>): string =>
  map.size === 0
    ? ""
    : Array.from(map, ([k, v]) => `${k}=${v}`).join("\n") + "\n";

/** Where the active `LINEAR_API_KEY` resolves from (env wins over the file). */
export const resolveKeySource: Effect.Effect<KeySource> = Effect.sync(() => {
  if (process.env["LINEAR_API_KEY"]) return "environment";
  return readEnvFile().get("LINEAR_API_KEY") ? "file" : "none";
});

/** Write the key into the env file (preserving other entries). Returns the path. */
export const saveApiKey = (
  key: string,
): Effect.Effect<string, ValidationError> =>
  Effect.try({
    try: () => {
      const path = envFilePath();
      mkdirSync(dirname(path), { recursive: true });
      const map = readEnvFile();
      map.set("LINEAR_API_KEY", key);
      writeFileSync(path, serialise(map), { mode: 0o600 });
      return path;
    },
    catch: (cause) =>
      new ValidationError({
        operation: "auth login",
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

/** Remove the saved key from the env file. Returns whether anything was removed. */
export const clearApiKey: Effect.Effect<boolean, ValidationError> = Effect.try({
  try: () => {
    const map = readEnvFile();
    if (!map.has("LINEAR_API_KEY")) return false;
    map.delete("LINEAR_API_KEY");
    writeFileSync(envFilePath(), serialise(map), { mode: 0o600 });
    return true;
  },
  catch: (cause) =>
    new ValidationError({
      operation: "auth logout",
      message: cause instanceof Error ? cause.message : String(cause),
    }),
});
