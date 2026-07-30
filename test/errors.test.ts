import { describe, expect, test } from "bun:test";
import {
  AuthenticationLinearError,
  ForbiddenLinearError,
  InternalLinearError,
  InvalidInputLinearError,
  NetworkLinearError,
  RatelimitedLinearError,
} from "@linear/sdk";
import { ExitCode, errorPayload, mapLinearError } from "../src/errors";

const map = mapLinearError("testOp");

/**
 * A 429 carries `Retry-After` in the response headers; the SDK's
 * `RatelimitedLinearError` reads them off the raw error it is constructed from.
 */
const ratelimited = (headers: Record<string, string>) =>
  new RatelimitedLinearError({
    response: { status: 429, headers: new Headers(headers) },
  });

describe("mapLinearError", () => {
  test("authentication → LinearAuthError", () => {
    expect(map(new AuthenticationLinearError())._tag).toBe("LinearAuthError");
  });

  test("forbidden → LinearAuthError", () => {
    expect(map(new ForbiddenLinearError())._tag).toBe("LinearAuthError");
  });

  test("ratelimited → RateLimitError", () => {
    expect(map(new RatelimitedLinearError())._tag).toBe("RateLimitError");
  });

  test("network → NetworkError", () => {
    expect(map(new NetworkLinearError())._tag).toBe("NetworkError");
  });

  test("invalid input → ValidationError", () => {
    expect(map(new InvalidInputLinearError())._tag).toBe("ValidationError");
  });

  test("not-found message → LinearNotFoundError", () => {
    expect(map(new Error("Entity not found"))._tag).toBe("LinearNotFoundError");
  });

  test("unknown error → LinearApiError", () => {
    expect(map(new Error("kaboom"))._tag).toBe("LinearApiError");
  });

  test("preserves the operation and message", () => {
    const err = mapLinearError("getIssue")(new Error("nope"));
    expect(err.operation).toBe("getIssue");
    expect(err.message).toBe("nope");
  });

  test("every error exposes a human displayMessage", () => {
    const err = map(new AuthenticationLinearError());
    expect(typeof err.displayMessage).toBe("string");
    expect(err.displayMessage.length).toBeGreaterThan(0);
  });
});

/**
 * "Retry once" is right for a 503 and wrong for a 429 — so the two must not
 * arrive at the caller looking the same.
 */
describe("429 vs 5xx", () => {
  test("a 429 surfaces Retry-After so a caller can wait the right amount", () => {
    const err = map(
      ratelimited({
        "retry-after": "42",
        "x-ratelimit-requests-remaining": "0",
      }),
    );
    expect(err._tag).toBe("RateLimitError");
    if (err._tag === "RateLimitError") {
      expect(err.retryAfterSeconds).toBe(42);
      expect(err.requestsRemaining).toBe(0);
      expect(err.displayMessage).toContain("Retry after 42s");
    }
  });

  test("a 429 without a Retry-After header still classifies", () => {
    const err = map(new RatelimitedLinearError());
    expect(err._tag).toBe("RateLimitError");
    expect(err.exitCode).toBe(ExitCode.rateLimit);
  });

  test("a 5xx is transient, not a catch-all API error", () => {
    const err = map(
      new InternalLinearError({ response: { status: 503 }, message: "oops" }),
    );
    expect(err._tag).toBe("NetworkError");
    expect(err.exitCode).toBe(ExitCode.network);
    expect(err.retryable).toBe(true);
  });

  test("a rate limit and a 5xx get different exit codes", () => {
    expect(map(new RatelimitedLinearError()).exitCode).not.toBe(
      map(new InternalLinearError({ response: { status: 503 } })).exitCode,
    );
  });
});

describe("exit codes", () => {
  test("each failure mode has its own", () => {
    expect(map(new AuthenticationLinearError()).exitCode).toBe(ExitCode.auth);
    expect(map(new InvalidInputLinearError()).exitCode).toBe(ExitCode.validation);
    expect(map(new Error("Entity not found")).exitCode).toBe(ExitCode.notFound);
    expect(map(new NetworkLinearError()).exitCode).toBe(ExitCode.network);
    expect(map(new Error("kaboom")).exitCode).toBe(ExitCode.apiError);
  });

  test("nothing succeeds by accident", () => {
    for (const error of [
      map(new AuthenticationLinearError()),
      map(new RatelimitedLinearError()),
      map(new Error("kaboom")),
    ]) {
      expect(error.exitCode).not.toBe(ExitCode.ok);
    }
  });
});

/**
 * The failure envelope is what stops `linear … --json > f.json` leaving a
 * 0-byte file that every downstream `jq` reads as an empty result.
 */
describe("errorPayload", () => {
  test("is a parseable object carrying the tag, exit code and retryability", () => {
    const payload = errorPayload(map(new AuthenticationLinearError()));
    const round = JSON.parse(JSON.stringify(payload)) as typeof payload;
    expect(round.error.tag).toBe("LinearAuthError");
    expect(round.error.operation).toBe("testOp");
    expect(round.error.exitCode).toBe(ExitCode.auth);
    expect(round.error.retryable).toBe(false);
    expect(typeof round.error.displayMessage).toBe("string");
  });

  test("includes retryAfterSeconds only when there is one", () => {
    const withHeader = errorPayload(map(ratelimited({ "retry-after": "7" })));
    expect(withHeader.error.retryAfterSeconds).toBe(7);
    const without = errorPayload(map(new RatelimitedLinearError()));
    expect("retryAfterSeconds" in without.error).toBe(false);
  });

  test("omits fields that do not apply to the tag", () => {
    const payload = errorPayload(map(new Error("kaboom")));
    expect("retryAfterSeconds" in payload.error).toBe(false);
    expect("field" in payload.error).toBe(false);
  });
});
