import { Effect, Redacted } from "effect";
import {
  LinearClient,
  IssueNotification,
  ProjectNotification,
  ProjectUpdateHealthType,
} from "@linear/sdk";
import type { Issue } from "@linear/sdk";
import { linearApiKey } from "./config";
import { mapLinearError } from "./errors";
import {
  ALL_NOTIFICATION_CATEGORIES,
  type Activity,
  type Comment,
  type CreateIssueInput,
  type CreatedDocument,
  type CreatedProject,
  type Cycle,
  type CustomView,
  type Favorite,
  type HistoryEntry,
  type Inbox,
  type IssueDetail,
  type IssueFilter,
  type IssueSummary,
  type LinearUser,
  type Notification,
  type NotificationCategory,
  type InboxFilter,
  type ProjectMilestone,
  type ProjectStatus,
  type ProjectSummary,
  type UpdateIssueInput,
  type UpdatedProject,
  type UserActivity,
} from "./types";

// Argument types derived from the SDK method signatures, so the mutation inputs
// we build stay fully typed without `as any` / `as unknown`.
type IssuesArgs = NonNullable<Parameters<LinearClient["issues"]>[0]>;
type IssueQueryFilter = NonNullable<IssuesArgs["filter"]>;
type CreateIssueArg = Parameters<LinearClient["createIssue"]>[0];
type UpdateIssueArg = Parameters<LinearClient["updateIssue"]>[1];
type CreateProjectArg = Parameters<LinearClient["createProject"]>[0];
type UpdateProjectArg = Parameters<LinearClient["updateProject"]>[1];
type CreateMilestoneArg = Parameters<LinearClient["createProjectMilestone"]>[0];
type CreateDocumentArg = Parameters<LinearClient["createDocument"]>[0];
type CreateProjectUpdateArg = Parameters<LinearClient["createProjectUpdate"]>[0];
type NotificationNode = Awaited<
  ReturnType<LinearClient["notifications"]>
>["nodes"][number];

const PAGE_SIZE = 50;

const HEALTH: Record<ProjectHealth, ProjectUpdateHealthType> = {
  onTrack: ProjectUpdateHealthType.OnTrack,
  atRisk: ProjectUpdateHealthType.AtRisk,
  offTrack: ProjectUpdateHealthType.OffTrack,
};

export type ProjectHealth = "onTrack" | "atRisk" | "offTrack";

/** Translate the CLI's `--state` keyword (or a literal state name) into a filter. */
const stateFilter = (state: string): IssueQueryFilter["state"] => {
  switch (state) {
    case "active":
      return { type: { in: ["started", "unstarted"] } };
    case "completed":
      return { type: { eq: "completed" } };
    case "canceled":
      return { type: { eq: "canceled" } };
    default:
      return { name: { eq: state } };
  }
};

const toCategory = (raw: string): NotificationCategory =>
  (ALL_NOTIFICATION_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as NotificationCategory)
    : "feed";

// Structural subset shared by `Issue` and `IssueSearchResult`, so list and
// search results can both be summarised by one mapper.
type SummarisableIssue = Pick<
  Issue,
  | "id"
  | "identifier"
  | "title"
  | "priority"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "canceledAt"
  | "url"
  | "state"
  | "team"
>;

const toSummary = async (issue: SummarisableIssue): Promise<IssueSummary> => {
  const [state, team] = await Promise.all([issue.state, issue.team]);
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    state: state?.name,
    priority: issue.priority,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    completedAt: issue.completedAt ?? undefined,
    canceledAt: issue.canceledAt ?? undefined,
    team: team?.name,
    url: issue.url,
  };
};

const collectIssues = async (
  client: LinearClient,
  filter: IssueQueryFilter,
  limit: number,
): Promise<IssueSummary[]> => {
  const issues: IssueSummary[] = [];
  let cursor: string | null = null;

  while (issues.length < limit) {
    const page = await client.issues({
      filter,
      first: Math.min(PAGE_SIZE, limit - issues.length),
      ...(cursor ? { after: cursor } : {}),
    });
    for (const node of page.nodes) issues.push(await toSummary(node));
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor ?? null;
    if (!cursor) break;
  }

  return issues.slice(0, limit);
};

const toDetail = async (issue: Issue): Promise<IssueDetail> => {
  const [state, team, project, milestone, parent, assignee, creator, labels] =
    await Promise.all([
      issue.state,
      issue.team,
      issue.project,
      issue.projectMilestone,
      issue.parent,
      issue.assignee,
      issue.creator,
      issue.labels(),
    ]);

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    state: state?.name,
    priority: issue.priority,
    estimate: issue.estimate ?? undefined,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    completedAt: issue.completedAt ?? undefined,
    canceledAt: issue.canceledAt ?? undefined,
    dueDate: issue.dueDate ?? undefined,
    team: team?.name,
    project: project?.name,
    milestone: milestone?.name,
    parent: parent?.identifier,
    assignee: assignee?.name,
    creator: creator?.name,
    url: issue.url,
    labels: labels.nodes.map((l) => l.name),
  };
};

/**
 * The Linear API surface, exposed as an Effect service. Every method returns an
 * Effect whose error channel is the typed {@link LinearCliError} union — raw
 * `@linear/sdk` failures are routed through {@link mapLinearError} by the single
 * `call` helper, so error handling is never copy-pasted.
 *
 * `Linear.Default` is the stable layer; it reads `LINEAR_API_KEY` via `Config`.
 */
export class Linear extends Effect.Service<Linear>()("Linear", {
  effect: Effect.gen(function* () {
    // The Linear client is built lazily — the first time a command actually
    // hits the API — so `linear --help` / `--version` never require a key.
    const getClient = yield* Effect.cached(
      Effect.map(
        linearApiKey,
        (key) => new LinearClient({ apiKey: Redacted.value(key) }),
      ),
    );

    const call = <A>(
      operation: string,
      fn: (client: LinearClient) => Promise<A>,
    ) =>
      getClient.pipe(
        Effect.flatMap((client) =>
          Effect.tryPromise({
            try: () => fn(client),
            catch: mapLinearError(operation),
          }),
        ),
      );

    // Viewer id is needed for `--assignee me`; resolve it at most once.
    const viewerId = yield* Effect.cached(
      call("getViewer", async (client) => (await client.viewer).id),
    );

    const listIssues = (filter?: IssueFilter) =>
      Effect.gen(function* () {
        const queryFilter: IssueQueryFilter = {};
        if (filter?.assignee) {
          const id =
            filter.assignee === "me" ? yield* viewerId : filter.assignee;
          queryFilter.assignee = { id: { eq: id } };
        }
        if (filter?.state) queryFilter.state = stateFilter(filter.state);
        if (filter?.team) queryFilter.team = { key: { eq: filter.team } };
        if (filter?.project) queryFilter.project = { id: { eq: filter.project } };
        if (filter?.cycle) queryFilter.cycle = { id: { eq: filter.cycle } };
        return yield* call("listIssues", (client) =>
          collectIssues(client, queryFilter, filter?.limit ?? PAGE_SIZE),
        );
      });

    const getIssue = (identifier: string) =>
      call("getIssue", async (client) => toDetail(await client.issue(identifier)));

    const createIssue = (input: CreateIssueInput) =>
      call("createIssue", async (client) => {
        const arg: CreateIssueArg = {
          title: input.title,
          teamId: input.teamId,
          description: input.description,
          priority: input.priority,
          estimate: input.estimate,
          assigneeId: input.assigneeId,
          projectId: input.projectId,
          stateId: input.stateId,
          labelIds: input.labelIds,
          cycleId: input.cycleId,
          projectMilestoneId: input.projectMilestoneId,
          parentId: input.parentId,
        };
        const result = await client.createIssue(arg);
        const issue = await result.issue;
        if (!issue) throw new Error("Issue not returned after creation");
        return toDetail(issue);
      });

    const updateIssue = (issueId: string, input: UpdateIssueInput) =>
      call("updateIssue", async (client) => {
        const arg: UpdateIssueArg = {
          title: input.title,
          description: input.description,
          priority: input.priority,
          estimate: input.estimate,
          stateId: input.stateId,
          assigneeId: input.assigneeId,
          projectId: input.projectId,
          labelIds: input.labelIds,
          cycleId: input.cycleId,
          projectMilestoneId: input.projectMilestoneId,
        };
        const result = await client.updateIssue(issueId, arg);
        const issue = await result.issue;
        if (!issue) throw new Error("Issue not returned after update");
        return toDetail(issue);
      });

    const searchIssues = (query: string, limit = PAGE_SIZE) =>
      call("searchIssues", async (client) => {
        const result = await client.searchIssues(query, { first: limit });
        return Promise.all(result.nodes.map(toSummary));
      });

    const addComment = (issueId: string, body: string) =>
      call("addComment", async (client) => {
        const result = await client.createComment({ issueId, body });
        const comment = await result.comment;
        return comment?.id ?? "created";
      });

    const buildNotification = async (
      n: NotificationNode,
    ): Promise<Notification> => {
      const actor = await n.actor;
      const actorName = typeof actor === "string" ? actor : actor?.name;
      const notification: Notification = {
        id: n.id,
        type: n.type,
        category: toCategory(n.category),
        createdAt: n.createdAt,
      };
      if (actorName) notification.actor = actorName;
      if (n.readAt) notification.readAt = n.readAt;
      if (n.archivedAt) notification.archivedAt = n.archivedAt;

      if (n instanceof IssueNotification) {
        const issue = await n.issue;
        if (issue) {
          notification.issueId = issue.id;
          notification.issueIdentifier = issue.identifier;
          notification.issueTitle = issue.title;
        }
        const comment = await n.comment;
        if (comment?.body) {
          notification.commentBody =
            comment.body.length > 200
              ? comment.body.slice(0, 200) + "..."
              : comment.body;
        }
      } else if (n instanceof ProjectNotification) {
        const project = await n.project;
        if (project) notification.projectName = project.name;
      }

      return notification;
    };

    const getInbox = (filter?: InboxFilter) =>
      call("getInbox", async (client) => {
        const unreadOnly = filter?.unreadOnly ?? true;
        const limit = filter?.limit ?? PAGE_SIZE;
        const notifications: Notification[] = [];
        let cursor: string | null = null;

        while (notifications.length < limit) {
          const page = await client.notifications({
            first: PAGE_SIZE,
            ...(cursor ? { after: cursor } : {}),
          });
          for (const n of page.nodes) {
            if (n.archivedAt) continue;
            if (unreadOnly && n.readAt) continue;
            const built = await buildNotification(n);
            if (filter?.categories && !filter.categories.includes(built.category))
              continue;
            notifications.push(built);
            if (notifications.length >= limit) break;
          }
          if (!page.pageInfo.hasNextPage) break;
          cursor = page.pageInfo.endCursor ?? null;
          if (!cursor) break;
        }

        return summariseInbox(notifications);
      });

    const markNotificationRead = (id: string) =>
      call("markNotificationRead", async (client) => {
        await client.updateNotification(id, { readAt: new Date() });
      });

    const markAllNotificationsRead = () =>
      call("markAllNotificationsRead", async (client) => {
        await client.notificationMarkReadAll({}, new Date());
      });

    const archiveNotification = (id: string) =>
      call("archiveNotification", async (client) => {
        await client.archiveNotification(id);
      });

    const archiveAllRead = () =>
      call("archiveAllRead", async (client) => {
        const ids: string[] = [];
        let cursor: string | null = null;
        let more = true;
        while (more) {
          const page = await client.notifications({
            first: 100,
            ...(cursor ? { after: cursor } : {}),
          });
          for (const n of page.nodes) {
            if (n.readAt && !n.archivedAt) ids.push(n.id);
          }
          more = page.pageInfo.hasNextPage;
          cursor = page.pageInfo.endCursor ?? null;
          if (!cursor) more = false;
        }
        for (let i = 0; i < ids.length; i += 10) {
          await Promise.all(
            ids.slice(i, i + 10).map((id) => client.archiveNotification(id)),
          );
        }
        return { archived: ids.length, found: ids.length };
      });

    const listUsers = () =>
      call("listUsers", async (client) => {
        const users: LinearUser[] = [];
        let cursor: string | null = null;
        let more = true;
        while (more) {
          const page = await client.users({
            first: PAGE_SIZE,
            ...(cursor ? { after: cursor } : {}),
          });
          for (const u of page.nodes) {
            users.push({
              id: u.id,
              name: u.name,
              email: u.email,
              displayName: u.displayName,
              active: u.active,
              admin: u.admin,
              createdAt: u.createdAt,
            });
          }
          more = page.pageInfo.hasNextPage;
          cursor = page.pageInfo.endCursor ?? null;
          if (!cursor) more = false;
        }
        return users;
      });

    const getUserIssues = (userId: string, state?: string, limit = 100) =>
      call("getUserIssues", (client) => {
        const queryFilter: IssueQueryFilter = { assignee: { id: { eq: userId } } };
        if (state) queryFilter.state = stateFilter(state);
        return collectIssues(client, queryFilter, limit);
      });

    const getUserComments = (userId: string, since?: string, limit = 100) =>
      call("getUserComments", async (client) => {
        const sinceTs = since ? new Date(since).getTime() : 0;
        const comments: Comment[] = [];
        let cursor: string | null = null;
        while (comments.length < limit) {
          const page = await client.comments({
            filter: { user: { id: { eq: userId } } },
            first: PAGE_SIZE,
            ...(cursor ? { after: cursor } : {}),
          });
          for (const c of page.nodes) {
            if (sinceTs && c.createdAt.getTime() < sinceTs) continue;
            const issue = await c.issue;
            comments.push({
              id: c.id,
              body: c.body,
              createdAt: c.createdAt,
              updatedAt: c.updatedAt,
              issueId: issue?.id,
              issueIdentifier: issue?.identifier,
              issueTitle: issue?.title,
            });
            if (comments.length >= limit) break;
          }
          if (!page.pageInfo.hasNextPage) break;
          cursor = page.pageInfo.endCursor ?? null;
          if (!cursor) break;
        }
        return comments;
      });

    const getUserActivity = (userId: string, since?: string) =>
      call("getUserActivity", (client) =>
        collectUserActivity(client, userId, since),
      );

    const getIssueHistory = (issueId: string) =>
      call("getIssueHistory", (client) => collectIssueHistory(client, issueId));

    const listProjects = (teamKey?: string, limit = PAGE_SIZE) =>
      call("listProjects", async (client) => {
        const result = await client.projects({ first: 100 });
        const projects: ProjectSummary[] = [];
        for (const project of result.nodes) {
          const teams = await project.teams();
          const team = teams.nodes[0];
          if (!team) continue;
          if (teamKey && team.key !== teamKey) continue;
          projects.push({
            id: project.id,
            name: project.name,
            teamKey: team.key,
            teamId: team.id,
            state: project.state,
            updatedAt: project.updatedAt.toISOString(),
          });
        }
        projects.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        return projects.slice(0, limit);
      });

    const getProject = (projectId: string) =>
      call("getProject", async (client) => {
        const project = await client.project(projectId);
        const teams = await project.teams();
        const team = teams.nodes[0];
        const summary: ProjectSummary = {
          id: project.id,
          name: project.name,
          teamKey: team?.key ?? "-",
          teamId: team?.id ?? "-",
          state: project.state,
          updatedAt: project.updatedAt.toISOString(),
        };
        return summary;
      });

    const getProjectMilestones = (projectId: string) =>
      call("getProjectMilestones", async (client) => {
        const project = await client.project(projectId);
        const milestones = await project.projectMilestones();
        return milestones.nodes.map(
          (m): ProjectMilestone => ({
            id: m.id,
            name: m.name,
            description: m.description ?? undefined,
            targetDate: m.targetDate ?? undefined,
            progress: m.progress,
          }),
        );
      });

    const createProjectMilestone = (input: {
      projectId: string;
      name: string;
      description?: string;
      targetDate?: string;
    }) =>
      call("createProjectMilestone", async (client) => {
        const arg: CreateMilestoneArg = {
          projectId: input.projectId,
          name: input.name,
          description: input.description,
          targetDate: input.targetDate,
        };
        const result = await client.createProjectMilestone(arg);
        const milestone = await result.projectMilestone;
        if (!milestone) throw new Error("Milestone not returned after creation");
        return {
          id: milestone.id,
          name: milestone.name,
          description: milestone.description ?? undefined,
          targetDate: milestone.targetDate ?? undefined,
          progress: milestone.progress,
        } satisfies ProjectMilestone;
      });

    const createProject = (input: {
      name: string;
      teamId: string;
      leadId?: string;
      description?: string;
      targetDate?: string;
      statusId?: string;
      initiativeId?: string;
    }) =>
      call("createProject", async (client) => {
        const arg: CreateProjectArg = {
          name: input.name,
          teamIds: [input.teamId],
          leadId: input.leadId,
          description: input.description,
          targetDate: input.targetDate,
          statusId: input.statusId,
        };
        const result = await client.createProject(arg);
        const project = await result.project;
        if (!project) throw new Error("Project not returned after creation");
        if (input.initiativeId !== undefined) {
          const link = await client.createInitiativeToProject({
            initiativeId: input.initiativeId,
            projectId: project.id,
          });
          if (!link.success)
            throw new Error("Project created but failed to link to initiative");
        }
        return {
          id: project.id,
          name: project.name,
          state: project.state,
          url: project.url,
          initiativeId: input.initiativeId,
        } satisfies CreatedProject;
      });

    const listProjectStatuses = () =>
      call("listProjectStatuses", async (client) => {
        const result = await client.projectStatuses();
        return result.nodes
          .map(
            (s): ProjectStatus => ({
              id: s.id,
              name: s.name,
              type: s.type,
              position: s.position,
            }),
          )
          .sort((a, b) => a.position - b.position);
      });

    const updateProject = (
      id: string,
      input: {
        name?: string;
        statusId?: string;
        leadId?: string;
        description?: string;
        targetDate?: string;
      },
    ) =>
      call("updateProject", async (client) => {
        const arg: UpdateProjectArg = {
          name: input.name,
          statusId: input.statusId,
          leadId: input.leadId,
          description: input.description,
          targetDate: input.targetDate,
        };
        const result = await client.updateProject(id, arg);
        const project = await result.project;
        if (!project) throw new Error("Project not returned after update");
        return {
          id: project.id,
          name: project.name,
          state: project.state,
          url: project.url,
        } satisfies UpdatedProject;
      });

    const postProjectUpdate = (
      projectId: string,
      body: string,
      health?: ProjectHealth,
    ) =>
      call("postProjectUpdate", async (client) => {
        const arg: CreateProjectUpdateArg = {
          projectId,
          body,
          health: health ? HEALTH[health] : undefined,
        };
        const result = await client.createProjectUpdate(arg);
        const update = await result.projectUpdate;
        return update?.id ?? "created";
      });

    const createDocument = (
      title: string,
      content: string,
      opts: { projectId?: string; teamId?: string; issueId?: string },
    ) =>
      call("createDocument", async (client) => {
        const arg: CreateDocumentArg = {
          title,
          content,
          projectId: opts.projectId,
          teamId: opts.teamId,
          issueId: opts.issueId,
        };
        const result = await client.createDocument(arg);
        const doc = await result.document;
        if (!doc) throw new Error("Document not returned after creation");
        return {
          id: doc.id,
          title: doc.title,
          url: doc.url,
          slugId: doc.slugId,
        } satisfies CreatedDocument;
      });

    const listViews = () =>
      call("listViews", async (client) => {
        const result = await client.customViews({ first: PAGE_SIZE });
        const views: CustomView[] = [];
        for (const v of result.nodes) {
          const owner = await v.owner;
          views.push({
            id: v.id,
            name: v.name,
            description: v.description ?? undefined,
            slugId: v.slugId,
            shared: v.shared,
            owner: owner?.name,
          });
        }
        return views;
      });

    const getViewIssues = (viewId: string, limit = PAGE_SIZE) =>
      call("getViewIssues", async (client) => {
        const view = await client.customView(viewId);
        const result = await view.issues({ first: limit });
        return Promise.all(result.nodes.map(toSummary));
      });

    const listFavorites = () =>
      call("listFavorites", (client) => collectFavorites(client));

    const listCycles = (teamId: string, type?: "current" | "previous" | "next") =>
      call("listCycles", (client) => collectCycles(client, teamId, type));

    return {
      listIssues,
      getIssue,
      createIssue,
      updateIssue,
      searchIssues,
      addComment,
      getInbox,
      markNotificationRead,
      markAllNotificationsRead,
      archiveNotification,
      archiveAllRead,
      listUsers,
      getUserIssues,
      getUserComments,
      getUserActivity,
      getIssueHistory,
      listProjects,
      getProject,
      getProjectMilestones,
      createProjectMilestone,
      createProject,
      listProjectStatuses,
      updateProject,
      postProjectUpdate,
      createDocument,
      listViews,
      getViewIssues,
      listFavorites,
      listCycles,
    };
  }),
}) {}

// ============================================
// Module-level helpers (kept out of the service generator for readability)
// ============================================

const summariseInbox = (notifications: Notification[]): Inbox => {
  const byCategory = Object.fromEntries(
    ALL_NOTIFICATION_CATEGORIES.map((cat) => [
      cat,
      notifications.filter((n) => n.category === cat).length,
    ]),
  ) as Record<NotificationCategory, number>;
  return {
    summary: {
      total: notifications.length,
      unread: notifications.filter((n) => !n.readAt).length,
      byCategory,
    },
    notifications,
  };
};

const defaultSince = (): string =>
  new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const collectUserActivity = async (
  client: LinearClient,
  userId: string,
  sinceDate?: string,
): Promise<UserActivity> => {
  const since = sinceDate ?? defaultSince();
  const sinceTs = new Date(since).getTime();
  const activities: Activity[] = [];

  const stateMap = new Map<string, string>();
  const states = await client.workflowStates({ first: 100 });
  for (const s of states.nodes) stateMap.set(s.id, s.name);

  const issues = await client.issues({
    filter: { assignee: { id: { eq: userId } } },
    first: 100,
  });

  for (const issue of issues.nodes) {
    const history = await issue.history({ first: 100 });
    for (const entry of history.nodes) {
      if (entry.createdAt.getTime() < sinceTs) continue;
      const actor = await entry.actor;
      if (actor?.id !== userId) continue;
      const ref = {
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        issueTitle: issue.title,
      };

      if (entry.fromStateId && entry.toStateId) {
        activities.push({
          type: "state_change",
          timestamp: entry.createdAt,
          ...ref,
          details: {
            fromState: stateMap.get(entry.fromStateId) ?? entry.fromStateId,
            toState: stateMap.get(entry.toStateId) ?? entry.toStateId,
          },
        });
      }
      if (entry.toAssigneeId === userId && !entry.fromAssigneeId) {
        activities.push({
          type: "assignment",
          timestamp: entry.createdAt,
          ...ref,
          details: {},
        });
      }
      if (entry.fromPriority != null && entry.toPriority != null) {
        activities.push({
          type: "priority_change",
          timestamp: entry.createdAt,
          ...ref,
          details: {
            fromPriority: entry.fromPriority,
            toPriority: entry.toPriority,
          },
        });
      }
    }
  }

  const comments = await client.comments({
    filter: { user: { id: { eq: userId } } },
    first: 100,
  });
  for (const c of comments.nodes) {
    if (c.createdAt.getTime() < sinceTs) continue;
    const issue = await c.issue;
    if (!issue) continue;
    activities.push({
      type: "comment",
      timestamp: c.createdAt,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      details: {
        body: c.body.length > 100 ? c.body.slice(0, 100) + "..." : c.body,
      },
    });
  }

  activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const byDay: Record<string, Activity[]> = {};
  for (const a of activities) {
    const day = a.timestamp.toISOString().slice(0, 10);
    (byDay[day] ??= []).push(a);
  }

  return {
    userId,
    sinceDate: since,
    byDay,
    summary: {
      totalActivities: activities.length,
      comments: activities.filter((a) => a.type === "comment").length,
      stateChanges: activities.filter((a) => a.type === "state_change").length,
      assignments: activities.filter((a) => a.type === "assignment").length,
      priorityChanges: activities.filter((a) => a.type === "priority_change")
        .length,
    },
  };
};

const collectIssueHistory = async (
  client: LinearClient,
  issueId: string,
): Promise<HistoryEntry[]> => {
  const stateMap = new Map<string, string>();
  const userMap = new Map<string, string>();
  const [states, users] = await Promise.all([
    client.workflowStates({ first: 100 }),
    client.users({ first: 100 }),
  ]);
  for (const s of states.nodes) stateMap.set(s.id, s.name);
  for (const u of users.nodes) userMap.set(u.id, u.name);

  const issue = await client.issue(issueId);
  const history = await issue.history({ first: 100 });

  const entries: HistoryEntry[] = [];
  for (const entry of history.nodes) {
    const actor = await entry.actor;
    const out: HistoryEntry = { id: entry.id, createdAt: entry.createdAt };
    if (actor) {
      out.actorId = actor.id;
      out.actorName = actor.name;
    }
    if (entry.fromStateId)
      out.fromState = stateMap.get(entry.fromStateId) ?? entry.fromStateId;
    if (entry.toStateId)
      out.toState = stateMap.get(entry.toStateId) ?? entry.toStateId;
    if (entry.fromAssigneeId)
      out.fromAssignee =
        userMap.get(entry.fromAssigneeId) ?? entry.fromAssigneeId;
    if (entry.toAssigneeId)
      out.toAssignee = userMap.get(entry.toAssigneeId) ?? entry.toAssigneeId;
    if (entry.fromPriority != null) out.fromPriority = entry.fromPriority;
    if (entry.toPriority != null) out.toPriority = entry.toPriority;
    if (entry.addedLabelIds?.length) out.addedLabels = entry.addedLabelIds;
    if (entry.removedLabelIds?.length) out.removedLabels = entry.removedLabelIds;
    entries.push(out);
  }
  return entries;
};

const collectFavorites = async (client: LinearClient): Promise<Favorite[]> => {
  const result = await client.favorites({ first: PAGE_SIZE });
  const favorites: Favorite[] = [];
  for (const f of result.nodes) {
    const fav: Favorite = { id: f.id, type: f.type };
    const view = await f.customView;
    if (view) {
      fav.viewId = view.id;
      fav.title = view.name;
    }
    const project = await f.project;
    if (project) {
      fav.projectId = project.id;
      fav.title = project.name;
    }
    const cycle = await f.cycle;
    if (cycle) {
      fav.cycleId = cycle.id;
      fav.title = `Cycle ${cycle.number}`;
    }
    const label = await f.label;
    if (label) {
      fav.labelId = label.id;
      fav.title = label.name;
    }
    if (fav.title) favorites.push(fav);
  }
  return favorites;
};

const toCycle = (c: {
  id: string;
  number: number;
  name?: string | null;
  startsAt: Date;
  endsAt: Date;
  completedIssueCountHistory?: number[];
  issueCountHistory?: number[];
}): Cycle => {
  const completed = c.completedIssueCountHistory?.at(-1) ?? 0;
  const total = c.issueCountHistory?.at(-1) ?? 0;
  return {
    id: c.id,
    number: c.number,
    name: c.name ?? undefined,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    completedIssueCount: completed,
    totalIssueCount: total,
    progress: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
};

const collectCycles = async (
  client: LinearClient,
  teamId: string,
  type?: "current" | "previous" | "next",
): Promise<Cycle[]> => {
  const team = await client.team(teamId);
  if (type === "current") {
    const cycle = await team.activeCycle;
    return cycle ? [toCycle(cycle)] : [];
  }
  const cycles = await team.cycles({ first: 10 });
  return cycles.nodes.map(toCycle);
};
