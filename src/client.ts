import { Effect, Redacted, type ConfigError } from "effect";
import {
  LinearClient,
  IssueNotification,
  ProjectNotification,
  ProjectUpdateHealthType,
} from "@linear/sdk";
import { linearApiKey } from "./config";
import { ValidationError, mapLinearError, type LinearCliError } from "./errors";
import {
  ISSUE_COMMENTS_QUERY,
  ISSUE_DETAIL_QUERY,
  ISSUE_LIST_QUERY,
  ISSUE_SEARCH_QUERY,
  PROJECT_DETAIL_QUERY,
  TEAMS_QUERY,
  VIEW_ISSUES_QUERY,
  WORKFLOW_STATES_QUERY,
  type GqlCommentNode,
  type GqlConnection,
  type GqlIssueDetailNode,
  type GqlIssueNode,
  type GqlTeamNode,
  type GqlWorkflowStateNode,
  type IssueCommentsResponse,
  type IssueDetailResponse,
  type IssueListResponse,
  type IssueSearchResponse,
  type GqlProjectDetailNode,
  type ProjectDetailResponse,
  type TeamsResponse,
  type ViewIssuesResponse,
  type WorkflowStatesResponse,
} from "./gql";
import {
  ALL_NOTIFICATION_CATEGORIES,
  type Activity,
  type Comment,
  type CreateIssueInput,
  type CreatedDocument,
  type CreatedProject,
  type CreatedView,
  type Cycle,
  type CustomView,
  type Favorite,
  type HistoryEntry,
  type Inbox,
  type IssueComment,
  type IssueDetail,
  type IssueFilter,
  type IssueSummary,
  type LinearUser,
  type Notification,
  type NotificationCategory,
  type InboxFilter,
  type PageInfo,
  type Paged,
  type ProjectDetail,
  type ProjectLink,
  type ProjectMilestone,
  type ProjectStatus,
  type ProjectSummary,
  type TeamSummary,
  type UpdateIssueInput,
  type UpdateIssueRequest,
  type UpdatedProject,
  type UserActivity,
  type Viewer,
  type IssueLabel,
  type WorkflowState,
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
type UpdateMilestoneArg = Parameters<LinearClient["updateProjectMilestone"]>[1];
type CreateExternalLinkArg = Parameters<LinearClient["createEntityExternalLink"]>[0];
type CreateDocumentArg = Parameters<LinearClient["createDocument"]>[0];
type CreateProjectUpdateArg = Parameters<LinearClient["createProjectUpdate"]>[0];
type CreateCustomViewArg = Parameters<LinearClient["createCustomView"]>[0];
type NotificationNode = Awaited<
  ReturnType<LinearClient["notifications"]>
>["nodes"][number];

const PAGE_SIZE = 50;

/** Enumerating states, teams and users is bounded; one big page is enough. */
const BULK_PAGE_SIZE = 250;

const HEALTH: Record<ProjectHealth, ProjectUpdateHealthType> = {
  onTrack: ProjectUpdateHealthType.OnTrack,
  atRisk: ProjectUpdateHealthType.AtRisk,
  offTrack: ProjectUpdateHealthType.OffTrack,
};

export type ProjectHealth = "onTrack" | "atRisk" | "offTrack";

/**
 * What any service method can fail with.
 *
 * `ConfigError` rides along because the API key is read lazily — a command only
 * discovers there is no usable key at the moment it first needs one. `cli.ts`
 * catches it separately and turns it into setup instructions.
 */
type ServiceError = LinearCliError | ConfigError.ConfigError;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is already a Linear id, or a human name we have to look up. */
export const isUuid = (value: string): boolean => UUID.test(value.trim());

/** Translate the CLI's `--state` keyword (or a literal state name) into a filter. */
export const stateFilter = (state: string): IssueQueryFilter["state"] => {
  switch (state) {
    case "active":
      return { type: { in: ["started", "unstarted"] } };
    // "Everything still on my plate." Distinct from `active`, which excludes
    // triage and backlog — a day view built on `active` silently hides freshly
    // captured work, which is exactly the work most likely to matter today.
    case "open":
      return { type: { nin: ["completed", "canceled"] } };
    case "completed":
      return { type: { eq: "completed" } };
    case "canceled":
      return { type: { eq: "canceled" } };
    default:
      return { name: { eqIgnoreCase: state } };
  }
};

const toCategory = (raw: string): NotificationCategory =>
  (ALL_NOTIFICATION_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as NotificationCategory)
    : "feed";

// ============================================
// Pagination
// ============================================

const pageInfoOf = (input: {
  returned: number;
  limit: number;
  hasNextPage: boolean;
  endCursor?: string | undefined;
  totalCount?: number | undefined;
}): PageInfo => ({
  returned: input.returned,
  limit: input.limit,
  hasNextPage: input.hasNextPage,
  truncated: input.hasNextPage,
  endCursor: input.endCursor,
  totalCount: input.totalCount,
});

/**
 * Wrap a list that was fetched in full. `truncated: false` here is a claim, not
 * a default — only use it where every page really was walked.
 */
const complete = <T>(items: T[], totalCount?: number): Paged<T> => ({
  items,
  pageInfo: pageInfoOf({
    returned: items.length,
    limit: items.length,
    hasNextPage: false,
    totalCount: totalCount ?? items.length,
  }),
});

/**
 * Page through a connection until `limit` items are collected, reporting
 * honestly whether anything was left behind.
 */
const collectPaged = <Node, Item, E>(
  limit: number,
  fetchPage: (
    first: number,
    after: string | undefined,
  ) => Effect.Effect<{ connection: GqlConnection<Node>; totalCount?: number }, E>,
  map: (node: Node) => Item,
): Effect.Effect<Paged<Item>, E> =>
  Effect.gen(function* () {
    const items: Item[] = [];
    let cursor: string | undefined;
    let hasNextPage = false;
    let totalCount: number | undefined;

    while (items.length < limit) {
      const page = yield* fetchPage(
        Math.min(PAGE_SIZE, limit - items.length),
        cursor,
      );
      if (page.totalCount !== undefined) totalCount = page.totalCount;
      for (const node of page.connection.nodes) items.push(map(node));
      hasNextPage = page.connection.pageInfo.hasNextPage;
      cursor = page.connection.pageInfo.endCursor ?? undefined;
      if (!hasNextPage || !cursor) break;
    }

    return {
      items,
      pageInfo: pageInfoOf({
        returned: items.length,
        limit,
        hasNextPage,
        endCursor: hasNextPage ? cursor : undefined,
        totalCount,
      }),
    };
  });

// ============================================
// GraphQL → domain mappers
// ============================================

const toDate = (value: string | null | undefined): Date | undefined =>
  value ? new Date(value) : undefined;

const summaryOf = (node: GqlIssueNode): IssueSummary => ({
  id: node.id,
  identifier: node.identifier,
  title: node.title,
  state: node.state?.name?.trim(),
  stateType: node.state?.type,
  priority: node.priority,
  createdAt: new Date(node.createdAt),
  updatedAt: new Date(node.updatedAt),
  completedAt: toDate(node.completedAt),
  canceledAt: toDate(node.canceledAt),
  dueDate: node.dueDate ?? undefined,
  team: node.team?.name,
  teamKey: node.team?.key,
  project: node.project?.name,
  assignee: node.assignee?.displayName ?? node.assignee?.name,
  assigneeId: node.assignee?.id,
  labels: node.labels.nodes.map((l) => l.name),
  parent: node.parent?.identifier,
  url: node.url,
});

const detailOf = (node: GqlIssueDetailNode): IssueDetail => ({
  ...summaryOf(node),
  description: node.description ?? undefined,
  estimate: node.estimate ?? undefined,
  creator: node.creator?.name,
  milestone: node.projectMilestone?.name,
  children: node.children.nodes.map((c) => ({
    id: c.id,
    identifier: c.identifier,
    title: c.title,
    state: c.state?.name?.trim(),
    stateType: c.state?.type,
  })),
  attachments: node.attachments.nodes.map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    sourceType: a.sourceType ?? undefined,
  })),
});

const commentOf = (node: GqlCommentNode): IssueComment => ({
  id: node.id,
  body: node.body,
  createdAt: new Date(node.createdAt),
  updatedAt: new Date(node.updatedAt),
  authorId: node.user?.id,
  author: node.user?.displayName ?? node.user?.name,
  authorEmail: node.user?.email ?? undefined,
  parentId: node.parent?.id,
  // A comment that starts a thread is its own root. Making that explicit means
  // grouping by `threadId` works without special-casing top-level comments.
  threadId: node.parent?.id ?? node.id,
  url: node.url ?? undefined,
  resolvedAt: toDate(node.resolvedAt),
});

const stateOf = (node: GqlWorkflowStateNode): WorkflowState => ({
  id: node.id,
  name: node.name.trim(),
  type: node.type,
  position: node.position,
  color: node.color ?? undefined,
  teamKey: node.team?.key,
  teamName: node.team?.name,
});

const teamOf = (node: GqlTeamNode): TeamSummary => ({
  id: node.id,
  key: node.key,
  name: node.name,
});

/** Map the one-query project read to the `project` --json contract. */
export const projectDetailOf = (
  node: GqlProjectDetailNode,
): { project: ProjectDetail; milestones: ProjectMilestone[] } => {
  const team = node.teams.nodes[0];
  const project: ProjectDetail = {
    id: node.id,
    name: node.name,
    teamKey: team?.key ?? "-",
    teamId: team?.id ?? "-",
    state: node.state,
    updatedAt: new Date(node.updatedAt).toISOString(),
    url: node.url,
    description: node.description || undefined,
    content: node.content || undefined,
    status: node.status?.name,
    lead: node.lead ? (node.lead.displayName ?? node.lead.name) : undefined,
    startDate: node.startDate ?? undefined,
    targetDate: node.targetDate ?? undefined,
    links: node.externalLinks.nodes.map((l) => ({
      id: l.id,
      label: l.label,
      url: l.url,
    })),
    documents: node.documents.nodes.map((d) => ({
      id: d.id,
      title: d.title,
      url: d.url,
    })),
  };
  const milestones = [...node.projectMilestones.nodes]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(
      (m): ProjectMilestone => ({
        id: m.id,
        name: m.name,
        description: m.description ?? undefined,
        targetDate: m.targetDate ?? undefined,
        progress: m.progress,
      }),
    );
  return { project, milestones };
};

/**
 * `--since`, accepted as either a date or a full instant.
 *
 * A bare `YYYY-MM-DD` cannot order two messages exchanged the same afternoon,
 * which is the common case when the target is a four-hour response time — so
 * an instant has to be expressible. An unparseable value is an error rather
 * than a silently-dropped filter: `--since $UNSET` previously widened the query
 * to all time and looked like a quiet day.
 */
export const parseSince = (
  operation: string,
  value: string,
): Effect.Effect<Date, ValidationError> => {
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime())
    ? Effect.fail(
        new ValidationError({
          operation,
          field: "since",
          message:
            `'${value}' is not a date or timestamp. Use YYYY-MM-DD for a ` +
            `whole day, or an ISO-8601 instant such as ` +
            `2026-07-30T14:30:00Z when ordering within a day matters.`,
        }),
      )
    : Effect.succeed(parsed);
};

const listOf = (values: readonly string[]): string =>
  values.length > 0 ? values.join(", ") : "(none)";

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
    ): Effect.Effect<A, ServiceError> =>
      getClient.pipe(
        Effect.flatMap((client) =>
          Effect.tryPromise({
            try: () => fn(client),
            catch: mapLinearError(operation),
          }),
        ),
      );

    /**
     * Run a hand-written GraphQL document.
     *
     * `rawRequest` rather than `request`: only the former converts failures into
     * a `LinearError`, which is what {@link mapLinearError} knows how to
     * classify. `request` throws a bare client error that would land in the
     * catch-all and lose the 429 vs 503 distinction.
     */
    const raw = <Data>(
      operation: string,
      query: string,
      variables: Record<string, unknown>,
    ): Effect.Effect<Data, ServiceError> =>
      call(operation, async (client) => {
        const response = await client.client.rawRequest<
          Data,
          Record<string, unknown>
        >(query, variables);
        if (!response.data) {
          throw new Error("the API returned no data");
        }
        return response.data;
      });

    // Viewer id is needed for `--assignee me`; resolve it at most once.
    const viewerId = yield* Effect.cached(
      call("getViewer", async (client) => (await client.viewer).id),
    );

    const whoami = () =>
      call("whoami", async (client): Promise<Viewer> => {
        const v = await client.viewer;
        return {
          id: v.id,
          name: v.name,
          email: v.email,
          displayName: v.displayName,
        };
      });

    // ============================================
    // Lookup tables + resolvers
    //
    // Every "…Id" argument accepts a name a human would type. The three caches
    // below are what make that affordable: a ten-issue batch resolves its team,
    // state and assignee names against one fetch each, not thirty.
    // ============================================

    const allTeams = yield* Effect.cached(
      raw<TeamsResponse>("listTeams", TEAMS_QUERY, {
        first: BULK_PAGE_SIZE,
      }).pipe(Effect.map((r) => r.teams.nodes.map(teamOf))),
    );

    const allStates = yield* Effect.cached(
      raw<WorkflowStatesResponse>("listStates", WORKFLOW_STATES_QUERY, {
        first: BULK_PAGE_SIZE,
      }).pipe(Effect.map((r) => r.workflowStates.nodes.map(stateOf))),
    );

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

    const allUsers = yield* Effect.cached(listUsers());

    /**
     * Accept a team key (`SPR`), a UUID, or the team's name — interchangeably.
     *
     * Previously `issues --team` wanted the key while `cycles` wanted the UUID,
     * and supplying the wrong one returned an empty list rather than an error:
     * the failure looked exactly like "that team has no work".
     */
    const resolveTeam = (value: string): Effect.Effect<TeamSummary, ServiceError> =>
      Effect.gen(function* () {
        const wanted = value.trim().toLowerCase();
        const teams = yield* allTeams;
        const match =
          teams.find((t) => t.key.toLowerCase() === wanted) ??
          teams.find((t) => t.id.toLowerCase() === wanted) ??
          teams.find((t) => t.name.toLowerCase() === wanted);
        if (match) return match;
        return yield* Effect.fail(
          new ValidationError({
            operation: "resolveTeam",
            field: "team",
            message:
              `no team matches '${value}'. Known teams: ` +
              `${listOf(teams.map((t) => `${t.key} (${t.name})`))}.`,
          }),
        );
      });

    /**
     * Accept `me`, a UUID, a display name, a full name, or an email.
     *
     * `me` working only on `issues --assignee` was the root of a whole class of
     * bugs: every other call site needed a UUID, so scripts carried a
     * `$MY_UUID` that silently expanded to nothing when unset.
     */
    const resolveUserId = (value: string): Effect.Effect<string, ServiceError> =>
      Effect.gen(function* () {
        const wanted = value.trim().toLowerCase();
        if (wanted === "me") return yield* viewerId;
        if (UUID.test(wanted)) return value.trim();
        const users = yield* allUsers;
        const matches = users.filter(
          (u) =>
            u.email.toLowerCase() === wanted ||
            u.displayName.toLowerCase() === wanted ||
            u.name.toLowerCase() === wanted,
        );
        if (matches.length === 1) return matches[0]!.id;
        if (matches.length === 0) {
          return yield* Effect.fail(
            new ValidationError({
              operation: "resolveUser",
              field: "assignee",
              message:
                `no user matches '${value}'. Use 'me', an email, a display ` +
                `name, or a user id — see \`linear users\`.`,
            }),
          );
        }
        return yield* Effect.fail(
          new ValidationError({
            operation: "resolveUser",
            field: "assignee",
            message:
              `'${value}' matches ${matches.length} users ` +
              `(${listOf(matches.map((u) => u.email))}). Use the email or id.`,
          }),
        );
      });

    const listStates = (teamKey?: string) =>
      Effect.gen(function* () {
        const states = yield* allStates;
        const team = teamKey ? yield* resolveTeam(teamKey) : undefined;
        const scoped = team
          ? states.filter((s) => s.teamKey === team.key)
          : states;
        return complete(
          [...scoped].sort(
            (a, b) =>
              (a.teamKey ?? "").localeCompare(b.teamKey ?? "") ||
              a.position - b.position,
          ),
        );
      });

    const listTeams = () =>
      Effect.map(allTeams, (teams) =>
        complete([...teams].sort((a, b) => a.key.localeCompare(b.key))),
      );

    /**
     * Accept a workflow state name (`In Progress`) or its UUID.
     *
     * State names repeat across teams, so a name is only unambiguous once the
     * team is known — hence `teamKey`. Callers that have an issue in hand pass
     * the issue's own team, which is why `update --state "In Progress"` works
     * without the caller naming a team at all.
     */
    const resolveStateId = (
      value: string,
      teamKey?: string,
    ): Effect.Effect<string, ServiceError> =>
      Effect.gen(function* () {
        const trimmed = value.trim();
        if (UUID.test(trimmed)) return trimmed;
        const states = yield* allStates;
        const wanted = trimmed.toLowerCase();
        const inScope = teamKey
          ? states.filter((s) => s.teamKey === teamKey)
          : states;
        const matches = inScope.filter(
          (s) => s.name.toLowerCase() === wanted,
        );
        if (matches.length === 1) return matches[0]!.id;
        if (matches.length === 0) {
          const where = teamKey ? ` in team ${teamKey}` : "";
          return yield* Effect.fail(
            new ValidationError({
              operation: "resolveState",
              field: "state",
              message:
                `no workflow state named '${value}'${where}. Available: ` +
                `${listOf([...new Set(inScope.map((s) => s.name))])}. ` +
                "Run `linear states` to see them with their ids.",
            }),
          );
        }
        return yield* Effect.fail(
          new ValidationError({
            operation: "resolveState",
            field: "state",
            message:
              `'${value}' exists in ${matches.length} teams ` +
              `(${listOf(matches.map((s) => s.teamKey ?? "?"))}). Pass --team.`,
          }),
        );
      });

    // ============================================
    // Issues
    // ============================================

    const buildIssueFilter = (filter?: IssueFilter) =>
      Effect.gen(function* () {
        const queryFilter: IssueQueryFilter = {};
        if (filter?.assignee) {
          queryFilter.assignee = {
            id: { eq: yield* resolveUserId(filter.assignee) },
          };
        }
        if (filter?.state) queryFilter.state = stateFilter(filter.state);
        if (filter?.team) {
          queryFilter.team = { key: { eq: (yield* resolveTeam(filter.team)).key } };
        }
        if (filter?.project) queryFilter.project = { id: { eq: filter.project } };
        if (filter?.cycle) queryFilter.cycle = { id: { eq: filter.cycle } };
        // Labels filter by name rather than id: a label only earns its keep if
        // you can type it, and ids would push every caller through a lookup.
        if (filter?.label) {
          queryFilter.labels = { name: { eqIgnoreCase: filter.label } };
        }
        return queryFilter;
      });

    const listIssues = (filter?: IssueFilter) =>
      Effect.gen(function* () {
        const queryFilter = yield* buildIssueFilter(filter);
        return yield* collectPaged(
          filter?.limit ?? PAGE_SIZE,
          (first, after) =>
            raw<IssueListResponse>("listIssues", ISSUE_LIST_QUERY, {
              filter: queryFilter,
              first,
              after,
            }).pipe(Effect.map((r) => ({ connection: r.issues }))),
          summaryOf,
        );
      });

    const getIssue = (identifier: string) =>
      raw<IssueDetailResponse>("getIssue", ISSUE_DETAIL_QUERY, {
        id: identifier,
      }).pipe(Effect.map((r) => detailOf(r.issue)));

    const searchIssues = (query: string, limit = PAGE_SIZE) =>
      collectPaged(
        limit,
        (first, after) =>
          raw<IssueSearchResponse>("searchIssues", ISSUE_SEARCH_QUERY, {
            term: query,
            first,
            after,
          }).pipe(
            Effect.map((r) => ({
              connection: r.searchIssues,
              totalCount: r.searchIssues.totalCount,
            })),
          ),
        summaryOf,
      );

    const getViewIssues = (viewId: string, limit = PAGE_SIZE) =>
      collectPaged(
        limit,
        (first, after) =>
          raw<ViewIssuesResponse>("getViewIssues", VIEW_ISSUES_QUERY, {
            id: viewId,
            first,
            after,
          }).pipe(Effect.map((r) => ({ connection: r.customView.issues }))),
        summaryOf,
      );

    /**
     * Every comment on one issue, in order, with its thread structure.
     *
     * The alternative — diffing per-author comment streams — cannot see a
     * reply's parent, misses anyone outside the set of authors you thought to
     * query, and silently drops whatever a `--limit` cut off. Reading the issue
     * itself has none of those failure modes.
     */
    const getIssueComments = (identifier: string, limit = PAGE_SIZE) =>
      collectPaged(
        limit,
        (first, after) =>
          raw<IssueCommentsResponse>("getIssueComments", ISSUE_COMMENTS_QUERY, {
            id: identifier,
            first,
            after,
          }).pipe(Effect.map((r) => ({ connection: r.issue.comments }))),
        commentOf,
      );

    // ============================================
    // Labels
    // ============================================

    /**
     * Every label available, optionally scoped to one team.
     *
     * Exists so labels can be referred to by name everywhere else. Without a
     * way to list them, `--label` would mean "paste a UUID".
     */
    const fetchLabels = (teamKey?: string) =>
      call("listLabels", async (client): Promise<IssueLabel[]> => {
        const result = await client.issueLabels({ first: BULK_PAGE_SIZE });
        const labels = await Promise.all(
          result.nodes.map(async (label) => {
            const [team, parent] = await Promise.all([label.team, label.parent]);
            return {
              id: label.id,
              name: label.name,
              color: label.color ?? undefined,
              group: parent?.name ?? undefined,
              teamKey: team?.key ?? undefined,
            };
          }),
        );
        const scoped = teamKey
          ? labels.filter((l) => l.teamKey === undefined || l.teamKey === teamKey)
          : labels;
        return scoped
          .map(({ teamKey: _omit, ...label }) => label)
          .sort((a, b) => a.name.localeCompare(b.name));
      });

    const allLabels = yield* Effect.cached(fetchLabels());

    const listLabels = (teamKey?: string) =>
      Effect.map(fetchLabels(teamKey), (labels) => complete(labels));

    /** Create a label. Idempotent by name — returns the existing one if it exists. */
    const createLabel = (input: {
      readonly name: string;
      readonly teamId?: string;
      readonly color?: string;
      readonly description?: string;
    }) =>
      Effect.gen(function* () {
        const existing = yield* allLabels;
        const match = existing.find(
          (l) => l.name.toLowerCase() === input.name.trim().toLowerCase(),
        );
        if (match) return match;
        return yield* call("createLabel", async (client): Promise<IssueLabel> => {
          const result = await client.createIssueLabel({
            name: input.name,
            teamId: input.teamId,
            color: input.color,
            description: input.description,
          });
          const label = await result.issueLabel;
          if (!label) throw new Error("Label not returned after creation");
          return { id: label.id, name: label.name, color: label.color ?? undefined };
        });
      });

    /** Resolve label names to ids, case-insensitively. Unknown names are an error. */
    const resolveLabelIds = (names: readonly string[]) =>
      Effect.gen(function* () {
        if (names.length === 0) return [] as string[];
        const all = yield* allLabels;
        const byName = new Map(all.map((l) => [l.name.toLowerCase(), l.id]));
        const ids: string[] = [];
        const missing: string[] = [];
        for (const name of names) {
          const id = byName.get(name.trim().toLowerCase());
          if (id) ids.push(id);
          else missing.push(name);
        }
        if (missing.length > 0) {
          return yield* Effect.fail(
            new ValidationError({
              operation: "resolveLabelIds",
              field: "label",
              message:
                `unknown label(s): ${missing.join(", ")}. ` +
                "Run `linear labels` to see what exists — labels are created in Linear, not here",
            }),
          );
        }
        return ids;
      });

    /**
     * Add or remove labels on one issue without disturbing the others.
     *
     * `updateIssue` takes `labelIds` as the *complete* set, so passing one label
     * silently strips every other label the issue had. That is a data-losing
     * footgun for a flag as casual as `--label`, so the read-merge-write lives
     * here and callers get add/remove semantics instead.
     */
    const changeLabels = (
      identifier: string,
      opts: { readonly add?: readonly string[]; readonly remove?: readonly string[] },
    ) =>
      Effect.gen(function* () {
        const addIds = yield* resolveLabelIds(opts.add ?? []);
        const removeIds = yield* resolveLabelIds(opts.remove ?? []);
        yield* call("changeLabels", async (client) => {
          const issue = await client.issue(identifier);
          const current = await issue.labels();
          const next = new Set(current.nodes.map((l) => l.id));
          for (const id of removeIds) next.delete(id);
          for (const id of addIds) next.add(id);
          await client.updateIssue(issue.id, { labelIds: [...next] });
        });
        // Re-read rather than trusting the mutation's echo: the detail query is
        // the one place the full issue shape is defined.
        return yield* getIssue(identifier);
      });

    // ============================================
    // Writes
    // ============================================

    /**
     * Link a Slack thread to an issue as a rich attachment.
     *
     * Not the same as pasting the URL into the description. When the workspace
     * has the Slack integration configured, this creates a two-way link: the
     * thread shows the issue's status, and closing the issue notifies the
     * thread. That is what lets someone who asked in Slack follow the work
     * without asking again — the whole point of acknowledging a request.
     *
     * Deliberately a separate call rather than part of `create`, because
     * linking is not always wanted: a thread with external participants should
     * get a ticket without leaking internal identifiers into a shared channel.
     */
    const linkSlackThread = (
      identifier: string,
      url: string,
      syncToCommentThread = true,
    ) =>
      call("attachmentLinkSlack", async (client) => {
        // The mutation needs the issue's UUID; callers work in SPR-1234 terms.
        const issue = await client.issue(identifier);
        // `syncToCommentThread` decides whether the *asker* learns anything.
        //
        //   false — the attachment exists on the issue and nothing is posted to
        //           Slack. Only someone already in Linear sees it. Right for a
        //           thread where the ticket must stay internal.
        //   true  — Linear posts the issue into the thread and syncs replies as
        //           comments. This is what the Slack app's "link existing issue"
        //           action does, and the only version that tells the person who
        //           asked that their request is tracked.
        //
        // Defaults to true, because being told is the entire point of
        // acknowledging a request.
        // Re-linking the same thread must succeed. Linear documents attachment
        // URLs as idempotent per issue, but `attachmentLinkSlack` rejects a
        // duplicate outright — and a capture that fails on its second run is a
        // capture nobody trusts. Clear the existing link first.
        const existing = await issue.attachments();
        const duplicate = existing.nodes.find((a) => a.url === url);
        if (duplicate) await duplicate.delete();

        const result = await client.attachmentLinkSlack(issue.id, url, {
          syncToCommentThread,
        });
        const attachment = await result.attachment;
        return {
          issue: issue.identifier,
          issueUrl: issue.url,
          attachmentId: attachment?.id ?? null,
          url,
          syncToCommentThread,
        };
      });

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
          dueDate: input.dueDate,
          cycleId: input.cycleId,
          projectMilestoneId: input.projectMilestoneId,
          parentId: input.parentId,
        };
        const result = await client.createIssue(arg);
        const issue = await result.issue;
        if (!issue) throw new Error("Issue not returned after creation");
        return issue.identifier;
      }).pipe(Effect.flatMap(getIssue));

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
          dueDate: input.dueDate,
          cycleId: input.cycleId,
          projectMilestoneId: input.projectMilestoneId,
        };
        const result = await client.updateIssue(issueId, arg);
        const issue = await result.issue;
        if (!issue) throw new Error("Issue not returned after update");
        return issue.identifier;
      }).pipe(Effect.flatMap(getIssue));

    /**
     * Turn the human vocabulary of `linear update` into API ids, for one issue.
     *
     * A state name is only meaningful within a team, so the issue is fetched
     * first — but *only* when a name was actually given. Passing a state id, or
     * no state at all, costs nothing extra.
     */
    const resolveIssueUpdate = (
      identifier: string,
      request: UpdateIssueRequest,
    ): Effect.Effect<UpdateIssueInput, ServiceError> =>
      Effect.gen(function* () {
        const needsTeam =
          request.state !== undefined && !UUID.test(request.state.trim());
        const teamKey = needsTeam
          ? (yield* getIssue(identifier)).teamKey
          : undefined;
        return {
          title: request.title,
          description: request.description,
          priority: request.priority,
          estimate: request.estimate,
          dueDate: request.dueDate,
          projectId: request.project,
          cycleId: request.cycle,
          projectMilestoneId: request.milestone,
          stateId: request.state
            ? yield* resolveStateId(request.state, teamKey)
            : undefined,
          assigneeId: request.assignee
            ? yield* resolveUserId(request.assignee)
            : undefined,
        } satisfies UpdateIssueInput;
      });

    /**
     * Apply one change to several issues.
     *
     * Sequential on purpose. The morning routine's unlabel/label/move sequence
     * is dozens of writes; firing them concurrently is the quickest way to
     * spend the hourly budget and leave the batch half-applied.
     */
    const updateIssues = (
      identifiers: readonly string[],
      request: UpdateIssueRequest,
    ): Effect.Effect<Paged<IssueDetail>, ServiceError> =>
      Effect.forEach(identifiers, (identifier) =>
        resolveIssueUpdate(identifier, request).pipe(
          Effect.flatMap((input) => updateIssue(identifier, input)),
        ),
      ).pipe(Effect.map((issues) => complete(issues)));

    const changeLabelsOn = (
      identifiers: readonly string[],
      opts: { readonly add?: readonly string[]; readonly remove?: readonly string[] },
    ): Effect.Effect<Paged<IssueDetail>, ServiceError> =>
      Effect.forEach(identifiers, (identifier) =>
        changeLabels(identifier, opts),
      ).pipe(Effect.map((issues) => complete(issues)));

    const addComment = (issueId: string, body: string) =>
      call("addComment", async (client) => {
        const result = await client.createComment({ issueId, body });
        const comment = await result.comment;
        return comment?.id ?? "created";
      });

    /**
     * Create a saved view from the same filter vocabulary `linear issues` uses.
     *
     * Set-up used to end with "now go make this view in the UI", which is the
     * one step a script cannot check and a new starter always gets subtly
     * different from everyone else's.
     */
    const createView = (input: {
      readonly name: string;
      readonly description?: string;
      readonly teamId?: string;
      readonly shared?: boolean;
      readonly filter?: IssueFilter;
    }) =>
      Effect.gen(function* () {
        const filterData = input.filter
          ? yield* buildIssueFilter(input.filter)
          : undefined;
        return yield* call("createView", async (client) => {
          const arg: CreateCustomViewArg = {
            name: input.name,
            description: input.description,
            teamId: input.teamId,
            shared: input.shared ?? true,
            filterData,
          };
          const result = await client.createCustomView(arg);
          const view = await result.customView;
          if (!view) throw new Error("View not returned after creation");
          return {
            id: view.id,
            name: view.name,
            slugId: view.slugId,
            shared: view.shared,
          } satisfies CreatedView;
        });
      });

    // ============================================
    // Inbox
    // ============================================

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
        let hasMore = false;

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
          hasMore = page.pageInfo.hasNextPage;
          if (!hasMore) break;
          cursor = page.pageInfo.endCursor ?? null;
          if (!cursor) break;
        }

        return summariseInbox(notifications, limit, hasMore);
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

    // ============================================
    // Users
    // ============================================

    const getUserIssues = (userId: string, state?: string, limit = 100) =>
      listIssues({ assignee: userId, state, limit });

    const getUserComments = (userId: string, since?: Date, limit = 100) =>
      call("getUserComments", async (client) => {
        const sinceTs = since?.getTime();
        const comments: Comment[] = [];
        let cursor: string | null = null;
        let hasNextPage = false;
        while (comments.length < limit) {
          const page = await client.comments({
            filter: { user: { id: { eq: userId } } },
            first: PAGE_SIZE,
            ...(cursor ? { after: cursor } : {}),
          });
          for (const c of page.nodes) {
            if (sinceTs !== undefined && c.createdAt.getTime() < sinceTs) continue;
            const [issue, user] = await Promise.all([c.issue, c.user]);
            comments.push({
              id: c.id,
              body: c.body,
              createdAt: c.createdAt,
              updatedAt: c.updatedAt,
              authorId: user?.id,
              author: user?.displayName ?? user?.name,
              issueId: issue?.id,
              issueIdentifier: issue?.identifier,
              issueTitle: issue?.title,
            });
            if (comments.length >= limit) break;
          }
          hasNextPage = page.pageInfo.hasNextPage;
          if (!hasNextPage) break;
          cursor = page.pageInfo.endCursor ?? null;
          if (!cursor) break;
        }
        return {
          items: comments,
          pageInfo: pageInfoOf({
            returned: comments.length,
            limit,
            hasNextPage,
          }),
        } satisfies Paged<Comment>;
      });

    const getUserActivity = (userId: string, since?: Date) =>
      call("getUserActivity", (client) =>
        collectUserActivity(client, userId, since),
      );

    const getIssueHistory = (issueId: string) =>
      call("getIssueHistory", (client) =>
        collectIssueHistory(client, issueId),
      ).pipe(Effect.map((entries) => complete(entries)));

    // ============================================
    // Projects / documents / views / cycles
    // ============================================

    const listProjects = (teamKey?: string, limit = PAGE_SIZE) =>
      Effect.gen(function* () {
        const team = teamKey ? yield* resolveTeam(teamKey) : undefined;
        return yield* call("listProjects", async (client) => {
          const result = await client.projects({ first: 100 });
          const projects: ProjectSummary[] = [];
          for (const project of result.nodes) {
            const teams = await project.teams();
            const first = teams.nodes[0];
            if (!first) continue;
            if (team && first.key !== team.key) continue;
            projects.push({
              id: project.id,
              name: project.name,
              teamKey: first.key,
              teamId: first.id,
              state: project.state,
              updatedAt: project.updatedAt.toISOString(),
            });
          }
          projects.sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          );
          const items = projects.slice(0, limit);
          return {
            items,
            pageInfo: pageInfoOf({
              returned: items.length,
              limit,
              hasNextPage: projects.length > limit,
              totalCount: projects.length,
            }),
          } satisfies Paged<ProjectSummary>;
        });
      });

    const getProject = (projectId: string) =>
      raw<ProjectDetailResponse>("getProject", PROJECT_DETAIL_QUERY, {
        id: projectId,
      }).pipe(Effect.map((r) => projectDetailOf(r.project)));

    const updateProjectMilestone = (
      id: string,
      input: { name?: string; description?: string; targetDate?: string },
    ) =>
      call("updateProjectMilestone", async (client) => {
        const arg: UpdateMilestoneArg = {
          name: input.name,
          description: input.description,
          targetDate: input.targetDate,
        };
        const result = await client.updateProjectMilestone(id, arg);
        const milestone = await result.projectMilestone;
        if (!milestone) throw new Error("Milestone not returned after update");
        return {
          id: milestone.id,
          name: milestone.name,
          description: milestone.description ?? undefined,
          targetDate: milestone.targetDate ?? undefined,
          progress: milestone.progress,
        } satisfies ProjectMilestone;
      });

    const createProjectLink = (input: {
      projectId: string;
      url: string;
      label: string;
    }) =>
      call("createProjectLink", async (client) => {
        const arg: CreateExternalLinkArg = {
          projectId: input.projectId,
          url: input.url,
          label: input.label,
        };
        const result = await client.createEntityExternalLink(arg);
        const link = await result.entityExternalLink;
        if (!link) throw new Error("Link not returned after creation");
        return { id: link.id, label: link.label, url: link.url } satisfies ProjectLink;
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
      content?: string;
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
          content: input.content,
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
      }).pipe(Effect.map((statuses) => complete(statuses)));

    const updateProject = (
      id: string,
      input: {
        name?: string;
        statusId?: string;
        leadId?: string;
        description?: string;
        content?: string;
        targetDate?: string;
      },
    ) =>
      call("updateProject", async (client) => {
        const arg: UpdateProjectArg = {
          name: input.name,
          statusId: input.statusId,
          leadId: input.leadId,
          description: input.description,
          content: input.content,
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
      }).pipe(Effect.map((views) => complete(views)));

    const listFavorites = () =>
      call("listFavorites", (client) => collectFavorites(client)).pipe(
        Effect.map((favorites) => complete(favorites)),
      );

    const listCycles = (team: string, type?: "current" | "previous" | "next") =>
      Effect.gen(function* () {
        const resolved = yield* resolveTeam(team);
        const cycles = yield* call("listCycles", (client) =>
          collectCycles(client, resolved.id, type),
        );
        return complete(cycles);
      });

    return {
      whoami,
      listIssues,
      getIssue,
      getIssueComments,
      createIssue,
      listLabels,
      createLabel,
      resolveLabelIds,
      resolveStateId,
      resolveTeam,
      resolveUserId,
      listStates,
      listTeams,
      changeLabels,
      changeLabelsOn,
      linkSlackThread,
      updateIssue,
      updateIssues,
      resolveIssueUpdate,
      searchIssues,
      addComment,
      createView,
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
      createProjectMilestone,
      updateProjectMilestone,
      createProjectLink,
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

/**
 * Validate an API key by fetching the viewer with a throwaway client. Used by
 * `auth login` to confirm a key works *before* persisting it — independent of
 * the configured {@link Linear} service.
 */
export const verifyApiKey = (
  apiKey: string,
): Effect.Effect<Viewer, LinearCliError> =>
  Effect.tryPromise({
    try: async () => {
      const v = await new LinearClient({ apiKey }).viewer;
      return {
        id: v.id,
        name: v.name,
        email: v.email,
        displayName: v.displayName,
      };
    },
    catch: mapLinearError("verifyApiKey"),
  });

// ============================================
// Module-level helpers (kept out of the service generator for readability)
// ============================================

const summariseInbox = (
  notifications: Notification[],
  limit: number,
  hasNextPage: boolean,
): Inbox => {
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
    pageInfo: pageInfoOf({
      returned: notifications.length,
      limit,
      hasNextPage,
    }),
    notifications,
  };
};

const defaultSince = (): Date =>
  new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

const collectUserActivity = async (
  client: LinearClient,
  userId: string,
  sinceDate?: Date,
): Promise<UserActivity> => {
  const since = sinceDate ?? defaultSince();
  const sinceTs = since.getTime();
  const activities: Activity[] = [];

  const stateMap = new Map<string, string>();
  const states = await client.workflowStates({ first: 100 });
  for (const s of states.nodes) stateMap.set(s.id, s.name.trim());

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
    sinceDate: since.toISOString(),
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

// History due dates arrive as midnight-UTC timestamps; the day is the value.
const dueDay = (value: unknown): string => String(value).slice(0, 10);

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
  for (const s of states.nodes) stateMap.set(s.id, s.name.trim());
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
    if (entry.fromDueDate != null) out.fromDueDate = dueDay(entry.fromDueDate);
    if (entry.toDueDate != null) out.toDueDate = dueDay(entry.toDueDate);
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
