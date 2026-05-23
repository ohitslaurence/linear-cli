import { describe, expect, test } from "bun:test";
import { Command } from "@effect/cli";
import { BunContext } from "@effect/platform-bun";
import { Effect, Option } from "effect";
import {
  intOpt,
  jsonOption,
  limitOpt,
  orUndef,
  textOpt,
} from "../src/commands/common";

type Parsed = {
  readonly json: boolean;
  readonly assignee: Option.Option<string>;
  readonly limit: number;
  readonly priority: Option.Option<number>;
};

/**
 * Exercise the shared option helpers through @effect/cli's real parser, so the
 * `--json` / optional / integer / default behaviours are covered without the
 * Linear API. Assertions live inside the (fully typed) handler; `ran` guards
 * against a parse failure silently skipping them.
 */
const config = {
  json: jsonOption,
  assignee: textOpt("assignee", "assignee filter"),
  limit: limitOpt(50),
  priority: intOpt("priority", "priority"),
};

const runWith = async (
  argv: readonly string[],
  check: (parsed: Parsed) => void,
): Promise<void> => {
  let ran = false;
  const command = Command.make("probe", config, (parsed) =>
    Effect.sync(() => {
      ran = true;
      check(parsed);
    }),
  );
  await Effect.runPromise(
    Command.run(command, { name: "probe", version: "0.0.0" })([
      "bun",
      "probe",
      ...argv,
    ]).pipe(Effect.provide(BunContext.layer)),
  );
  expect(ran).toBe(true);
};

describe("option parsing", () => {
  test("reads flags, optionals, and integers", async () => {
    await runWith(
      ["--json", "--assignee", "me", "--limit", "5", "--priority", "2"],
      (parsed) => {
        expect(parsed.json).toBe(true);
        expect(orUndef(parsed.assignee)).toBe("me");
        expect(parsed.limit).toBe(5);
        expect(orUndef(parsed.priority)).toBe(2);
      },
    );
  });

  test("applies defaults and leaves optionals empty", async () => {
    await runWith([], (parsed) => {
      expect(parsed.json).toBe(false);
      expect(orUndef(parsed.assignee)).toBeUndefined();
      expect(parsed.limit).toBe(50);
      expect(orUndef(parsed.priority)).toBeUndefined();
    });
  });
});
