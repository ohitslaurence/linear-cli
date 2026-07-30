import { Effect } from "effect";

/**
 * Writing to stdout/stderr, with the write actually finished before we move on.
 *
 * `console.log` hands the string to a stream and returns immediately. When
 * stdout is a pipe rather than a terminal or a file, anything past the pipe
 * buffer (64 KiB on Linux) is still queued when `BunRuntime.runMain` calls
 * `process.exit`, and is discarded. The result is a *silent* truncation: no
 * error, no non-zero exit, just a short read that stays valid JSON right up
 * until it isn't. `linear issues --json > file.json` was fine; the same command
 * piped into `jq` was not.
 *
 * The fix is to wait for the stream to confirm the write. `write` invokes its
 * callback once the chunk has been handed to the OS — including after a drain
 * when backpressure kicks in — so suspending the fiber until then makes the
 * flush part of the program rather than a race against process teardown.
 *
 * Every byte the CLI emits goes through here. Nothing should call `console.log`
 * or `Console.log` directly.
 */

const write = (
  stream: NodeJS.WriteStream,
  text: string,
): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    // A closed reader (`linear issues | head -1`) surfaces as EPIPE. There is
    // nobody left to tell, so treat it as a completed write rather than a
    // failure — the alternative is a stack trace every time someone pipes to
    // `head`.
    stream.write(text, () => resume(Effect.void));
  });

/** Write `text` to stdout, followed by a newline, and wait for it to flush. */
export const writeOut = (text: string): Effect.Effect<void> =>
  write(process.stdout, text.endsWith("\n") ? text : text + "\n");

/** Write `text` to stderr, followed by a newline, and wait for it to flush. */
export const writeErr = (text: string): Effect.Effect<void> =>
  write(process.stderr, text.endsWith("\n") ? text : text + "\n");
