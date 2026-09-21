import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../lib/db.js';
import { asyncHandler, dateString, parse, uuid } from '../lib/http.js';
import { principalOf, requirePermission } from '../middleware/auth.js';
import { projectScopeClause, userScopeClause } from '../services/scope.js';

export const dashboardRouter = Router();

const filterSchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  projectId: uuid.optional(),
  employeeId: uuid.optional(),
  locationId: uuid.optional(),
});

/**
 * Operational overview. Every figure is scoped to what the caller may
 * see, so two managers viewing "Total Expenses" see their own numbers,
 * not the organisation's.
 */
dashboardRouter.get('/', requirePermission('dashboard.view'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const f = parse(filterSchema, req.query);

  const uScope = userScopeClause(p, 'u.id', 1, 'employee.view');
  const pScope = projectScopeClause(p, 'pr.id', 1);
  const cScope = userScopeClause(p, 'ec.user_id', 1, 'expense.view');
  const wScope = userScopeClause(p, 'wa.assignee_id', 1, 'work.view');
  const tScope = userScopeClause(p, 't.user_id', 1, 'productivity.view');

  const from = f.from ?? null;
  const to = f.to ?? null;
  const proj = f.projectId ?? null;
  const emp = f.employeeId ?? null;

  const [people, projects, work, time, expenses] = await Promise.all([
    one<any>(
      `SELECT COUNT(*)::int AS "totalEmployees",
              COUNT(*) FILTER (WHERE u.status = 'active')::int AS "activeEmployees",
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM attendance_sessions a
                                WHERE a.user_id = u.id AND a.check_out_at IS NULL))::int AS "onDutyNow"
         FROM users u WHERE u.deleted_at IS NULL AND ${uScope.sql}`, uScope.params),

    one<any>(
      `SELECT COUNT(*)::int AS "totalProjects",
              COUNT(*) FILTER (WHERE pr.status = 'active')::int AS "activeProjects",
              COUNT(*) FILTER (WHERE pr.status = 'on_hold')::int AS "onHoldProjects",
              COALESCE(SUM(pr.budget_amount) FILTER (WHERE pr.budget_enabled),0) AS "totalBudget"
         FROM projects pr WHERE pr.deleted_at IS NULL AND ${pScope.sql}`, pScope.params),

    one<any>(
      `SELECT COUNT(*) FILTER (WHERE wa.assignment_date = CURRENT_DATE)::int AS "workAssignedToday",
              COUNT(*) FILTER (WHERE wa.status = 'completed'
                                 AND wa.completed_at::date = CURRENT_DATE)::int AS "workCompletedToday",
              COUNT(*) FILTER (WHERE wa.status = 'assigned')::int AS "pendingAcknowledgements",
              COUNT(*) FILTER (WHERE wa.due_date < CURRENT_DATE
                                 AND wa.status NOT IN ('completed','cancelled'))::int AS "overdueAssignments",
              COUNT(*) FILTER (WHERE wa.status = 'submitted')::int AS "awaitingReview",
              COUNT(*) FILTER (WHERE wa.status = 'in_progress')::int AS "inProgress"
         FROM work_assignments wa
        WHERE wa.deleted_at IS NULL AND ${wScope.sql}
          AND ($${wScope.params.length + 1}::uuid IS NULL OR wa.project_id = $${wScope.params.length + 1})
          AND ($${wScope.params.length + 2}::uuid IS NULL OR wa.assignee_id = $${wScope.params.length + 2})`,
      [...wScope.params, proj, emp]),

    one<any>(
      `SELECT COALESCE(SUM(t.duration_minutes) FILTER (
                WHERE t.work_date = CURRENT_DATE AND t.verification_status <> 'rejected'),0)::int AS "recordedMinutesToday",
              COALESCE(SUM(t.duration_minutes) FILTER (
                WHERE t.work_date = CURRENT_DATE AND t.verification_status = 'verified'),0)::int AS "verifiedMinutesToday",
              COALESCE(SUM(t.duration_minutes) FILTER (
                WHERE t.work_date >= date_trunc('week', CURRENT_DATE)::date
                  AND t.verification_status = 'verified'),0)::int AS "verifiedMinutesThisWeek",
              COUNT(*) FILTER (WHERE t.verification_status = 'unverified')::int AS "entriesAwaitingVerification"
         FROM time_entries t
        WHERE t.ended_at IS NOT NULL AND ${tScope.sql}
          AND ($${tScope.params.length + 1}::uuid IS NULL OR t.project_id = $${tScope.params.length + 1})`,
      [...tScope.params, proj]),

    one<any>(
      `SELECT COALESCE(SUM(ec.amount) FILTER (
                WHERE ec.expense_date >= date_trunc('month', CURRENT_DATE)::date
                  AND ec.status IN ('approved','reimbursement_pending','paid')),0) AS "expensesThisMonth",
              COUNT(*) FILTER (WHERE ec.status IN ('submitted','under_review'))::int AS "pendingExpenseApprovals",
              COALESCE(SUM(ec.amount) FILTER (WHERE ec.status IN ('submitted','under_review')),0) AS "pendingExpenseAmount",
              COALESCE(SUM(ec.amount) FILTER (
                WHERE ec.status IN ('approved','reimbursement_pending','paid')),0) AS "totalProjectExpense",
              COALESCE(SUM(ec.amount) FILTER (WHERE ec.status = 'reimbursement_pending'),0) AS "awaitingReimbursement",
              COUNT(*) FILTER (WHERE ec.status = 'returned')::int AS "returnedForCorrection"
         FROM expense_claims ec
        WHERE ec.deleted_at IS NULL AND ec.status <> 'draft' AND ${cScope.sql}
          AND ($${cScope.params.length + 1}::date IS NULL OR ec.expense_date >= $${cScope.params.length + 1})
          AND ($${cScope.params.length + 2}::date IS NULL OR ec.expense_date <= $${cScope.params.length + 2})
          AND ($${cScope.params.length + 3}::uuid IS NULL OR ec.project_id = $${cScope.params.length + 3})`,
      [...cScope.params, from, to, proj]),
  ]);

  res.json({
    kpis: {
      ...people, ...projects, ...work, ...time,
      expensesThisMonth: Number(expenses.expensesThisMonth),
      pendingExpenseApprovals: expenses.pendingExpenseApprovals,
      pendingExpenseAmount: Number(expenses.pendingExpenseAmount),
      totalProjectExpense: Number(expenses.totalProjectExpense),
      awaitingReimbursement: Number(expenses.awaitingReimbursement),
      returnedForCorrection: expenses.returnedForCorrection,
      totalBudget: Number(projects.totalBudget),
    },
  });
}));

/** Chart series for the dashboard. */
dashboardRouter.get('/charts', requirePermission('dashboard.view'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const f = parse(filterSchema.extend({ days: z.coerce.number().int().min(7).max(180).default(30) }), req.query);

  const cScope = userScopeClause(p, 'ec.user_id', 1, 'expense.view');
  const wScope = userScopeClause(p, 'wa.assignee_id', 1, 'work.view');
  const tScope = userScopeClause(p, 't.user_id', 1, 'productivity.view');
  const pScope = projectScopeClause(p, 'pr.id', 1);

  const [expenseTrend, expenseByCategory, workCompletion, productivityByEmployee, projectExpense, workStatusMix] =
    await Promise.all([
      query(`SELECT to_char(date_trunc('month', ec.expense_date), 'YYYY-MM') AS month,
                    COALESCE(SUM(ec.amount) FILTER (WHERE ec.status IN ('approved','reimbursement_pending','paid')),0) AS approved,
                    COALESCE(SUM(ec.amount) FILTER (WHERE ec.status IN ('submitted','under_review')),0) AS pending,
                    COALESCE(SUM(ec.amount) FILTER (WHERE ec.status = 'rejected'),0) AS rejected
               FROM expense_claims ec
              WHERE ec.deleted_at IS NULL AND ec.status <> 'draft' AND ${cScope.sql}
                AND ec.expense_date >= date_trunc('month', CURRENT_DATE - interval '11 months')::date
              GROUP BY 1 ORDER BY 1`, cScope.params),

      query(`SELECT c.name AS category,
                    COALESCE(SUM(ec.amount) FILTER (WHERE ec.status IN ('approved','reimbursement_pending','paid')),0) AS approved,
                    COUNT(*)::int AS count
               FROM expense_claims ec JOIN expense_categories c ON c.id = ec.category_id
              WHERE ec.deleted_at IS NULL AND ec.status <> 'draft' AND ${cScope.sql}
                AND ec.expense_date >= CURRENT_DATE - $${cScope.params.length + 1}::int
              GROUP BY c.name HAVING SUM(ec.amount) > 0 ORDER BY approved DESC`,
        [...cScope.params, f.days]),

      query(`SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
                    COUNT(wa.id) FILTER (WHERE wa.assignment_date = d.day)::int AS assigned,
                    COUNT(wa.id) FILTER (WHERE wa.status = 'completed'
                                           AND wa.completed_at::date = d.day)::int AS completed
               FROM generate_series(CURRENT_DATE - $${wScope.params.length + 1}::int, CURRENT_DATE, interval '1 day') d(day)
               LEFT JOIN work_assignments wa
                      ON (wa.assignment_date = d.day::date OR wa.completed_at::date = d.day::date)
                     AND wa.deleted_at IS NULL AND ${wScope.sql}
              GROUP BY d.day ORDER BY d.day`, [...wScope.params, f.days]),

      query(`SELECT u.full_name AS employee, u.employee_code AS "employeeCode",
                    COALESCE(SUM(t.duration_minutes) FILTER (WHERE t.verification_status = 'verified'),0)::int AS "verifiedMinutes",
                    COALESCE(SUM(t.duration_minutes) FILTER (WHERE t.verification_status = 'unverified'),0)::int AS "unverifiedMinutes"
               FROM time_entries t JOIN users u ON u.id = t.user_id
              WHERE t.ended_at IS NOT NULL AND ${tScope.sql}
                AND t.work_date >= CURRENT_DATE - $${tScope.params.length + 1}::int
              GROUP BY u.full_name, u.employee_code
              ORDER BY "verifiedMinutes" DESC LIMIT 12`, [...tScope.params, f.days]),

      query(`SELECT pr.name AS project, pr.project_code AS "projectCode",
                    s.approved_expense AS approved, s.pending_expense AS pending,
                    pr.budget_amount AS budget, pr.budget_enabled AS "budgetEnabled"
               FROM projects pr JOIN v_project_summary s ON s.project_id = pr.id
              WHERE pr.deleted_at IS NULL AND pr.status <> 'draft' AND ${pScope.sql}
              ORDER BY s.approved_expense DESC LIMIT 10`, pScope.params),

      query(`SELECT wa.status, COUNT(*)::int AS count
               FROM work_assignments wa
              WHERE wa.deleted_at IS NULL AND ${wScope.sql}
                AND wa.assignment_date >= CURRENT_DATE - $${wScope.params.length + 1}::int
              GROUP BY wa.status`, [...wScope.params, f.days]),
    ]);

  const num = (rows: any[], ...keys: string[]) =>
    rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, Number(r[k] ?? 0)])) }));

  res.json({
    expenseTrend: num(expenseTrend, 'approved', 'pending', 'rejected'),
    expenseByCategory: num(expenseByCategory, 'approved'),
    workCompletion,
    productivityByEmployee,
    projectExpense: num(projectExpense, 'approved', 'pending', 'budget'),
    workStatusMix,
  });
}));

/** Actionable lists beneath the charts. */
dashboardRouter.get('/attention', requirePermission('dashboard.view'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const wScope = userScopeClause(p, 'wa.assignee_id', 1, 'work.view');
  const cScope = userScopeClause(p, 'ec.user_id', 1, 'expense.view');

  const [overdue, pendingAck, pendingApprovals, highValue, needingCorrection, unverifiedTime] = await Promise.all([
    query(`SELECT wa.id, wa.assignment_code AS "assignmentCode", wa.title, wa.due_date AS "dueDate",
                  wa.status, u.full_name AS "assigneeName", pr.name AS "projectName",
                  (CURRENT_DATE - wa.due_date) AS "daysOverdue"
             FROM work_assignments wa JOIN users u ON u.id = wa.assignee_id
             JOIN projects pr ON pr.id = wa.project_id
            WHERE wa.deleted_at IS NULL AND ${wScope.sql}
              AND wa.due_date < CURRENT_DATE AND wa.status NOT IN ('completed','cancelled')
            ORDER BY wa.due_date LIMIT 10`, wScope.params),

    query(`SELECT wa.id, wa.assignment_code AS "assignmentCode", wa.title, wa.assignment_date AS "assignmentDate",
                  u.full_name AS "assigneeName", pr.name AS "projectName"
             FROM work_assignments wa JOIN users u ON u.id = wa.assignee_id
             JOIN projects pr ON pr.id = wa.project_id
            WHERE wa.deleted_at IS NULL AND ${wScope.sql} AND wa.status = 'assigned'
            ORDER BY wa.assignment_date LIMIT 10`, wScope.params),

    query(`SELECT ec.id, ec.expense_code AS "expenseCode", ec.amount, ec.expense_date AS "expenseDate",
                  ec.current_stage AS "currentStage", u.full_name AS "employeeName",
                  c.name AS "categoryName", pr.name AS "projectName",
                  EXTRACT(DAY FROM now() - ec.submitted_at)::int AS "daysWaiting"
             FROM expense_claims ec JOIN users u ON u.id = ec.user_id
             JOIN expense_categories c ON c.id = ec.category_id
             LEFT JOIN projects pr ON pr.id = ec.project_id
            WHERE ec.deleted_at IS NULL AND ${cScope.sql}
              AND ec.status IN ('submitted','under_review')
            ORDER BY ec.submitted_at LIMIT 10`, cScope.params),

    query(`SELECT ec.id, ec.expense_code AS "expenseCode", ec.amount, u.full_name AS "employeeName",
                  c.name AS "categoryName", ec.status
             FROM expense_claims ec JOIN users u ON u.id = ec.user_id
             JOIN expense_categories c ON c.id = ec.category_id
            WHERE ec.deleted_at IS NULL AND ${cScope.sql}
              AND ec.status IN ('submitted','under_review') AND ec.amount >= 15000
            ORDER BY ec.amount DESC LIMIT 10`, cScope.params),

    query(`SELECT ec.id, ec.expense_code AS "expenseCode", ec.amount, u.full_name AS "employeeName",
                  ec.rejection_reason AS "reason", ec.expense_date AS "expenseDate"
             FROM expense_claims ec JOIN users u ON u.id = ec.user_id
            WHERE ec.deleted_at IS NULL AND ${cScope.sql} AND ec.status = 'returned'
            ORDER BY ec.updated_at DESC LIMIT 10`, cScope.params),

    one<{ count: number; minutes: number }>(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(t.duration_minutes),0)::int AS minutes
         FROM time_entries t
        WHERE t.ended_at IS NOT NULL AND t.verification_status = 'unverified'
          AND t.work_date >= CURRENT_DATE - 30
          AND t.project_id IN (SELECT id FROM projects WHERE manager_id = $1)`, [p.id]),
  ]);

  res.json({ overdue, pendingAck, pendingApprovals, highValue, needingCorrection, unverifiedTime });
}));

/** The employee app home screen, in a single round trip. */
dashboardRouter.get('/my-day', asyncHandler(async (req, res) => {
  const p = principalOf(req);

  const [work, time, attendance, expenses, unread] = await Promise.all([
    one<any>(
      `SELECT COUNT(*) FILTER (WHERE assignment_date = CURRENT_DATE)::int AS "todayTotal",
              COUNT(*) FILTER (WHERE assignment_date = CURRENT_DATE AND status = 'assigned')::int AS "todayPendingAck",
              COUNT(*) FILTER (WHERE assignment_date = CURRENT_DATE AND status = 'in_progress')::int AS "todayInProgress",
              COUNT(*) FILTER (WHERE assignment_date = CURRENT_DATE AND status = 'completed')::int AS "todayCompleted",
              COUNT(*) FILTER (WHERE status = 'assigned')::int AS "pendingAckTotal",
              COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('completed','cancelled'))::int AS overdue,
              COUNT(*) FILTER (WHERE assignment_date BETWEEN date_trunc('week', CURRENT_DATE)::date
                                                         AND date_trunc('week', CURRENT_DATE)::date + 6)::int AS "weekTotal"
         FROM work_assignments WHERE assignee_id = $1 AND deleted_at IS NULL`, [p.id]),

    one<any>(
      `SELECT COALESCE(SUM(duration_minutes) FILTER (
                WHERE work_date = CURRENT_DATE AND verification_status <> 'rejected'),0)::int AS "recordedMinutesToday",
              COALESCE(SUM(duration_minutes) FILTER (
                WHERE work_date >= date_trunc('week', CURRENT_DATE)::date
                  AND verification_status <> 'rejected'),0)::int AS "recordedMinutesThisWeek",
              COALESCE(SUM(duration_minutes) FILTER (
                WHERE work_date >= date_trunc('week', CURRENT_DATE)::date
                  AND verification_status = 'verified'),0)::int AS "verifiedMinutesThisWeek"
         FROM time_entries WHERE user_id = $1 AND ended_at IS NOT NULL`, [p.id]),

    one<any>(
      `SELECT EXISTS (SELECT 1 FROM attendance_sessions
                       WHERE user_id = $1 AND check_out_at IS NULL) AS "onDuty",
              (SELECT check_in_at FROM attendance_sessions
                WHERE user_id = $1 AND check_out_at IS NULL) AS "checkInAt"`, [p.id]),

    one<any>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('submitted','under_review'))::int AS pending,
              COUNT(*) FILTER (WHERE status = 'returned')::int AS returned,
              COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
              COALESCE(SUM(amount) FILTER (
                WHERE status IN ('approved','reimbursement_pending') ),0) AS "awaitingPayment"
         FROM expense_claims WHERE user_id = $1 AND deleted_at IS NULL`, [p.id]),

    one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [p.id]),
  ]);

  const timer = await one<any>(
    `SELECT t.id, t.started_at AS "startedAt", wa.title AS "assignmentTitle",
            wa.assignment_code AS "assignmentCode", wa.id AS "assignmentId"
       FROM time_entries t LEFT JOIN work_assignments wa ON wa.id = t.assignment_id
      WHERE t.user_id = $1 AND t.ended_at IS NULL`, [p.id]);

  res.json({
    work, time,
    attendance: { onDuty: attendance.onDuty, checkInAt: attendance.checkInAt },
    expenses: { ...expenses, awaitingPayment: Number(expenses.awaitingPayment) },
    unreadNotifications: unread?.count ?? 0,
    timer: timer ? { running: true, ...timer } : { running: false },
  });
}));
