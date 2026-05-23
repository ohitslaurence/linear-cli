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
  textOpt,
} from "./common";

const projects = Command.make(
  "projects",
  {
    json: jsonOption,
    team: textOpt("team", "Filter by team key (e.g. SPR)."),
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
    projectId: Args.text({ name: "project-id" }).pipe(
      Args.withDescription("Project id."),
    ),
  },
  ({ json, projectId }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const summary = yield* linear.getProject(projectId);
      const milestones = yield* linear.getProjectMilestones(projectId);
      yield* render(json, { project: summary, milestones }, () =>
        fmt.formatProjectDetail(summary, milestones),
      );
    }),
).pipe(Command.withDescription("Show a project and its milestones."));

const projectCreate = Command.make(
  "project-create",
  {
    json: jsonOption,
    name: reqText("name", "Project name."),
    team: reqText("team", "Team id."),
    lead: textOpt("lead", "Lead user id."),
    description: textOpt("description", "Project description."),
    targetDate: textOpt("target-date", "Target date (YYYY-MM-DD)."),
    initiative: textOpt("initiative", "Initiative id to link the project to."),
    status: textOpt("status", "Project status id."),
  },
  ({ json, name, team, lead, description, targetDate, initiative, status }) =>
    Effect.gen(function* () {
      const linear = yield* Linear;
      const data = yield* linear.createProject({
        name,
        teamId: team,
        leadId: orUndef(lead),
        description: orUndef(description),
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
    projectId: Args.text({ name: "project-id" }).pipe(
      Args.withDescription("Project id."),
    ),
    name: textOpt("name", "New name."),
    status: textOpt("status", "New status id."),
    lead: textOpt("lead", "New lead user id."),
    description: textOpt("description", "New description."),
    targetDate: textOpt("target-date", "New target date (YYYY-MM-DD)."),
  },
  ({ json, projectId, name, status, lead, description, targetDate }) =>
    Effect.gen(function* () {
      const fields = {
        name: orUndef(name),
        statusId: orUndef(status),
        leadId: orUndef(lead),
        description: orUndef(description),
        targetDate: orUndef(targetDate),
      };
      if (Object.values(fields).every((v) => v === undefined)) {
        return yield* Effect.fail(
          new ValidationError({
            operation: "project-edit",
            message:
              "Provide at least one field to edit (--name, --status, --lead, --description, --target-date).",
          }),
        );
      }
      const linear = yield* Linear;
      const data = yield* linear.updateProject(projectId, fields);
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
    projectId: Args.text({ name: "project-id" }).pipe(
      Args.withDescription("Project id."),
    ),
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
      const linear = yield* Linear;
      const id = yield* linear.postProjectUpdate(
        projectId,
        body.join(" "),
        orUndef(health),
      );
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

export const projectCommands = [
  projects,
  project,
  projectCreate,
  projectEdit,
  projectStatuses,
  projectUpdate,
  milestoneCreate,
];
