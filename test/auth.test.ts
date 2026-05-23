import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearApiKey, resolveKeySource, saveApiKey } from "../src/auth";

let dir: string;
const prevXdg = process.env["XDG_CONFIG_HOME"];
const prevKey = process.env["LINEAR_API_KEY"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "linear-cli-test-"));
  process.env["XDG_CONFIG_HOME"] = dir;
  delete process.env["LINEAR_API_KEY"];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (prevXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
  else process.env["XDG_CONFIG_HOME"] = prevXdg;
  if (prevKey !== undefined) process.env["LINEAR_API_KEY"] = prevKey;
});

describe("auth key persistence", () => {
  test("source is 'none' before any key is saved", async () => {
    expect(await Effect.runPromise(resolveKeySource)).toBe("none");
  });

  test("saveApiKey writes the key and source becomes 'file'", async () => {
    const path = await Effect.runPromise(saveApiKey("lin_test_123"));
    expect(path).toBe(join(dir, "linear", "env"));
    expect(readFileSync(path, "utf8")).toContain("LINEAR_API_KEY=lin_test_123");
    expect(await Effect.runPromise(resolveKeySource)).toBe("file");
  });

  test("the environment variable wins over the file", async () => {
    await Effect.runPromise(saveApiKey("lin_file"));
    process.env["LINEAR_API_KEY"] = "lin_env";
    expect(await Effect.runPromise(resolveKeySource)).toBe("environment");
    delete process.env["LINEAR_API_KEY"];
  });

  test("clearApiKey removes the saved key", async () => {
    await Effect.runPromise(saveApiKey("lin_test_123"));
    expect(await Effect.runPromise(clearApiKey)).toBe(true);
    expect(await Effect.runPromise(resolveKeySource)).toBe("none");
    // Removing again is a no-op.
    expect(await Effect.runPromise(clearApiKey)).toBe(false);
  });
});
