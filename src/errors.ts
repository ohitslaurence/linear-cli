import { Schema } from "effect";
import {
  LinearError as SdkLinearError,
  LinearErrorType,
  RatelimitedLinearError,
} from "@linear/sdk";

/**
 * Tagged errors for the Linear CLI.
 *
 * This module is the single source of truth for the CLI's error channel —
 * the standalone-repo equivalent of `@spritz/shared/errors`. Every failure
 * mode is a `Schema.TaggedError` so the Effect error channel stays precise and
 * `Effect.catchTag` can recover from one mode without swallowing the rest.
 *
 * Never put a bare `new Error(...)` in the error channel. Map raw `@linear/sdk`
 * failures through {@link mapLinearError} so they become one of these.
 *
 * Each error also carries the two things a *caller* needs in order to react
 * without parsing prose: an {@link ExitCode} and, for the transient ones,
 * whether retrying is sensible and how long to wait. See {@link errorPayload}.
 */

/**
 * Process exit codes, one per failure mode.
 *
 * A script should be able to branch on `$?` alone. In particular a rate limit
 * (6) and a transient server error (5) demand different handling — "retry
 * once" is right for a 503 and wrong for a 429, where the only correct move is
 * to wait `retryAfterSeconds` first.
 */
export const ExitCode = {
  ok: 0,
  /** Unclassified server-side failure. */
  apiError: 1,
  /** Bad input — from the API or from the CLI's own pre-flight checks. */
  validation: 2,
  notFound: 3,
  auth: 4,
  /** Transport failure or a 5xx from Linear. Retrying once is reasonable. */
  network: 5,
  /** 429. Wait `retryAfterSeconds` before retrying — do not retry immediately. */
  rateLimit: 6,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** Invalid or missing credentials, or the key lacks access to the resource. */
export class LinearAuthError extends Schema.TaggedError<LinearAuthError>()(
  "LinearAuthError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {
  readonly exitCode = ExitCode.auth;
  readonly retryable = false;
  get displayMessage(): string {
    return `Authentication failed (${this.operation}): ${this.message}. Check LINEAR_API_KEY.`;
  }
}

/** The requested entity (issue, project, view, …) does not exist. */
export class LinearNotFoundError extends Schema.TaggedError<LinearNotFoundError>()(
  "LinearNotFoundError",
  {
    operation: Schema.String,
    message: Schema.String,
    resource: Schema.optional(Schema.String),
  },
) {
  readonly exitCode = ExitCode.notFound;
  readonly retryable = false;
  get displayMessage(): string {
    const what = this.resource ? ` (${this.resource})` : "";
    return `Not found${what} (${this.operation}): ${this.message}`;
  }
}

/**
 * The Linear API rate limit (or usage limit) was exceeded — HTTP 429.
 *
 * Distinct from {@link NetworkError} on purpose. Both are transient, but only
 * this one carries a mandatory wait: retrying a 429 immediately just burns
 * another request against a budget that is already spent.
 */
export class RateLimitError extends Schema.TaggedError<RateLimitError>()(
  "RateLimitError",
  {
    operation: Schema.String,
    message: Schema.String,
    /** `Retry-After`, in seconds, when the API supplied one. */
    retryAfterSeconds: Schema.optional(Schema.Number),
    /** Requests left in the current window, when known. */
    requestsRemaining: Schema.optional(Schema.Number),
    /** Unix ms at which the request budget resets, when known. */
    requestsResetAt: Schema.optional(Schema.Number),
  },
) {
  readonly exitCode = ExitCode.rateLimit;
  readonly retryable = true;
  get displayMessage(): string {
    const wait =
      this.retryAfterSeconds !== undefined
        ? ` Retry after ${this.retryAfterSeconds}s.`
        : " Retry shortly.";
    return `Rate limited (${this.operation}): ${this.message}.${wait}`;
  }
}

/**
 * The request did not complete: a transport-level failure, or a 5xx from
 * Linear (503 during a deploy, 502 from the edge). Transient — retrying once
 * is the right response, which is exactly what makes it worth separating from
 * {@link RateLimitError}.
 */
export class NetworkError extends Schema.TaggedError<NetworkError>()(
  "NetworkError",
  {
    operation: Schema.String,
    message: Schema.String,
    /** HTTP status, when the failure got far enough to have one. */
    status: Schema.optional(Schema.Number),
  },
) {
  readonly exitCode = ExitCode.network;
  readonly retryable = true;
  get displayMessage(): string {
    const code = this.status !== undefined ? ` [${this.status}]` : "";
    return `Network error${code} (${this.operation}): ${this.message}. Retrying once is reasonable.`;
  }
}

/** Invalid input rejected by the API or by local pre-flight checks. */
export class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  {
    operation: Schema.String,
    message: Schema.String,
    field: Schema.optional(Schema.String),
  },
) {
  readonly exitCode = ExitCode.validation;
  readonly retryable = false;
  get displayMessage(): string {
    const where = this.field ? ` [${this.field}]` : "";
    return `Invalid input${where} (${this.operation}): ${this.message}`;
  }
}

/**
 * Honest catch-all for server-side failures that don't fit a more specific
 * mode (internal errors, GraphQL errors, lock timeouts, genuinely unknown).
 * Kept typed rather than letting a raw `unknown` leak into the error channel.
 */
export class LinearApiError extends Schema.TaggedError<LinearApiError>()(
  "LinearApiError",
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optional(Schema.Number),
  },
) {
  readonly exitCode = ExitCode.apiError;
  readonly retryable = false;
  get displayMessage(): string {
    const code = this.status !== undefined ? ` [${this.status}]` : "";
    return `Linear API error${code} (${this.operation}): ${this.message}`;
  }
}

/** The full error channel surfaced by the Linear service. */
export type LinearCliError =
  | LinearAuthError
  | LinearNotFoundError
  | RateLimitError
  | NetworkError
  | ValidationError
  | LinearApiError;

/**
 * The `--json` failure envelope.
 *
 * Printed to **stdout**, not stderr. A command that fails must still leave
 * parseable JSON where the caller is looking, otherwise `linear … --json > f`
 * writes a 0-byte file and every downstream `jq` reads it as an empty result —
 * a clean day, nothing to flag, having read nothing at all.
 */
export interface ErrorPayload {
  readonly error: {
    readonly tag: string;
    readonly operation: string;
    readonly message: string;
    readonly displayMessage: string;
    readonly exitCode: number;
    readonly retryable: boolean;
    readonly field?: string;
    readonly resource?: string;
    readonly status?: number;
    readonly retryAfterSeconds?: number;
    readonly requestsRemaining?: number;
    readonly requestsResetAt?: number;
  };
}

const defined = <T extends Record<string, unknown>>(obj: T): T =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;

/** Build the `{"error": …}` object emitted by every command's `--json` mode. */
export const errorPayload = (error: LinearCliError): ErrorPayload => ({
  error: defined({
    tag: error._tag,
    operation: error.operation,
    message: error.message,
    displayMessage: error.displayMessage,
    exitCode: error.exitCode,
    retryable: error.retryable,
    field: error._tag === "ValidationError" ? error.field : undefined,
    resource: error._tag === "LinearNotFoundError" ? error.resource : undefined,
    status:
      error._tag === "NetworkError" || error._tag === "LinearApiError"
        ? error.status
        : undefined,
    retryAfterSeconds:
      error._tag === "RateLimitError" ? error.retryAfterSeconds : undefined,
    requestsRemaining:
      error._tag === "RateLimitError" ? error.requestsRemaining : undefined,
    requestsResetAt:
      error._tag === "RateLimitError" ? error.requestsResetAt : undefined,
  }),
});

const NOT_FOUND_PATTERN = /not found|could not find|does not exist|no such/i;

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** A 5xx means Linear had the problem, and it is probably over by now. */
const isTransientStatus = (status: number | undefined): boolean =>
  status !== undefined && status >= 500;

const rateLimitFrom = (
  operation: string,
  message: string,
  cause: SdkLinearError,
): RateLimitError =>
  new RateLimitError({
    operation,
    message,
    ...(cause instanceof RatelimitedLinearError
      ? defined({
          retryAfterSeconds: cause.retryAfter,
          requestsRemaining: cause.requestsRemaining,
          requestsResetAt: cause.requestsResetAt,
        })
      : {}),
  });

/**
 * Map a raw thrown value (typically a `@linear/sdk` error) onto the typed
 * error channel. This is the one place SDK failures are interpreted — keep all
 * `Effect.tryPromise` `catch` callbacks routing through here so error handling
 * is never copy-pasted.
 */
export const mapLinearError =
  (operation: string) =>
  (cause: unknown): LinearCliError => {
    const message = messageOf(cause) || "Unknown error";

    if (cause instanceof SdkLinearError) {
      const status = cause.status;
      switch (cause.type) {
        case LinearErrorType.AuthenticationError:
        case LinearErrorType.Forbidden:
        case LinearErrorType.FeatureNotAccessible:
          return new LinearAuthError({ operation, message });
        case LinearErrorType.Ratelimited:
        case LinearErrorType.UsageLimitExceeded:
          return rateLimitFrom(operation, message, cause);
        case LinearErrorType.NetworkError:
          return new NetworkError({ operation, message, ...defined({ status }) });
        case LinearErrorType.InvalidInput:
        case LinearErrorType.UserError:
          return NOT_FOUND_PATTERN.test(message)
            ? new LinearNotFoundError({ operation, message })
            : new ValidationError({ operation, message });
        default:
          // A 503 from Linear arrives here as `InternalError`/`Other`/`Unknown`.
          // It is not the caller's fault and not permanent, so it belongs with
          // the other retryable failures rather than in the catch-all.
          if (isTransientStatus(status)) {
            return new NetworkError({ operation, message, status });
          }
          return NOT_FOUND_PATTERN.test(message)
            ? new LinearNotFoundError({ operation, message })
            : new LinearApiError({ operation, message, ...defined({ status }) });
      }
    }

    if (NOT_FOUND_PATTERN.test(message)) {
      return new LinearNotFoundError({ operation, message });
    }
    return new LinearApiError({ operation, message });
  };
