import { Config, ConfigProvider, Effect, Layer } from "effect";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The Linear personal API key, read as a redacted value so it never lands in
 * logs or error messages. Resolved from the environment first, then from an
 * optional `~/.config/linear/env` file (see {@link ConfigProviderLive}).
 */
export const linearApiKey = Config.redacted("LINEAR_API_KEY");

export const envFilePath = (): string => {
  const base = process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
  return join(base, "linear", "env");
};

/** Parse a dotenv-style file: `KEY=value` / `export KEY="value"`, `#` comments. */
export const parseEnvFile = (text: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7) : line;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) map.set(key, value);
  }
  return map;
};

/** Read `~/.config/linear/env` if present; absent or unreadable → empty. */
const loadEnvFile = Effect.sync((): Map<string, string> => {
  try {
    return parseEnvFile(readFileSync(envFilePath(), "utf8"));
  } catch {
    return new Map<string, string>();
  }
});

/**
 * Config provider that reads the process environment first and falls back to
 * `~/.config/linear/env`. Provided once at the execution boundary so every
 * `Config.*` lookup (notably {@link linearApiKey}) honours both sources.
 */
export const ConfigProviderLive = Layer.unwrapEffect(
  Effect.map(loadEnvFile, (fileEnv) =>
    Layer.setConfigProvider(
      ConfigProvider.fromEnv().pipe(
        ConfigProvider.orElse(() => ConfigProvider.fromMap(fileEnv)),
      ),
    ),
  ),
);
