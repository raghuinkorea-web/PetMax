import { Router } from 'express';
import { query } from '../lib/db.js';
import { asyncHandler } from '../lib/http.js';
import { principalOf } from '../middleware/auth.js';
import { projectScopeClause } from '../services/scope.js';
import {
  WORK_STATUS, EXPENSE_STATUS, PROJECT_STATUS, PRIORITY, EMPLOYEE_STATUS,
  TIME_VERIFICATION, METRIC_DEFINITIONS, ROLE_LABELS,
} from '@adisys/shared';

export const lookupRouter = Router();

/**
 * Everything a form needs to render, in one request. The mobile app caches
 * this so an employee can start filling in a claim on a weak connection.
 */
lookupRouter.get('/', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const scope = projectScopeClause(p, 'p.id', 1);

  const [projects, categories, departments, designations, locations, projectTypes, workTypes, roles] =
    await Promise.all([
      query(`SELECT p.id, p.project_code AS "projectCode", p.name, p.client_name AS "clientName",
                    p.status, p.requires_project_on_expense AS "requiresProject"
               FROM projects p
              WHERE p.deleted_at IS NULL AND p.status IN ('active','on_hold') AND ${scope.sql}
              ORDER BY p.name`, scope.params),
      query(`SELECT id, parent_id AS "parentId", key, name, icon,
                    receipt_required AS "receiptRequired", project_required AS "projectRequired",
                    max_amount_per_claim AS "maxAmountPerClaim", daily_limit AS "dailyLimit",
                    form_variant AS "formVariant", sort_order AS "sortOrder"
               FROM expense_categories WHERE active ORDER BY sort_order, name`),
      query(`SELECT id, code, name FROM departments WHERE active ORDER BY name`),
      query(`SELECT id, name, grade FROM designations WHERE active ORDER BY name`),
      query(`SELECT id, code, name, city, state FROM work_locations WHERE active ORDER BY name`),
      query(`SELECT id, name FROM project_types WHERE active ORDER BY name`),
      query(`SELECT id, name FROM work_types WHERE active ORDER BY name`),
      query(`SELECT id, key, name, description FROM roles ORDER BY name`),
    ]);

  // Nest subcategories under their parent for the mobile picker.
  const byId = new Map(categories.map((c: any) => [c.id, { ...c, children: [] as any[] }]));
  const categoryTree: any[] = [];
  for (const c of byId.values()) {
    if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId)!.children.push(c);
    else categoryTree.push(c);
  }

  res.json({
    projects, categories: categoryTree, departments, designations, locations,
    projectTypes, workTypes, roles,
    vocabulary: {
      workStatus: WORK_STATUS.list,
      expenseStatus: EXPENSE_STATUS.list,
      projectStatus: PROJECT_STATUS.list,
      priority: PRIORITY.list,
      employeeStatus: EMPLOYEE_STATUS.list,
      timeVerification: TIME_VERIFICATION.list,
      roleLabels: ROLE_LABELS,
    },
    metricDefinitions: METRIC_DEFINITIONS,
  });
}));

/** Employees the caller may assign work to (project members they manage). */
lookupRouter.get('/assignable-employees', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const projectId = req.query.projectId as string | undefined;
  const rows = await query(
    `SELECT DISTINCT u.id, u.full_name AS "fullName", u.employee_code AS "employeeCode",
            d.name AS "departmentName", dg.name AS "designationName"
       FROM users u
       JOIN project_members pm ON pm.user_id = u.id AND pm.removed_at IS NULL
       LEFT JOIN departments  d  ON d.id  = u.department_id
       LEFT JOIN designations dg ON dg.id = u.designation_id
      WHERE u.deleted_at IS NULL AND u.status = 'active'
        AND ($1::uuid IS NULL OR pm.project_id = $1)
      ORDER BY u.full_name`, [projectId ?? null]);
  res.json({ data: rows });
}));
