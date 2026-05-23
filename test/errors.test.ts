import { describe, expect, test } from "bun:test";
import {
  AuthenticationLinearError,
  ForbiddenLinearError,
  InvalidInputLinearError,
  NetworkLinearError,
  RatelimitedLinearError,
} from "@linear/sdk";
import { mapLinearError } from "../src/errors";

const map = mapLinearError("testOp");

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
