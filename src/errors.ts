import { Schema } from "effect";
import { LinearError as SdkLinearError, LinearErrorType } from "@linear/sdk";

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
 */

/** Invalid or missing credentials, or the key lacks access to the resource. */
export class LinearAuthError extends Schema.TaggedError<LinearAuthError>()(
  "LinearAuthError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {
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
  get displayMessage(): string {
    const what = this.resource ? ` (${this.resource})` : "";
    return `Not found${what} (${this.operation}): ${this.message}`;
  }
}

/** The Linear API rate limit (or usage limit) was exceeded. */
export class RateLimitError extends Schema.TaggedError<RateLimitError>()(
  "RateLimitError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {
  get displayMessage(): string {
    return `Rate limited (${this.operation}): ${this.message}. Retry shortly.`;
  }
}

/** A transport-level failure reaching the Linear API. */
export class NetworkError extends Schema.TaggedError<NetworkError>()(
  "NetworkError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {
  get displayMessage(): string {
    return `Network error (${this.operation}): ${this.message}`;
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
  },
) {
  get displayMessage(): string {
    return `Linear API error (${this.operation}): ${this.message}`;
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

const NOT_FOUND_PATTERN = /not found|could not find|does not exist|no such/i;

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

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
      switch (cause.type) {
        case LinearErrorType.AuthenticationError:
        case LinearErrorType.Forbidden:
        case LinearErrorType.FeatureNotAccessible:
          return new LinearAuthError({ operation, message });
        case LinearErrorType.Ratelimited:
        case LinearErrorType.UsageLimitExceeded:
          return new RateLimitError({ operation, message });
        case LinearErrorType.NetworkError:
          return new NetworkError({ operation, message });
        case LinearErrorType.InvalidInput:
        case LinearErrorType.UserError:
          return NOT_FOUND_PATTERN.test(message)
            ? new LinearNotFoundError({ operation, message })
            : new ValidationError({ operation, message });
        default:
          return NOT_FOUND_PATTERN.test(message)
            ? new LinearNotFoundError({ operation, message })
            : new LinearApiError({ operation, message });
      }
    }

    if (NOT_FOUND_PATTERN.test(message)) {
      return new LinearNotFoundError({ operation, message });
    }
    return new LinearApiError({ operation, message });
  };
