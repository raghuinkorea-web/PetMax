/**
 * Row-level data scoping.
 *
 * Authorisation in ADISYS FieldOps has two independent layers:
 *   1. requirePermission(...)  — may the caller perform this ACTION?
 *   2. the helpers below       — which ROWS may they perform it on?
 *
 * Every list endpoint composes its WHERE clause from these helpers, so a
 * manager can never widen their view by guessing an id or a query string.
 */
import type { Request } from 'express';
import { resolveScope, type DataScope } from '@adisys/shared';
import { one } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import type { Principal } from '../middleware/auth.js';
import { principalOf } from '../middleware/auth.js';

export type { DataScope };

export const scopeFor = (
  p: Principal,
  base: 'employee.view' | 'project.view' | 'work.view' | 'productivity.view' | 'expense.view' | 'report.view',
): DataScope => resolveScope([...p.permissions], base);

/** Recursive reporting line beneath the caller, as an id subquery. */
const subordinatesSql = (idx: number) => `(
  WITH RECURSIVE reports AS (
    SELECT id FROM users WHERE reporting_manager_id = $${idx} AND deleted_at IS NULL
    UNION
    SELECT u.id FROM users u JOIN reports r ON u.reporting_manager_id = r.id
     WHERE u.deleted_at IS NULL
  ) SELECT id FROM reports
)`;

/** Projects the caller manages, as an id subquery. */
const managedProjectsSql = (idx: number) =>
  `(SELECT id FROM projects WHERE manager_id = $${idx} AND deleted_at IS NULL)`;

/** Projects the caller is an active member of, as an id subquery. */
const memberProjectsSql = (idx: number) =>
  `(SELECT project_id FROM project_members WHERE user_id = $${idx} AND removed_at IS NULL)`;

export interface ScopeClause { sql: string; params: unknown[] }

/**
 * Restricts `<alias>` (a users-table alias or a column holding a user id)
 * to the people the caller may see.
 */
export function userScopeClause(
  p: Principal, userIdColumn: string, startIdx: number,
  base: 'employee.view' | 'work.view' | 'productivity.view' | 'expense.view' = 'employee.view',
): ScopeClause {
  const scope = scopeFor(p, base);
  switch (scope) {
    case 'all':
      return { sql: 'TRUE', params: [] };
    case 'team':
      // Direct/indirect reports, members of projects the caller manages, and themselves.
      return {
        sql: `(${userIdColumn} = $${startIdx}
               OR ${userIdColumn} IN ${subordinatesSql(startIdx + 1)}
               OR ${userIdColumn} IN (SELECT pm.user_id FROM project_members pm
                                       WHERE pm.removed_at IS NULL
                                         AND pm.project_id IN ${managedProjectsSql(startIdx + 2)}))`,
        params: [p.id, p.id, p.id],
      };
    case 'own':
      return { sql: `${userIdColumn} = $${startIdx}`, params: [p.id] };
    default:
      return { sql: 'FALSE', params: [] };
  }
}

/** Restricts a project id column to projects the caller may see. */
export function projectScopeClause(p: Principal, projectIdColumn: string, startIdx: number): ScopeClause {
  const scope = scopeFor(p, 'project.view');
  switch (scope) {
    case 'all':
      return { sql: 'TRUE', params: [] };
    case 'team':
      return {
        sql: `(${projectIdColumn} IN ${managedProjectsSql(startIdx)}
               OR ${projectIdColumn} IN ${memberProjectsSql(startIdx + 1)})`,
        params: [p.id, p.id],
      };
    case 'own':
      return { sql: `${projectIdColumn} IN ${memberProjectsSql(startIdx)}`, params: [p.id] };
    default:
      return { sql: 'FALSE', params: [] };
  }
}

/**
 * Nullable project columns (an expense may legitimately have no project).
 * A NULL project is visible to whoever can see the owning employee, so it
 * must not be filtered out by the project clause.
 */
export function nullableProjectScopeClause(p: Principal, col: string, startIdx: number): ScopeClause {
  const base = projectScopeClause(p, col, startIdx);
  if (base.sql === 'TRUE' || base.sql === 'FALSE') return base;
  return { sql: `(${col} IS NULL OR ${base.sql})`, params: base.params };
}

// ---------------------------------------------------------------------
// Point guards — used before acting on a single record.
// ---------------------------------------------------------------------

export async function assertProjectVisible(req: Request, projectId: string): Promise<void> {
  const p = principalOf(req);
  const clause = projectScopeClause(p, 'p.id', 2);
  const row = await one(
    `SELECT p.id FROM projects p
      WHERE p.id = $1 AND p.deleted_at IS NULL AND ${clause.sql}`,
    [projectId, ...clause.params]);
  if (!row) throw notFound('Project');
}

export async function assertUserVisible(req: Request, userId: string): Promise<void> {
  const p = principalOf(req);
  if (userId === p.id) return;
  const clause = userScopeClause(p, 'u.id', 2);
  const row = await one(
    `SELECT u.id FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL AND ${clause.sql}`,
    [userId, ...clause.params]);
  if (!row) throw notFound('Employee');
}

/**
 * Business rule: an employee may only log time or claim expenses against
 * a project they are an ACTIVE member of. Project managers are implicitly
 * entitled to their own projects.
 */
export async function assertProjectMembership(userId: string, projectId: string): Promise<void> {
  const row = await one(
    `SELECT 1 AS ok
       FROM projects p
       LEFT JOIN project_members pm
              ON pm.project_id = p.id AND pm.user_id = $1 AND pm.removed_at IS NULL
      WHERE p.id = $2
        AND p.deleted_at IS NULL
        AND p.status IN ('active','on_hold')
        AND (pm.id IS NOT NULL OR p.manager_id = $1)`,
    [userId, projectId]);
  if (!row) {
    throw forbidden('You are not assigned to this project, or the project is not open for new entries.');
  }
}

/** True when the caller manages the given project (used for approval routing). */
export async function managesProject(userId: string, projectId: string): Promise<boolean> {
  const row = await one(`SELECT 1 AS ok FROM projects WHERE id = $1 AND manager_id = $2`,
    [projectId, userId]);
  return Boolean(row);
}
