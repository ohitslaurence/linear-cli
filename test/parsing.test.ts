import { describe, expect, test } from "bun:test";
import { Command } from "@effect/cli";
import { BunContext } from "@effect/platform-bun";
import { Effect, Option } from "effect";
import {
  idsArg,
  intOpt,
  jsonOption,
  limitOpt,
  listOpt,
  orUndef,
  requireBody,
  textArg,
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

  test("trims surrounding whitespace off a value", async () => {
    await runWith(["--assignee", "  me  "], (parsed) => {
      expect(orUndef(parsed.assignee)).toBe("me");
    });
  });
});

/**
 * The failure that motivates all of this: an unset shell variable expands to
 * the empty string, so `--assignee "$MY_UUID"` arrives as `--assignee ""`.
 * Ignoring it silently turns "my issues" into "the whole team's issues" — and
 * on a write, turns "clear my labels" into "clear everyone's".
 */
describe("blank values", () => {
  const parseFails = async (options: Parameters<typeof Command.make>[1], argv: readonly string[]) => {
    let ran = false;
    const command = Command.make("probe", options, () =>
      Effect.sync(() => {
        ran = true;
      }),
    );
    const exit = await Effect.runPromiseExit(
      Command.run(command, { name: "probe", version: "0.0.0" })([
        "bun",
        "probe",
        ...argv,
      ]).pipe(Effect.provide(BunContext.layer)),
    );
    return { failed: exit._tag === "Failure", ran };
  };

  test("an empty option value is an error, not 'no filter'", async () => {
    const result = await parseFails(
      { assignee: textOpt("assignee", "assignee filter") },
      ["--assignee", ""],
    );
    expect(result.failed).toBe(true);
    expect(result.ran).toBe(false);
  });

  test("a whitespace-only option value is an error too", async () => {
    const result = await parseFails(
      { assignee: textOpt("assignee", "assignee filter") },
      ["--assignee", "   "],
    );
    expect(result.failed).toBe(true);
  });

  test("an empty positional is an error", async () => {
    const result = await parseFails({ id: textArg("id", "issue id") }, [""]);
    expect(result.failed).toBe(true);
    expect(result.ran).toBe(false);
  });

  test("an empty comma list is an error", async () => {
    const result = await parseFails({ labels: listOpt("label", "labels") }, [
      "--label",
      ",, ,",
    ]);
    expect(result.failed).toBe(true);
  });
});

describe("idsArg", () => {
  const runIds = async (raw: string): Promise<readonly string[]> => {
    let seen: readonly string[] = [];
    const command = Command.make(
      "probe",
      { ids: idsArg("id", "issue ids") },
      ({ ids }) =>
        Effect.sync(() => {
          seen = ids;
        }),
    );
    await Effect.runPromise(
      Command.run(command, { name: "probe", version: "0.0.0" })([
        "bun",
        "probe",
        raw,
      ]).pipe(Effect.provide(BunContext.layer)),
    );
    return seen;
  };

  test("a single id stays a one-element batch", async () => {
    expect(await runIds("SPR-1")).toEqual(["SPR-1"]);
  });

  test("splits and trims a comma-separated batch", async () => {
    expect(await runIds("SPR-1, SPR-2 ,SPR-3")).toEqual([
      "SPR-1",
      "SPR-2",
      "SPR-3",
    ]);
  });
});

/**
 * `Args.repeated` accepts zero occurrences, so a script whose message variable
 * was empty used to post a blank, customer-visible comment.
 */
describe("requireBody", () => {
  test("joins the parts", () => {
    expect(Effect.runSync(requireBody("comment", ["hello", "there"]))).toBe(
      "hello there",
    );
  });

  test("refuses an absent body", () => {
    const err = Effect.runSync(Effect.flip(requireBody("comment", [])));
    expect(err.field).toBe("body");
  });

  test("refuses a whitespace-only body", () => {
    const err = Effect.runSync(Effect.flip(requireBody("comment", ["  ", ""])));
    expect(err._tag).toBe("ValidationError");
  });
});
