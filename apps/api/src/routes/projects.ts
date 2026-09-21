import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx, SqlBuilder } from '../lib/db.js';
import { asyncHandler, dateString, offsetOf, pageMeta, paginationSchema, parse, uuid } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { can, principalOf, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { notify } from '../services/notifications.js';
import { assertProjectVisible, projectScopeClause, scopeFor } from '../services/scope.js';

export const projectRouter = Router();

const SELECT_PROJECT = `
  SELECT s.project_id AS id, s.project_code AS "projectCode", s.name, p.description,
         s.client_name AS "clientName", p.client_location AS "clientLocation",
         p.project_type_id AS "projectTypeId", pt.name AS "projectTypeName",
         s.manager_id AS "managerId", s.manager_name AS "managerName",
         s.start_date AS "startDate", s.expected_end_date AS "expectedEndDate",
         s.actual_end_date AS "actualEndDate", s.status, s.priority,
         s.budget_enabled AS "budgetEnabled", s.budget_amount AS "budgetAmount", s.currency,
         p.notes, p.requires_project_on_expense AS "requiresProjectOnExpense",
         s.member_count AS "memberCount", s.assignment_count AS "assignmentCount",
         s.completed_count AS "completedCount", pg.completion_pct AS "completionPct",
         s.recorded_minutes AS "recordedMinutes", s.verified_minutes AS "verifiedMinutes",
         s.approved_expense AS "approvedExpense", s.pending_expense AS "pendingExpense",
         CASE WHEN s.budget_enabled AND s.budget_amount > 0
              THEN ROUND(s.approved_expense * 100 / s.budget_amount, 1) END AS "budgetUtilisationPct",
         p.created_at AS "createdAt"
    FROM v_project_summary s
    JOIN projects p ON p.id = s.project_id
    JOIN v_project_progress pg ON pg.project_id = s.project_id
    LEFT JOIN project_types pt ON pt.id = p.project_type_id`;

projectRouter.get('/', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  if (scopeFor(p, 'project.view') === 'none') throw forbidden('You cannot view projects.');

  const f = parse(paginationSchema.extend({
    status: z.string().optional(),
    managerId: uuid.optional(),
    priority: z.string().optional(),
    search: z.string().trim().max(120).optional(),
    sort: z.enum(['name', 'start_date', 'status', 'approved_expense']).default('start_date'),
    dir: z.enum(['asc', 'desc']).default('desc'),
  }), req.query);

  const b = new SqlBuilder();
  const scope = projectScopeClause(p, 's.project_id', 1);
  b.add(scope.sql.replace(/\$\d+/g, '$?'), ...scope.params);
  b.addIf(f.status, 's.status = ANY($?)', f.status?.split(','));
  b.addIf(f.managerId, 's.manager_id = $?', f.managerId);
  b.addIf(f.priority, 's.priority = ANY($?)', f.priority?.split(','));
  b.addIf(f.search, `(s.name ILIKE $? OR s.project_code ILIKE $? OR s.client_name ILIKE $?)`,
    ...Array(3).fill(`%${f.search}%`));

  const sortColumn = { name: 's.name', start_date: 's.start_date',
                       status: 's.status', approved_expense: 's.approved_expense' }[f.sort];

  const rows = await query(
    `${SELECT_PROJECT} ${b.where}
      ORDER BY ${sortColumn} ${f.dir === 'asc' ? 'ASC' : 'DESC'}
      LIMIT $${b.next} OFFSET $${b.next + 1}`,
    [...b.params, f.size, offsetOf(f.page, f.size)]);

  const total = await one<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM v_project_summary s ${b.where}`, b.params);
  res.json({ data: rows, page: pageMeta(f.page, f.size, total?.count ?? 0) });
}));

projectRouter.get('/:id', asyncHandler(async (req, res) => {
  await assertProjectVisible(req, req.params.id);
  const project = await one(`${SELECT_PROJECT} WHERE s.project_id = $1`, [req.params.id]);
  if (!project) throw notFound('Project');

  const [members, expenseByCategory, expenseByEmployee, monthlyExpense, workByStatus, topContributors] =
    await Promise.all([
      query(`SELECT pm.id, pm.user_id AS "userId", u.full_name AS "fullName",
                    u.employee_code AS "employeeCode", u.avatar_file_id AS "avatarFileId",
                    dg.name AS "designationName", pm.role_in_project AS "roleInProject",
                    pm.allocation_pct AS "allocationPct", pm.assigned_at AS "assignedAt",
                    (SELECT COUNT(*)::int FROM work_assignments wa
                      WHERE wa.project_id = pm.project_id AND wa.assignee_id = pm.user_id
                        AND wa.deleted_at IS NULL AND wa.status NOT IN ('completed','cancelled')) AS "openAssignments"
               FROM project_members pm
               JOIN users u ON u.id = pm.user_id
               LEFT JOIN designations dg ON dg.id = u.designation_id
              WHERE pm.project_id = $1 AND pm.removed_at IS NULL
              ORDER BY pm.role_in_project, u.full_name`, [req.params.id]),
      query(`SELECT category_name AS category,
                    COUNT(*)::int AS count,
                    SUM(approved_amount) AS approved, SUM(pending_amount) AS pending
               FROM v_expense_claims WHERE project_id = $1
              GROUP BY category_name ORDER BY approved DESC`, [req.params.id]),
      query(`SELECT employee_name AS employee, employee_code AS "employeeCode",
                    COUNT(*)::int AS count,
                    SUM(approved_amount) AS approved, SUM(pending_amount) AS pending
               FROM v_expense_claims WHERE project_id = $1
              GROUP BY employee_name, employee_code ORDER BY approved DESC`, [req.params.id]),
      query(`SELECT to_char(expense_month, 'YYYY-MM') AS month,
                    SUM(approved_amount) AS approved, SUM(pending_amount) AS pending
               FROM v_expense_claims WHERE project_id = $1
              GROUP BY expense_month ORDER BY expense_month`, [req.params.id]),
      query(`SELECT status, COUNT(*)::int AS count FROM work_assignments
              WHERE project_id = $1 AND deleted_at IS NULL GROUP BY status`, [req.params.id]),
      query(`SELECT u.full_name AS "fullName", u.employee_code AS "employeeCode",
                    COALESCE(SUM(t.duration_minutes) FILTER (WHERE t.verification_status = 'verified'),0)::int AS "verifiedMinutes",
                    COALESCE(SUM(t.duration_minutes) FILTER (WHERE t.verification_status <> 'rejected'),0)::int AS "recordedMinutes"
               FROM time_entries t JOIN users u ON u.id = t.user_id
              WHERE t.project_id = $1 AND t.ended_at IS NOT NULL
              GROUP BY u.full_name, u.employee_code
              ORDER BY "verifiedMinutes" DESC LIMIT 10`, [req.params.id]),
    ]);

  res.json({ project, members, expenses: { byCategory: expenseByCategory, byEmployee: expenseByEmployee,
             monthly: monthlyExpense }, workByStatus, topContributors });
}));

projectRouter.get('/:id/activity', asyncHandler(async (req, res) => {
  await assertProjectVisible(req, req.params.id);
  const f = parse(paginationSchema, req.query);
  const rows = await query(
    `SELECT e.id, e.event_type AS "eventType", e.from_status AS "fromStatus", e.to_status AS "toStatus",
            e.note, e.created_at AS "createdAt", u.full_name AS "actorName",
            wa.assignment_code AS "assignmentCode", wa.title AS "assignmentTitle"
       FROM work_assignment_events e
       JOIN work_assignments wa ON wa.id = e.assignment_id
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE wa.project_id = $1
      ORDER BY e.created_at DESC LIMIT $2 OFFSET $3`,
    [req.params.id, f.size, offsetOf(f.page, f.size)]);
  res.json({ data: rows, page: pageMeta(f.page, f.size, rows.length) });
}));

// ---------------------------------------------------------------------
const projectBase = z.object({
  name: z.string().trim().min(3, 'Give the project a name').max(180),
  description: z.string().trim().max(4000).optional(),
  clientName: z.string().trim().min(2, 'Enter the client name').max(180),
  clientLocation: z.string().trim().max(200).optional(),
  projectTypeId: uuid.optional(),
  managerId: uuid,
  startDate: dateString,
  expectedEndDate: dateString.optional(),
  status: z.enum(['draft', 'active', 'on_hold', 'completed', 'cancelled']).default('draft'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  budgetEnabled: z.boolean().default(false),
  budgetAmount: z.coerce.number().min(0).max(1_000_000_000).nullable().optional(),
  requiresProjectOnExpense: z.boolean().default(true),
  notes: z.string().trim().max(4000).optional(),
  memberIds: z.array(uuid).max(200).default([]),
});

const withProjectRules = <T extends z.ZodTypeAny>(schema: T) => schema
  .refine((v: any) => !v.expectedEndDate || !v.startDate || v.expectedEndDate >= v.startDate, {
    message: 'The end date cannot be before the start date', path: ['expectedEndDate'],
  })
  .refine((v: any) => !v.budgetEnabled || (v.budgetAmount ?? 0) > 0, {
    message: 'Enter a budget amount or switch the budget off', path: ['budgetAmount'],
  });

const projectSchema = withProjectRules(projectBase);
const projectUpdateSchema = withProjectRules(projectBase.partial().omit({ memberIds: true }));

projectRouter.post('/', requirePermission('project.create'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(projectSchema, req.body);

  const manager = await one<{ id: string; role_key: string }>(
    `SELECT u.id, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1 AND u.deleted_at IS NULL AND u.status = 'active'`, [body.managerId]);
  if (!manager) throw badRequest('Choose an active project manager.', { managerId: ['Unknown or inactive user'] });
  if (!['ops_manager', 'super_admin'].includes(manager.role_key)) {
    throw badRequest('The project manager must hold an Operations Manager or Super Admin role.',
      { managerId: ['This employee cannot manage projects'] });
  }

  const created = await tx(async (client) => {
    const code = (await one<{ c: string }>(`SELECT next_code('project','PRJ') AS c`, [], client))!.c;
    const row = await one<{ id: string }>(
      `INSERT INTO projects (project_code, name, description, client_name, client_location, project_type_id,
                             manager_id, start_date, expected_end_date, status, priority,
                             budget_amount, budget_enabled, requires_project_on_expense, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [code, body.name, body.description ?? null, body.clientName, body.clientLocation ?? null,
       body.projectTypeId ?? null, body.managerId, body.startDate, body.expectedEndDate ?? null,
       body.status, body.priority, body.budgetEnabled ? body.budgetAmount : null,
       body.budgetEnabled, body.requiresProjectOnExpense, body.notes ?? null, p.id], client);

    for (const userId of new Set(body.memberIds)) {
      await query(`INSERT INTO project_members (project_id, user_id, assigned_by) VALUES ($1,$2,$3)`,
        [row!.id, userId, p.id], client);
    }
    return { id: row!.id, projectCode: code };
  });

  await recordAudit(req, { action: 'project.created', entityType: 'project', entityId: created.id, after: body });
  res.status(201).json(created);
}));

projectRouter.patch('/:id', requirePermission('project.update'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(projectUpdateSchema, req.body);

  const before = await one<any>(`SELECT * FROM projects WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
  if (!before) throw notFound('Project');
  if (before.manager_id !== p.id && !can(req, 'project.view.all')) {
    throw forbidden('You can only edit projects you manage.');
  }
  if (before.status === 'completed' && body.status && body.status !== 'completed' && !can(req, 'project.view.all')) {
    throw forbidden('Only a Super Admin can reopen a completed project.');
  }

  const columns: Record<string, string> = {
    name: 'name', description: 'description', clientName: 'client_name', clientLocation: 'client_location',
    projectTypeId: 'project_type_id', managerId: 'manager_id', startDate: 'start_date',
    expectedEndDate: 'expected_end_date', status: 'status', priority: 'priority',
    budgetAmount: 'budget_amount', budgetEnabled: 'budget_enabled',
    requiresProjectOnExpense: 'requires_project_on_expense', notes: 'notes',
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || !columns[k]) continue;
    params.push(v); sets.push(`${columns[k]} = $${params.length}`); changed[k] = v;
  }
  // Completing a project stamps the actual end date automatically.
  if (body.status === 'completed' && !before.actual_end_date) sets.push(`actual_end_date = CURRENT_DATE`);
  if (body.status && body.status !== 'completed') sets.push(`actual_end_date = NULL`);
  if (!sets.length) return res.json({ ok: true, changed: {} });

  params.push(req.params.id);
  await query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

  await recordAudit(req, { action: 'project.updated', entityType: 'project', entityId: req.params.id,
    before, after: changed });
  res.json({ ok: true, changed });
}));

// ---------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------
projectRouter.post('/:id/members', requirePermission('project.assign_members'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({
    userIds: z.array(uuid).min(1).max(100),
    roleInProject: z.enum(['member', 'lead', 'supervisor', 'observer']).default('member'),
    allocationPct: z.coerce.number().int().min(0).max(100).optional(),
  }), req.body);

  const project = await one<{ manager_id: string; name: string; status: string }>(
    `SELECT manager_id, name, status FROM projects WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
  if (!project) throw notFound('Project');
  if (project.manager_id !== p.id && !can(req, 'project.view.all')) {
    throw forbidden('You can only assign members to projects you manage.');
  }

  const added = await tx(async (client) => {
    const out: string[] = [];
    for (const userId of new Set(body.userIds)) {
      const user = await one<{ id: string }>(
        `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`, [userId], client);
      if (!user) continue;
      const row = await one<{ id: string }>(
        `INSERT INTO project_members (project_id, user_id, role_in_project, allocation_pct, assigned_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING RETURNING id`,
        [req.params.id, userId, body.roleInProject, body.allocationPct ?? null, p.id], client);
      if (row) {
        out.push(userId);
        await notify({ userId, type: 'announcement', title: 'Added to a project',
          body: `You have been assigned to ${project.name}.`,
          entityType: 'project', entityId: req.params.id, severity: 'info' }, client);
      }
    }
    return out;
  });

  await recordAudit(req, { action: 'project.members_added', entityType: 'project',
    entityId: req.params.id, after: { userIds: added } });
  res.json({ added: added.length, skipped: body.userIds.length - added.length });
}));

projectRouter.delete('/:id/members/:userId', requirePermission('project.assign_members'),
  asyncHandler(async (req, res) => {
    const p = principalOf(req);
    const project = await one<{ manager_id: string }>(
      `SELECT manager_id FROM projects WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!project) throw notFound('Project');
    if (project.manager_id !== p.id && !can(req, 'project.view.all')) {
      throw forbidden('You can only change membership on projects you manage.');
    }

    // Removing someone with live work would orphan it.
    const open = await one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM work_assignments
        WHERE project_id = $1 AND assignee_id = $2 AND deleted_at IS NULL
          AND status NOT IN ('completed','cancelled')`, [req.params.id, req.params.userId]);
    if (open && open.count > 0) {
      throw conflict(`That employee still has ${open.count} open assignment(s) on this project. ` +
        'Reassign or cancel them first.', 'OPEN_WORK_EXISTS');
    }

    const removed = await one<{ id: string }>(
      `UPDATE project_members SET removed_at = now()
        WHERE project_id = $1 AND user_id = $2 AND removed_at IS NULL RETURNING id`,
      [req.params.id, req.params.userId]);
    if (!removed) throw notFound('Project member');

    await recordAudit(req, { action: 'project.member_removed', entityType: 'project',
      entityId: req.params.id, after: { userId: req.params.userId } });
    res.json({ ok: true });
  }));
