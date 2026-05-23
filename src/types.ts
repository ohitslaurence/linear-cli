/**
 * Domain types for the Linear CLI.
 *
 * These are plain, serialisable shapes — the service maps the rich `@linear/sdk`
 * objects down to these, and both the text formatters and `--json` output read
 * from them. `Date` fields serialise to ISO-8601 strings under `JSON.stringify`,
 * which is the documented, stable JSON contract.
 */

// ============================================
// Issue types
// ============================================

export interface IssueSummary {
  id: string;
  identifier: string;
  title: string;
  state?: string;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  canceledAt?: Date;
  team?: string;
  url: string;
}

export interface IssueDetail {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state?: string;
  priority: number;
  estimate?: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  canceledAt?: Date;
  dueDate?: string;
  team?: string;
  project?: string;
  milestone?: string;
  parent?: string;
  assignee?: string;
  creator?: string;
  url: string;
  labels: string[];
}

export interface IssueFilter {
  assignee?: "me" | string;
  state?: "active" | "completed" | "canceled" | string;
  team?: string;
  project?: string;
  cycle?: string;
  limit?: number;
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

export interface Comment {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  issueId?: string;
  issueIdentifier?: string;
  issueTitle?: string;
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
