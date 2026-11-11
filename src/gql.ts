/**
 * Hand-written GraphQL for the read paths that matter.
 *
 * `@linear/sdk` models relations as lazy fetches: `issue.state` and
 * `issue.assignee` are each a *round trip*. Summarising a page of 50 issues
 * therefore cost 100+ requests against a 2,500/hour budget, and adding the
 * fields callers actually need — assignee, due date, labels — would have
 * tripled that. Asking for the whole shape in one query costs one request
 * regardless of page size.
 *
 * The SDK is still used everywhere else. This module exists only where the
 * per-row fan-out was the problem.
 *
 * Responses are typed structurally against the documents below. Dates arrive
 * as ISO strings and are converted to `Date` by the mappers in `client.ts`, so
 * the domain types in `types.ts` — and the `--json` contract — are unchanged.
 */

/** Fields shared by every issue we return in a list. */
const ISSUE_SUMMARY_FIELDS = `
  id
  identifier
  title
  priority
  createdAt
  updatedAt
  completedAt
  canceledAt
  dueDate
  url
  state { name type }
  team { key name }
  project { name }
  assignee { id name displayName }
  parent { identifier }
  labels(first: 50) { nodes { name } }
`;

export const ISSUE_LIST_QUERY = `
  query CliIssues($filter: IssueFilter, $first: Int!, $after: String) {
    issues(filter: $filter, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ISSUE_SUMMARY_FIELDS} }
    }
  }
`;

export const ISSUE_SEARCH_QUERY = `
  query CliIssueSearch($term: String!, $first: Int!, $after: String) {
    searchIssues(term: $term, first: $first, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ${ISSUE_SUMMARY_FIELDS} }
    }
  }
`;

export const VIEW_ISSUES_QUERY = `
  query CliViewIssues($id: String!, $first: Int!, $after: String) {
    customView(id: $id) {
      issues(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${ISSUE_SUMMARY_FIELDS} }
      }
    }
  }
`;

export const ISSUE_DETAIL_QUERY = `
  query CliIssue($id: String!) {
    issue(id: $id) {
      ${ISSUE_SUMMARY_FIELDS}
      description
      estimate
      creator { name }
      projectMilestone { name }
      children(first: 100) {
        nodes { id identifier title state { name type } }
      }
      attachments(first: 100) {
        nodes { id title url sourceType }
      }
    }
  }
`;

export const ISSUE_COMMENTS_QUERY = `
  query CliIssueComments($id: String!, $first: Int!, $after: String) {
    issue(id: $id) {
      identifier
      comments(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          body
          createdAt
          updatedAt
          resolvedAt
          url
          parent { id }
          user { id name displayName email }
        }
      }
    }
  }
`;

export const WORKFLOW_STATES_QUERY = `
  query CliWorkflowStates($first: Int!, $after: String) {
    workflowStates(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        type
        position
        color
        team { key name }
      }
    }
  }
`;

export const TEAMS_QUERY = `
  query CliTeams($first: Int!, $after: String) {
    teams(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id key name }
    }
  }
`;

// ============================================
// Response shapes
// ============================================

export interface GqlPageInfo {
  hasNextPage: boolean;
  endCursor?: string | null;
}

export interface GqlConnection<T> {
  pageInfo: GqlPageInfo;
  nodes: T[];
}

export interface GqlNamed {
  name: string;
}

export interface GqlIssueNode {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  canceledAt?: string | null;
  dueDate?: string | null;
  url: string;
  state?: { name: string; type: string } | null;
  team?: { key: string; name: string } | null;
  project?: GqlNamed | null;
  assignee?: { id: string; name: string; displayName?: string | null } | null;
  parent?: { identifier: string } | null;
  labels: GqlConnection<GqlNamed>;
}

export interface GqlIssueDetailNode extends GqlIssueNode {
  description?: string | null;
  estimate?: number | null;
  creator?: GqlNamed | null;
  projectMilestone?: GqlNamed | null;
  children: GqlConnection<{
    id: string;
    identifier: string;
    title: string;
    state?: { name: string; type: string } | null;
  }>;
  attachments: GqlConnection<{
    id: string;
    title: string;
    url: string;
    sourceType?: string | null;
  }>;
}

export interface GqlCommentNode {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  url?: string | null;
  parent?: { id: string } | null;
  user?: {
    id: string;
    name: string;
    displayName?: string | null;
    email?: string | null;
  } | null;
}

export interface GqlWorkflowStateNode {
  id: string;
  name: string;
  type: string;
  position: number;
  color?: string | null;
  team?: { key: string; name: string } | null;
}

export interface GqlTeamNode {
  id: string;
  key: string;
  name: string;
}

export interface IssueListResponse {
  issues: GqlConnection<GqlIssueNode>;
}

export interface IssueSearchResponse {
  searchIssues: GqlConnection<GqlIssueNode> & { totalCount: number };
}

export interface ViewIssuesResponse {
  customView: { issues: GqlConnection<GqlIssueNode> };
}

export interface IssueDetailResponse {
  issue: GqlIssueDetailNode;
}

export interface IssueCommentsResponse {
  issue: { identifier: string; comments: GqlConnection<GqlCommentNode> };
}

export interface WorkflowStatesResponse {
  workflowStates: GqlConnection<GqlWorkflowStateNode>;
}

export interface TeamsResponse {
  teams: GqlConnection<GqlTeamNode>;
}

/**
 * A project with everything a reviewer reads: both descriptions, lead,
 * status, dates, milestones, links and documents — one request instead of a
 * lazy fetch per relation.
 */
export const PROJECT_DETAIL_QUERY = `
  query CliProject($id: String!) {
    project(id: $id) {
      id
      name
      url
      description
      content
      state
      startDate
      targetDate
      updatedAt
      status { name }
      lead { name displayName }
      teams(first: 1) { nodes { id key } }
      projectMilestones(first: 100) {
        nodes { id name description targetDate progress sortOrder }
      }
      externalLinks(first: 100) { nodes { id label url } }
      documents(first: 100) { nodes { id title url } }
    }
  }
`;

export interface GqlProjectDetailNode {
  id: string;
  name: string;
  url: string;
  description?: string | null;
  content?: string | null;
  state: string;
  startDate?: string | null;
  targetDate?: string | null;
  updatedAt: string;
  status?: { name: string } | null;
  lead?: { name: string; displayName?: string | null } | null;
  teams: { nodes: { id: string; key: string }[] };
  projectMilestones: {
    nodes: {
      id: string;
      name: string;
      description?: string | null;
      targetDate?: string | null;
      progress: number;
      sortOrder: number;
    }[];
  };
  externalLinks: { nodes: { id: string; label: string; url: string }[] };
  documents: { nodes: { id: string; title: string; url: string }[] };
}

export interface ProjectDetailResponse {
  project: GqlProjectDetailNode;
}

/**
 * Every project in a lifecycle state with its lead, dates, current health and
 * most recent update — one request per page instead of a lazy fetch for the
 * lead, the teams and the update on every project.
 */
export const PROJECT_UPDATES_QUERY = `
  query CliProjectUpdates($filter: ProjectFilter, $first: Int!, $after: String) {
    projects(filter: $filter, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        url
        targetDate
        health
        status { type }
        lead { id name displayName email }
        teams(first: 1) { nodes { key } }
        lastUpdate {
          id
          createdAt
          health
          body
          url
          user { name displayName }
        }
      }
    }
  }
`;

export interface GqlProjectUpdateNode {
  id: string;
  createdAt: string;
  health?: string | null;
  body: string;
  url: string;
  user?: { name: string; displayName?: string | null } | null;
}

export interface GqlProjectUpdateStatusNode {
  id: string;
  name: string;
  url: string;
  targetDate?: string | null;
  health?: string | null;
  status: { type: string };
  lead?: {
    id: string;
    name: string;
    displayName?: string | null;
    email?: string | null;
  } | null;
  teams: { nodes: { key: string }[] };
  lastUpdate?: GqlProjectUpdateNode | null;
}

export interface ProjectUpdatesResponse {
  projects: GqlConnection<GqlProjectUpdateStatusNode>;
}
