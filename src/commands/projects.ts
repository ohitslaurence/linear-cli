import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { Linear } from "../client";
import { ValidationError } from "../errors";
import * as fmt from "../formatters";
import {
  jsonOption,
  limitOpt,
  orUndef,
  render,
  reqText,
  requireBody,
  textArg,
  textOpt,
} from "./common";

/**
 * The long-form description comes from --content or --content-file, never
 * both. Project descriptions are long markdown documents, so the file form is
 * the normal one; --content suits a short edit.
 */
const resolveProjectContent = (
  operation: string,
  content: string | undefined,
  file: string | undefined,
) => {
  if (content !== undefined && file !== undefined) {
    return Effect.fail(
      new ValidationError({
        operation,
        message: "Pass --content or --content-file, not both.",
      }),
    );
  }
  if (file === undefined) return Effect.succeed(content);
  return Effect.tryPromise({
    try: () => Bun.file(file).text(),
    catch: () =>
      new ValidationError({
        operation,
        field: "content-file",
        message: `Could not read file: ${file}`,
      }),
  });
};

const projects = Command.make(
  "projects",
  {
    json: jsonOption,
    team: textOpt("team", "Filter by team key (SPR), name, or id."),
    limit: limitOpt(50),
  },
  ({ json, team, limit }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.listProjects(orUndef(team), limit);
      yield* render(json, data, () => fmt.formatProjectsCSV(data));
    }),
).pipe(Command.withDescription("List projects, most-recently-updated first."));

const project = Command.make(
  "project",
  {
    json: jsonOption,
    projectId: textArg("project-id", "Project id."),
  },
  ({ json, projectId }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.getProject(projectId);
      yield* render(json, data, () =>
        fmt.formatProjectDetail(data.project, data.milestones),
      );
    }),
).pipe(
  Command.withDescription(
    "Show a project: summary, long description, lead, dates, milestones, links and documents.",
  ),
);

const projectCreate = Command.make(
  "project-create",
  {
    json: jsonOption,
    name: reqText("name", "Project name."),
    team: reqText("team", "Team key (SPR), name, or id."),
    lead: textOpt("lead", "Lead: 'me', an email, a display name, or a user id."),
    description: textOpt("description", "Short summary (one line, max 255 chars)."),
    content: textOpt("content", "Long-form description (markdown)."),
    contentFile: textOpt("content-file", "Read the long-form description from this file."),
    targetDate: textOpt("target-date", "Target date (YYYY-MM-DD)."),
    initiative: textOpt("initiative", "Initiative id to link the project to."),
    status: textOpt("status", "Project status id."),
  },
  ({ json, name, team, lead, description, content, contentFile, targetDate, initiative, status }) =>
    Effect.gen(function* () {
      const body = yield* resolveProjectContent(
        "project-create",
        orUndef(content),
        orUndef(contentFile),
      );
      const linear = yield* Linear;
      const leadValue = orUndef(lead);
      const data = yield* linear.createProject({
        name,
        teamId: (yield* linear.resolveTeam(team)).id,
        leadId: leadValue ? yield* linear.resolveUserId(leadValue) : undefined,
        description: orUndef(description),
        content: body,
        targetDate: orUndef(targetDate),
        statusId: orUndef(status),
        initiativeId: orUndef(initiative),
      });
      yield* render(json, data, () => fmt.formatCreatedProject(data));
    }),
).pipe(
  Command.withDescription("Create a project (optionally linked to an initiative)."),
);

const projectEdit = Command.make(
  "project-edit",
  {
    json: jsonOption,
    projectId: textArg("project-id", "Project id."),
    name: textOpt("name", "New name."),
    status: textOpt("status", "New status id."),
    lead: textOpt("lead", "New lead: 'me', an email, a display name, or a user id."),
    description: textOpt("description", "New short summary (one line, max 255 chars)."),
    content: textOpt("content", "New long-form description (markdown). Replaces the old one."),
    contentFile: textOpt("content-file", "Read the new long-form description from this file."),
    targetDate: textOpt("target-date", "New target date (YYYY-MM-DD)."),
  },
  ({ json, projectId, name, status, lead, description, content, contentFile, targetDate }) =>
    Effect.gen(function* () {
      const leadValue = orUndef(lead);
      const fields = {
        name: orUndef(name),
        statusId: orUndef(status),
        leadId: leadValue,
        description: orUndef(description),
        content: yield* resolveProjectContent(
          "project-edit",
          orUndef(content),
          orUndef(contentFile),
        ),
        targetDate: orUndef(targetDate),
      };
      if (Object.values(fields).every((v) => v === undefined)) {
        return yield* Effect.fail(
          new ValidationError({
            operation: "project-edit",
            message:
              "Provide at least one field to edit (--name, --status, --lead, --description, --content, --content-file, --target-date).",
          }),
        );
      }
      const linear = yield* Linear;
      const data = yield* linear.updateProject(projectId, {
        ...fields,
        leadId: leadValue ? yield* linear.resolveUserId(leadValue) : undefined,
      });
      yield* render(json, data, () => fmt.formatUpdatedProject(data));
    }),
).pipe(Command.withDescription("Edit fields on an existing project."));

const projectStatuses = Command.make(
  "project-statuses",
  { json: jsonOption },
  ({ json }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.listProjectStatuses();
      yield* render(json, data, () => fmt.formatProjectStatuses(data));
    }),
).pipe(Command.withDescription("List org project statuses (id, name, type)."));

const projectUpdate = Command.make(
  "project-update",
  {
    json: jsonOption,
    projectId: textArg("project-id", "Project id."),
    body: Args.text({ name: "body" }).pipe(
      Args.withDescription("Update body."),
      Args.repeated,
    ),
    health: Options.choice("health", ["onTrack", "atRisk", "offTrack"]).pipe(
      Options.withDescription("Project health."),
      Options.optional,
    ),
  },
  ({ json, projectId, body, health }) =>
    Effect.gen(function* () {
      const text = yield* requireBody("project-update", body);
      const linear = yield* Linear;
      const id = yield* linear.postProjectUpdate(projectId, text, orUndef(health));
      yield* render(json, { id }, () => fmt.formatProjectUpdatePosted(id));
    }),
).pipe(Command.withDescription("Post a project update (status report)."));

const milestoneCreate = Command.make(
  "milestone-create",
  {
    json: jsonOption,
    projectId: reqText("project", "Project id."),
    name: reqText("name", "Milestone name."),
    targetDate: textOpt("target-date", "Target date (YYYY-MM-DD)."),
    description: textOpt("description", "Milestone description."),
  },
  ({ json, projectId, name, targetDate, description }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.createProjectMilestone({
        projectId,
        name,
        targetDate: orUndef(targetDate),
        description: orUndef(description),
      });
      yield* render(json, data, () => fmt.formatCreatedMilestone(data));
    }),
).pipe(Command.withDescription("Create a milestone within a project."));

const milestoneEdit = Command.make(
  "milestone-edit",
  {
    json: jsonOption,
    milestoneId: textArg("milestone-id", "Milestone id (from `linear project`)."),
    name: textOpt("name", "New name."),
    description: textOpt("description", "New description."),
    targetDate: textOpt("target-date", "New target date (YYYY-MM-DD)."),
  },
  ({ json, milestoneId, name, description, targetDate }) =>
    Effect.gen(function* () {
      const fields = {
        name: orUndef(name),
        description: orUndef(description),
        targetDate: orUndef(targetDate),
      };
      if (Object.values(fields).every((v) => v === undefined)) {
        return yield* Effect.fail(
          new ValidationError({
            operation: "milestone-edit",
            message:
              "Provide at least one field to edit (--name, --description, --target-date).",
          }),
        );
      }
      const linear = yield* Linear;
      const data = yield* linear.updateProjectMilestone(milestoneId, fields);
      yield* render(json, data, () => fmt.formatUpdatedMilestone(data));
    }),
).pipe(Command.withDescription("Edit a milestone's name, description or target date."));

const projectLink = Command.make(
  "project-link",
  {
    json: jsonOption,
    projectId: textArg("project-id", "Project id."),
    url: reqText("url", "Link URL (e.g. the spec in Notion)."),
    label: reqText("label", "Link label (e.g. Spec)."),
  },
  ({ json, projectId, url, label }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.createProjectLink({ projectId, url, label });
      yield* render(json, data, () => fmt.formatCreatedProjectLink(data));
    }),
).pipe(Command.withDescription("Add a link to a project's resources."));

export const projectCommands = [
  projects,
  project,
  projectCreate,
  projectEdit,
  projectStatuses,
  projectUpdate,
  milestoneCreate,
  milestoneEdit,
  projectLink,
];
