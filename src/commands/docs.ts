import { Args, Command } from "@effect/cli";
import { Effect } from "effect";
import { Linear } from "../client";
import { ValidationError } from "../errors";
import * as fmt from "../formatters";
import { jsonOption, orUndef, render, reqText, textOpt } from "./common";

/** Resolve document content from --file, positional args, or stdin (in that order). */
const resolveContent = (file: string | undefined, args: readonly string[]) => {
  if (file !== undefined) {
    return Effect.tryPromise({
      try: () => Bun.file(file).text(),
      catch: () =>
        new ValidationError({
          operation: "doc",
          field: "file",
          message: `Could not read file: ${file}`,
        }),
    });
  }
  if (args.length > 0) return Effect.succeed(args.join(" "));
  return Effect.tryPromise({
    try: () => Bun.stdin.text(),
    catch: () =>
      new ValidationError({
        operation: "doc",
        message: "No content: pass --file <path>, positional text, or pipe stdin.",
      }),
  });
};

const doc = Command.make(
  "doc",
  {
    json: jsonOption,
    title: reqText("title", "Document title."),
    project: textOpt("project", "Attach to project id."),
    team: textOpt("team", "Attach to team id."),
    issue: textOpt("issue", "Attach to issue id."),
    file: textOpt("file", "Read content from this file."),
    content: Args.text({ name: "content" }).pipe(
      Args.withDescription("Inline content (alternative to --file/stdin)."),
      Args.repeated,
    ),
  },
  ({ json, title, project, team, issue, file, content }) =>
    Effect.gen(function* () {
      const projectId = orUndef(project);
      const teamId = orUndef(team);
      const issueId = orUndef(issue);
      if (projectId === undefined && teamId === undefined && issueId === undefined) {
        return yield* Effect.fail(
          new ValidationError({
            operation: "doc",
            message: "One of --project, --team, or --issue is required.",
          }),
        );
      }
      const body = yield* resolveContent(orUndef(file), content);
      const linear = yield* Linear;
      const data = yield* linear.createDocument(title, body, {
        projectId,
        teamId,
        issueId,
      });
      yield* render(json, data, () => fmt.formatCreatedDocument(data));
    }),
).pipe(
  Command.withDescription(
    "Create a document attached to a project, team, or issue.",
  ),
);

export const docCommands = [doc];
