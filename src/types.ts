/**
 * Domain types for the Linear CLI.
 *
 * These are plain, serialisable shapes — the service maps the rich `@linear/sdk`
 * objects down to these, and both the text formatters and `--json` output read
 * from them. `Date` fields serialise to ISO-8601 strings under `JSON.stringify`,
 * which is the documented, stable JSON contract.
 */

// ============================================
// Pagination
// ============================================

/**
 * How much of the matching set you are actually looking at.
 *
 * Every list command reports this, because the alternative is a caller that
 * cannot tell "there were 40 comments" from "there were 400 and you asked for
 * 40" — and a diff built on the second, believing the first, silently drops
 * whatever fell off the end.
 *
 * `totalCount` is only present where Linear reports one (the search endpoints).
 * It is left absent rather than guessed: issue and comment connections do not
 * expose a total, and a fabricated one would be worse than none.
 */
export interface PageInfo {
  /** How many items this call returned. */
  returned: number;
  /** The `--limit` that was in force. */
  limit: number;
  /** Linear says there are more rows after these. */
  hasNextPage: boolean;
  /** `hasNextPage` and we stopped because of `--limit`. The flag to branch on. */
  truncated: boolean;
  /** Opaque cursor to resume from, when there is more. */
  endCursor?: string;
  /** Total matches before pagination — only where the API reports one. */
  totalCount?: number;
}

/** The envelope every list command emits under `--json`. */
export interface Paged<T> {
  items: T[];
  pageInfo: PageInfo;
}

// ============================================
// Issue types
// ============================================

/**
 * The list-shaped view of an issue.
 *
 * Carries assignee, due date and labels because every SLA question needs all
 * three, and a summary without them forces the caller into one extra API call
 * per row — sixteen calls to read sixteen tickets, which is how a workspace
 * burns its hourly request budget before lunch. They are free here: the whole
 * list, relations included, is one GraphQL query.
 */
export interface IssueSummary {
  id: string;
  identifier: string;
  title: string;
  state?: string;
  /** State *category*: triage | backlog | unstarted | started | completed | canceled. */
  stateType?: string;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  canceledAt?: Date;
  /** ISO `YYYY-MM-DD`. Linear stores a date, not a timestamp. */
  dueDate?: string;
  team?: string;
  teamKey?: string;
  project?: string;
  assignee?: string;
  assigneeId?: string;
  labels: string[];
  /** Identifier of the parent issue, when this is a sub-issue. */
  parent?: string;
  url: string;
}

/** A linked resource on an issue — a PR, a design, a Slack thread. */
export interface IssueAttachment {
  id: string;
  title: string;
  url: string;
  /** Integration that created it, e.g. `github`, `slack`. Absent for manual links. */
  sourceType?: string;
}

/** A sub-issue, as seen from its parent. */
export interface IssueRef {
  id: string;
  identifier: string;
  title: string;
  state?: string;
  stateType?: string;
}

export interface IssueDetail {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state?: string;
  stateType?: string;
  priority: number;
  estimate?: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  canceledAt?: Date;
  dueDate?: string;
  team?: string;
  teamKey?: string;
  project?: string;
  milestone?: string;
  parent?: string;
  assignee?: string;
  assigneeId?: string;
  creator?: string;
  url: string;
  labels: string[];
  /**
   * Linked resources. A `sourceType` of `github` is the PR link, which is what
   * makes "marked Done with no pull request" a computable check rather than a
   * judgement call.
   */
  attachments: IssueAttachment[];
  /**
   * Sub-issues. A non-empty list means this ticket is a container, not work —
   * planning it as a task schedules something nobody can actually do.
   */
  children: IssueRef[];
}

export interface IssueFilter {
  assignee?: "me" | string;
  state?: "active" | "completed" | "canceled" | string;
  team?: string;
  project?: string;
  cycle?: string;
  /** Label *name*, matched exactly. The whole point of labels is that you type them. */
  label?: string;
  limit?: number;
}

/** A workflow state, as listed by `linear states`. */
export interface WorkflowState {
  id: string;
  name: string;
  /** triage | backlog | unstarted | started | completed | canceled. */
  type: string;
  position: number;
  color?: string;
  teamKey?: string;
  teamName?: string;
}

/** A team, as listed by `linear teams`. */
export interface TeamSummary {
  id: string;
  key: string;
  name: string;
}

export interface IssueLabel {
  id: string;
  name: string;
  color?: string;
  /** Parent group name, when the label belongs to one. */
  group?: string;
}

export interface CreateIssueInput {
  title: string;
  description?: string;
  teamId: string;
  priority?: number;
  estimate?: number;
  assigneeId?: string;
  projectId?: string;
  stateId?: string;
  labelIds?: string[];
  /** ISO `YYYY-MM-DD`. Linear stores a date, not a timestamp. */
  dueDate?: string;
  cycleId?: string;
  projectMilestoneId?: string;
  parentId?: string;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  priority?: number;
  estimate?: number;
  stateId?: string;
  assigneeId?: string;
  projectId?: string;
  labelIds?: string[];
  /** ISO `YYYY-MM-DD`. Linear stores a date, not a timestamp. */
  dueDate?: string;
  cycleId?: string;
  projectMilestoneId?: string;
}

// ============================================
// Notification types
// ============================================

export type NotificationCategory =
  | "mentions"
  | "assignments"
  | "reminders"
  | "postsAndUpdates"
  | "commentsAndReplies"
  | "statusChanges"
  | "subscriptions"
  | "feed"
  | "reactions";

export const ALL_NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  "mentions",
  "assignments",
  "reminders",
  "postsAndUpdates",
  "commentsAndReplies",
  "statusChanges",
  "subscriptions",
  "feed",
  "reactions",
];

export interface Notification {
  id: string;
  type: string;
  category: NotificationCategory;
  createdAt: Date;
  readAt?: Date;
  archivedAt?: Date;
  actor?: string;
  issueId?: string;
  issueIdentifier?: string;
  issueTitle?: string;
  commentBody?: string;
  projectName?: string;
}

export interface Inbox {
  summary: {
    total: number;
    unread: number;
    byCategory: Record<NotificationCategory, number>;
  };
  pageInfo: PageInfo;
  notifications: Notification[];
}

export interface InboxFilter {
  unreadOnly?: boolean;
  categories?: NotificationCategory[];
  limit?: number;
}

// ============================================
// User / activity types
// ============================================

export interface LinearUser {
  id: string;
  name: string;
  email: string;
  displayName: string;
  active: boolean;
  admin: boolean;
  createdAt: Date;
}

/** The authenticated user, as returned by `whoami` / `auth` commands. */
export interface Viewer {
  id: string;
  name: string;
  email: string;
  displayName: string;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  authorId?: string;
  author?: string;
  issueId?: string;
  issueIdentifier?: string;
  issueTitle?: string;
}

/**
 * A comment as read from its own issue, with the thread structure intact.
 *
 * Reconstructing a conversation from per-author comment streams loses the
 * shape of it: replies detach from what they answer, anyone outside the set of
 * authors you thought to query disappears, and a `--limit` silently decides
 * which half of the exchange you get to see. Reading one issue's comments in
 * order removes all of that at once.
 */
export interface IssueComment {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  authorId?: string;
  author?: string;
  authorEmail?: string;
  /** Set when this comment replies to another. */
  parentId?: string;
  /** The thread root: `parentId` for a reply, the comment's own id otherwise. */
  threadId: string;
  /** Permalink, so a finding can be cited rather than described. */
  url?: string;
  resolvedAt?: Date;
}

export type ActivityType =
  | "comment"
  | "state_change"
  | "assignment"
  | "priority_change";

export interface Activity {
  type: ActivityType;
  timestamp: Date;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  details: {
    body?: string;
    fromState?: string;
    toState?: string;
    fromPriority?: number;
    toPriority?: number;
  };
}

export interface UserActivity {
  userId: string;
  /** ISO-8601 instant the window starts at. */
  sinceDate: string;
  byDay: Record<string, Activity[]>;
  summary: {
    totalActivities: number;
    comments: number;
    stateChanges: number;
    assignments: number;
    priorityChanges: number;
  };
}

export interface HistoryEntry {
  id: string;
  createdAt: Date;
  actorId?: string;
  actorName?: string;
  fromState?: string;
  toState?: string;
  fromAssignee?: string;
  toAssignee?: string;
  fromPriority?: number;
  toPriority?: number;
  /** Linear TimelessDate (YYYY-MM-DD). */
  fromDueDate?: string;
  toDueDate?: string;
  addedLabels?: string[];
  removedLabels?: string[];
}

// ============================================
// Project types
// ============================================

export interface ProjectSummary {
  id: string;
  name: string;
  teamKey: string;
  teamId: string;
  state: string;
  updatedAt: string;
}

export interface ProjectMilestone {
  id: string;
  name: string;
  description?: string;
  targetDate?: string;
  progress: number;
}

export interface ProjectLink {
  id: string;
  label: string;
  url: string;
}

export interface ProjectDocument {
  id: string;
  title: string;
  url: string;
}

/** `project` output: the summary plus what a reviewer reads. */
export interface ProjectDetail extends ProjectSummary {
  url: string;
  /** Linear's short summary (one line, max 255 chars). */
  description?: string;
  /** Linear's long-form project description (markdown). */
  content?: string;
  status?: string;
  lead?: string;
  startDate?: string;
  targetDate?: string;
  links: ProjectLink[];
  documents: ProjectDocument[];
}

export interface ProjectStatus {
  id: string;
  name: string;
  type: string;
  position: number;
}

export interface CreatedProject {
  id: string;
  name: string;
  state: string;
  url: string;
  initiativeId?: string;
}

export interface UpdatedProject {
  id: string;
  name: string;
  state: string;
  url: string;
}

// ============================================
// Document types
// ============================================

export interface CreatedDocument {
  id: string;
  title: string;
  url: string;
  slugId: string;
}

// ============================================
// View types
// ============================================

export interface CustomView {
  id: string;
  name: string;
  description?: string;
  slugId: string;
  shared: boolean;
  owner?: string;
}

export interface Favorite {
  id: string;
  type: string;
  title?: string;
  viewId?: string;
  projectId?: string;
  cycleId?: string;
  labelId?: string;
}

export interface CreatedView {
  id: string;
  name: string;
  slugId: string;
  shared: boolean;
  url?: string;
}

// ============================================
// Writes
// ============================================

/**
 * What a mutating command reports under `--dry-run`.
 *
 * Everything a real run would do is still resolved — names to ids, `me` to a
 * user, `In Progress` to a workflow state — so the preview fails on exactly
 * the inputs the real run would fail on. Only the mutation is skipped. A
 * preview that skipped resolution too would approve changes that then fail,
 * which is worse than no preview at all.
 */
export interface DryRunReport {
  dryRun: true;
  operation: string;
  /** Issue identifiers (or ids) the write would touch. */
  targets: string[];
  /** The change as the caller expressed it. */
  requested: Record<string, unknown>;
  /** What would actually be sent, per target, after names became ids. */
  resolved: readonly object[];
}

/**
 * The fields `linear update` accepts, before any name is resolved to an id.
 *
 * Separate from {@link UpdateIssueInput} because the two have genuinely
 * different vocabularies: this one speaks in what a person types (`me`,
 * `In Progress`, `SPR`), the other in what the API stores.
 */
export interface UpdateIssueRequest {
  title?: string;
  description?: string;
  priority?: number;
  estimate?: number;
  /** Workflow state *name* (`In Progress`) or its id. */
  state?: string;
  dueDate?: string;
  /** `me`, an email, a display name, or a user id. */
  assignee?: string;
  project?: string;
  cycle?: string;
  milestone?: string;
}

// ============================================
// Cycle types
// ============================================

export interface Cycle {
  id: string;
  number: number;
  name?: string;
  startsAt: string;
  endsAt: string;
  completedIssueCount: number;
  totalIssueCount: number;
  progress: number;
}
