# AGENTS.md — working on `linear-cli`

This file is for agents (and humans) hacking **on the CLI itself**. If you just
want to *use* the `linear` command, read the [README](./README.md) instead.

`CLAUDE.md` is a symlink to this file.

## What this is

A single-binary CLI for Linear, written in **TypeScript on Bun**, built with
**[Effect](https://effect.website)** and **[`@effect/cli`](https://github.com/Effect-TS/effect/tree/main/packages/cli)**.
It wraps [`@linear/sdk`](https://github.com/linear/linear) behind a typed Effect
service so every command has a precise error channel and a `--json` mode.

## Architecture

```
src/
  cli.ts              Entry point. Builds the root command, wires the layer,
                      renders typed failures, BunRuntime.runMain.
  client.ts           `Linear` — an Effect.Service wrapping @linear/sdk.
                      One `call` helper routes every SDK promise through
                      mapLinearError. The client is built lazily so `--help`
                      never needs an API key.
  config.ts           `linearApiKey` (Config.redacted) + a ConfigProvider that
                      falls back to ~/.config/linear/env.
  errors.ts           Schema.TaggedError per failure mode + `mapLinearError`.
                      Treat this as "the shared errors" module.
  auth.ts             Save/clear the API key in ~/.config/linear/env and detect
                      where the active key resolves from (env vs file).
  types.ts            Plain, serialisable domain types (the --json contract).
  formatters.ts       Human text/CSV formatters + `toJson`.
  commands/
    common.ts         Shared option helpers (jsonOption, textOpt, …) + `render`.
    auth.ts issues.ts inbox.ts users.ts projects.ts docs.ts views.ts cycles.ts
                      One @effect/cli Command per subcommand, grouped by area.
test/                 bun:test — formatters, --json shape, error mapping,
                      config parsing, option parsing. Never hits the live API.
```

**Layers.** `Linear.Default` is the service layer; it reads config through
`ConfigProviderLive`. `cli.ts` composes everything with `Layer.mergeAll` and
calls `Effect.provide` **once** at the boundary.

**Errors.** Service methods fail with the typed `LinearCliError` union. The
entry point catches those tags and prints each error's `displayMessage`; a
missing key surfaces as a `ConfigError` and is caught separately.

**Output.** Every command takes `--json`. Handlers call
`render(json, data, () => fmt.someText(data))`: with `--json` the raw domain
object is serialised by `toJson` (stable field names, `Date` → ISO-8601);
otherwise the text/CSV formatter runs. The two modes are independent — never
derive one from the other.

## How to add a command end-to-end

1. **Service method** (`src/client.ts`): add a method inside the `Linear`
   service. Wrap the SDK call in `call("operationName", (client) => …)` so it
   inherits the typed error channel. Map the SDK object to a plain type from
   `types.ts` (add the type if needed). Keep heavy mapping in a module-level
   helper, not inside the service generator.
2. **Formatter** (`src/formatters.ts`): add a `formatX` text function. JSON is
   automatic via `toJson` as long as the data is a plain serialisable object.
3. **Command** (`src/commands/<area>.ts`): `Command.make("name", { json: jsonOption, … }, handler)`.
   Use the option helpers in `commands/common.ts` (`textOpt`, `reqText`,
   `intOpt`, `limitOpt`) and `Args.text(...)` for positionals. The handler
   does `const linear = yield* Linear; const data = yield* linear.x(...);
   yield* render(json, data, () => fmt.formatX(data))`. Add it to the area's
   exported array.
4. **Register**: the area array is already spread into `withSubcommands` in
   `cli.ts` — nothing to do if you appended to an existing array.
5. **Test** (`test/`): cover the formatter and any non-trivial parsing/mapping.
6. **Verify**: `bun run typecheck && bun run lint && bun test`.

## Hard rules

- **No `as any` / `as unknown`.** None. Derive types from SDK signatures
  (`Parameters<LinearClient["createIssue"]>[0]`) or narrow with `instanceof`.
  `tsc --noEmit` must stay clean.
- **Never commit a secret.** This is a public repo. The key is read only from
  the environment / `~/.config/linear/env`. `.env` is gitignored.
- **Conventional, scoped commits.**

## Build & dev

```bash
bun install
bun run dev -- issues --limit 5   # run from source
bun run typecheck                 # tsc --noEmit
bun run lint                      # oxlint
bun test                          # unit tests
bun run build                     # compile dist/linear
```

The `@effect/language-service` plugin is enabled in `tsconfig.json` for
editor diagnostics (it flags the anti-patterns below as you type).

---

## Effect anti-patterns (critical)

These are non-negotiable house style — they are what keep Effect code readable.
Treat any violation as a bug. (Adapted for this standalone repo: wherever the
original rules referenced `@spritz/shared/errors`, the equivalent here is
`src/errors.ts` — the `Schema.TaggedError` types `LinearAuthError`,
`LinearNotFoundError`, `RateLimitError`, `NetworkError`, `ValidationError`,
`LinearApiError`.)

- **No `Effect.either` + manual `_tag` checking** — don't call `.pipe(Effect.either)`
  then branch on `result._tag === "Left"`. Use `Effect.catchAll`, `Effect.catchTag`,
  or let errors propagate naturally. The Either pattern defeats the purpose of
  Effect's typed error channel.
- **No throwaway error types for local flow control** — don't create error types
  just to wrap errors inside a single handler. Reuse the `Schema.TaggedError`
  types from `src/errors.ts`, or let service errors propagate and catch at the
  boundary.
- **No copy-paste error handling** — if the same "record failure + log + recover"
  pattern repeats 3+ times, extract a helper. Repetitive error-handling blocks
  are the #1 source of unreadable Effect code.
- **Decompose long generators** — if an `Effect.gen` function exceeds ~40 lines,
  extract named sub-effects (e.g. `resolveIssue`, `formatOutput`). Each should
  have a clear responsibility.
- **Prefer `catchTag` over `catchAll` for typed errors** — when recovering from a
  specific error type, use `catchTag("ErrorTag", ...)` to keep other errors
  propagating. `catchAll` silently swallows everything.
- **Don't re-wrap errors needlessly** — if a service already returns a typed
  error, don't catch it just to wrap it in a new custom error type. Let it
  propagate.
- **Never use global `Error` in Effect `catch` callbacks** — `Effect.try` /
  `Effect.tryPromise` `catch` callbacks must return a `Schema.TaggedError`
  subclass, never bare `new Error(...)` or a plain class with a `_tag` field. The
  Effect TS plugin emits TS36 warnings for global `Error` in the error channel.
  Use the errors from `src/errors.ts` or define a new `Schema.TaggedError`.
- **Avoid stacking `Effect.provide` calls** — compose dependencies with
  `Layer.mergeAll`, `Layer.provide`, or `Layer.provideMerge`, then call
  `Effect.provide` once at the execution boundary. Multiple `Effect.provide`s in
  one pipeline create surprising layer lifetimes.
- **Avoid callable live layers for shared services** — layers are memoized by
  instance, so `SomeServiceLive()` creates a fresh instance each call. Export
  stable layer constants for shared services. Use explicit `make*Layer`
  factories only when fresh per-test/per-request state is intentional.

> Note on `new Error(...)` inside `call`: the few `throw new Error(...)` in
> `client.ts` live inside `Effect.tryPromise`'s `try` callback (regular async
> code), where they are immediately caught and converted by `mapLinearError`.
> They never appear in an Effect error channel, which is what the rule forbids.
