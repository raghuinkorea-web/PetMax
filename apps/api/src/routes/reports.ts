import { Router } from 'express';
import { z } from 'zod';
import { METRIC_DEFINITIONS } from '@adisys/shared';
import { one, query } from '../lib/db.js';
import { asyncHandler, dateString, parse, uuid } from '../lib/http.js';
import { forbidden } from '../lib/errors.js';
import { principalOf, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { projectScopeClause, scopeFor, userScopeClause } from '../services/scope.js';

export const reportRouter = Router();

const rangeSchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  projectId: uuid.optional(),
  employeeId: uuid.optional(),
  departmentId: uuid.optional(),
  categoryId: uuid.optional(),
  status: z.string().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

/** Defaults to the current calendar month when no range is supplied. */
const resolveRange = (f: { from?: string; to?: string }) => ({
  from: f.from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
  to: f.to ?? new Date().toISOString().slice(0, 10),
});

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    // Guard against CSV formula injection when opened in Excel.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

async function deliver(req: any, res: any, name: string, rows: any[], extra: Record<string, unknown> = {}) {
  const format = req.query.format === 'csv' ? 'csv' : 'json';
  if (format === 'csv') {
    await recordAudit(req, { action: 'report.exported', entityType: 'report', after: { report: name, rows: rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="adisys-${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(toCsv(rows));
  }
  res.json({ report: name, rows, count: rows.length, ...extra, definitions: METRIC_DEFINITIONS });
}

const assertReportAccess = (req: any) => {
  const p = principalOf(req);
  if (scopeFor(p, 'report.view') === 'none') throw forbidden('You do not have access to reports.');
};

// =====================================================================
// PRODUCTIVITY
// =====================================================================
reportRouter.get('/productivity/summary', asyncHandler(async (req, res) => {
  assertReportAccess(req);
  const p = principalOf(req);
  const f = parse(rangeSchema, req.query);
  const { from, to } = resolveRange(f);
  const scope = userScopeClause(p, 'u.id', 1, 'productivity.view');
  const n = scope.params.length;

  const rows = await query(
    `SELECT u.employee_code AS "employeeCode", u.full_name AS "employeeName",
            d.name AS "departmentName",
            COALESCE(att.attendance_minutes, 0)                AS "attendanceMinutes",
            COALESCE(att.days_on_duty, 0)                      AS "daysOnDuty",
            COALESCE(t.recorded_minutes, 0)                    AS "recordedMinutes",
            COALESCE(t.verified_minutes, 0)                    AS "verifiedMinutes",
            COALESCE(t.unassigned_minutes, 0)                  AS "unassignedMinutes",
            COALESCE(w.estimated_minutes, 0)                   AS "estimatedMinutes",
            COALESCE(w.issued, 0)                              AS "assignmentsIssued",
            COALESCE(w.acknowledged, 0)                        AS "assignmentsAcknowledged",
            COALESCE(w.completed, 0)                           AS "assignmentsCompleted",
            COALESCE(w.overdue, 0)                             AS "assignmentsOverdue",
            CASE WHEN COALESCE(w.issued,0) = 0 THEN NULL
                 ELSE ROUND(w.acknowledged::numeric * 100 / w.issued, 1) END AS "acknowledgementRatePct",
            CASE WHEN COALESCE(w.issued,0) = 0 THEN NULL
                 ELSE ROUND(w.completed::numeric * 100 / w.issued, 1) END    AS "completionRatePct"
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN LATERAL (
         SELECT SUM(duration_minutes) FILTER (WHERE verification_status <> 'rejected')::int AS recorded_minutes,
                SUM(duration_minutes) FILTER (WHERE verification_status = 'verified')::int  AS verified_minutes,
                SUM(duration_minutes) FILTER (WHERE assignment_id IS NULL
                     AND verification_status <> 'rejected')::int                            AS unassigned_minutes
           FROM time_entries te
          WHERE te.user_id = u.id AND te.ended_at IS NOT NULL
            AND te.work_date BETWEEN $${n + 1}::date AND $${n + 2}::date
            AND ($${n + 3}::uuid IS NULL OR te.project_id = $${n + 3})
       ) t ON true
       LEFT JOIN LATERAL (
         SELECT SUM(a.attendance_minutes)::int AS attendance_minutes,
                COUNT(*)::int                  AS days_on_duty
           FROM v_attendance_daily a
          WHERE a.user_id = u.id AND a.work_date BETWEEN $${n + 1}::date AND $${n + 2}::date
       ) att ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS issued,
                COUNT(*) FILTER (WHERE ack.is_current)::int AS acknowledged,
                COUNT(*) FILTER (WHERE wa.status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE wa.due_date < CURRENT_DATE
                                   AND wa.status NOT IN ('completed','cancelled'))::int AS overdue,
                (SUM(wa.estimated_hours) * 60)::int AS estimated_minutes
           FROM work_assignments wa
           LEFT JOIN v_assignment_acknowledgement ack ON ack.assignment_id = wa.id
          WHERE wa.assignee_id = u.id AND wa.deleted_at IS NULL
            AND wa.assignment_date BETWEEN $${n + 1}::date AND $${n + 2}::date
            AND ($${n + 3}::uuid IS NULL OR wa.project_id = $${n + 3})
       ) w ON true
      WHERE u.deleted_at IS NULL AND ${scope.sql}
        AND ($${n + 4}::uuid IS NULL OR u.id = $${n + 4})
        AND ($${n + 5}::uuid IS NULL OR u.department_id = $${n + 5})
        AND (COALESCE(t.recorded_minutes,0) > 0
             OR COALESCE(w.issued,0) > 0
             -- On duty but nothing recorded is itself a finding: keep the row.
             -- Tested on the presence of a session, not on its duration, so a
             -- short or still-open shift is not silently dropped.
             OR COALESCE(att.days_on_duty,0) > 0)
      ORDER BY "verifiedMinutes" DESC, u.full_name`,
    [...scope.params, from, to, f.projectId ?? null, f.employeeId ?? null, f.departmentId ?? null]);

  await deliver(req, res, 'productivity-summary', rows, { range: { from, to } });
}));

reportRouter.get('/productivity/daily', asyncHandler(async (req, res) => {
  assertReportAccess(req);
  const p = principalOf(req);
  const f = parse(rangeSchema, req.query);
  const { from, to } = resolveRange(f);
  const scope = userScopeClause(p, 'u.id', 1, 'productivity.view');
  const n = scope.params.length;

  const rows = await query(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
            COALESCE(SUM(td.recorded_minutes), 0)::int   AS "recordedMinutes",
            COALESCE(SUM(td.verified_minutes), 0)::int   AS "verifiedMinutes",
            COALESCE(SUM(td.unassigned_minutes), 0)::int AS "unassignedMinutes",
            COALESCE(SUM(ad.attendance_minutes), 0)::int AS "attendanceMinutes",
            COUNT(DISTINCT td.user_id)::int              AS "employeesRecording"
       FROM generate_series($${n + 1}::date, $${n + 2}::date, interval '1 day') d(day)
       LEFT JOIN v_time_daily td ON td.work_date = d.day::date
            AND td.user_id IN (SELECT u.id FROM users u WHERE u.deleted_at IS NULL AND ${scope.sql})
            AND ($${n + 3}::uuid IS NULL OR td.project_id = $${n + 3})
       LEFT JOIN v_attendance_daily ad ON ad.work_date = d.day::date AND ad.user_id = td.user_id
      GROUP BY d.day ORDER BY d.day`,
    [...scope.params, from, to, f.projectId ?? null]);

  await deliver(req, res, 'productivity-daily', rows, { range: { from, to } });
}));

// =====================================================================
// WORK
// =====================================================================
reportRouter.get('/work/assignments', asyncHandler(async (req, res) => {
  assertReportAccess(req);
  const p = principalOf(req);
  const f = parse(rangeSchema, req.query);
  const { from, to } = resolveRange(f);
  const scope = userScopeClause(p, 'wa.assignee_id', 1, 'work.view');
  const n = scope.params.length;

  const rows = await query(
    `SELECT wa.assignment_code AS "assignmentCode", pr.project_code AS "projectCode", pr.name AS "projectName",
            u.employee_code AS "employeeCode", u.full_name AS "employeeName",
            wa.title, wa.status, wa.priority,
            wa.assignment_date AS "assignmentDate", wa.due_date AS "dueDate",
            wa.estimated_hours AS "estimatedHours",
            ROUND(COALESCE(te.recorded,0)::numeric / 60, 2) AS "recordedHours",
            ROUND(COALESCE(te.verified,0)::numeric / 60, 2) AS "verifiedHours",
            ack.decision AS "acknowledgementDecision",
            ack.acknowledged_at AS "acknowledgedAt",
            COALESCE(ack.is_current, false) AS "acknowledgementCurrent",
            wa.completed_at AS "completedAt",
            (wa.due_date < CURRENT_DATE AND wa.status NOT IN ('completed','cancelled')) AS "isOverdue"
       FROM work_assignments wa
       JOIN projects pr ON pr.id = wa.project_id
       JOIN users u ON u.id = wa.assignee_id
       LEFT JOIN v_assignment_acknowledgement ack ON ack.assignment_id = wa.id
       LEFT JOIN LATERAL (
         SELECT SUM(duration_minutes) FILTER (WHERE verification_status <> 'rejected') AS recorded,
                SUM(duration_minutes) FILTER (WHERE verification_status = 'verified')  AS verified
           FROM time_entries t WHERE t.assignment_id = wa.id AND t.ended_at IS NOT NULL
       ) te ON true
      WHERE wa.deleted_at IS NULL AND ${scope.sql}
        AND wa.assignment_date BETWEEN $${n + 1}::date AND $${n + 2}::date
        AND ($${n + 3}::uuid IS NULL OR wa.project_id = $${n + 3})
        AND ($${n + 4}::uuid IS NULL OR wa.assignee_id = $${n + 4})
        AND ($${n + 5}::text IS NULL OR wa.status = ANY(string_to_array($${n + 5}, ',')))
      ORDER BY wa.assignment_date DESC, wa.assignment_code`,
    [...scope.params, from, to, f.projectId ?? null, f.employeeId ?? null, f.status ?? null]);

  await deliver(req, res, 'work-assignments', rows, { range: { from, to } });
}));

// =====================================================================
// EXPENSES — all three groupings read v_expense_claims, so employee-wise
// and project-wise totals always reconcile to the same underlying rows.
// =====================================================================
const expenseScope = (req: any, startIdx: number) => {
  const p = principalOf(req);
  const scope = scopeFor(p, 'expense.view');
  if (scope === 'all')  return { sql: 'TRUE', params: [] as unknown[] };
  if (scope === 'own')  return { sql: `v.user_id = $${startIdx}`, params: [p.id] };
  if (scope === 'team') return {
    sql: `(v.user_id = $${startIdx}
           OR v.user_id IN (SELECT id FROM users WHERE reporting_manager_id = $${startIdx})
           OR v.project_id IN (SELECT id FROM projects WHERE manager_id = $${startIdx}))`,
    params: [p.id],
  };
  return { sql: 'FALSE', params: [] as unknown[] };
};

reportRouter.get('/expenses/detail', asyncHandler(async (req, res) => {
  assertReportAccess(req);
  const f = parse(rangeSchema, req.query);
  const { from, to } = resolveRange(f);
  const s = expenseScope(req, 1);
  const n = s.params.length;

  const rows = await query(
    `SELECT v.expense_code AS "expenseCode", v.expense_date AS "expenseDate",
            v.employee_code AS "employeeCode", v.employee_name AS "employeeName",
            v.department_name AS "department", v.project_code AS "projectCode", v.project_name AS "projectName",
            v.category_name AS "category", v.subcategory_name AS "subcategory",
            v.amount, v.currency, v.status, v.description, v.vendor_name AS "vendor",
            v.invoice_number AS "invoiceNumber", v.submitted_at AS "submittedAt",
            v.decided_at AS "decidedAt", ROUND(v.decision_hours::numeric, 1) AS "decisionHours",
            v.attachment_count AS "receipts"
       FROM v_expense_claims v
      WHERE ${s.sql} AND v.status <> 'draft'
        AND v.expense_date BETWEEN $${n + 1}::date AND $${n + 2}::date
        AND ($${n + 3}::uuid IS NULL OR v.project_id = $${n + 3})
        AND ($${n + 4}::uuid IS NULL OR v.user_id = $${n + 4})
        AND ($${n + 5}::uuid IS NULL OR v.category_id = $${n + 5})
        AND ($${n + 6}::text IS NULL OR v.status = ANY(string_to_array($${n + 6}, ',')))
      ORDER BY v.expense_date DESC, v.expense_code`,
    [...s.params, from, to, f.projectId ?? null, f.employeeId ?? null, f.categoryId ?? null, f.status ?? null]);

  const totals = await one<any>(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(v.amount),0) AS total,
            COALESCE(SUM(v.approved_amount),0) AS approved,
            COALESCE(SUM(v.pending_amount),0) AS pending
       FROM v_expense_claims v
      WHERE ${s.sql} AND v.status <> 'draft'
        AND v.expense_date BETWEEN $${n + 1}::date AND $${n + 2}::date
        AND ($${n + 3}::uuid IS NULL OR v.project_id = $${n + 3})
        AND ($${n + 4}::uuid IS NULL OR v.user_id = $${n + 4})
        AND ($${n + 5}::uuid IS NULL OR v.category_id = $${n + 5})
        AND ($${n + 6}::text IS NULL OR v.status = ANY(string_to_array($${n + 6}, ',')))`,
    [...s.params, from, to, f.projectId ?? null, f.employeeId ?? null, f.categoryId ?? null, f.status ?? null]);

  await deliver(req, res, 'expense-detail', rows, { range: { from, to }, totals });
}));

const groupedExpenseReport = (
  name: string, groupSql: string, labelColumns: string,
) => asyncHandler(async (req: any, res: any) => {
  assertReportAccess(req);
  const f = parse(rangeSchema, req.query);
  const { from, to } = resolveRange(f);
  const s = expenseScope(req, 1);
  const n = s.params.length;

  const rows = await query(
    `SELECT ${labelColumns},
            COUNT(*)::int AS "claimCount",
            COALESCE(SUM(v.amount),0)          AS "totalAmount",
            COALESCE(SUM(v.approved_amount),0) AS "approvedAmount",
            COALESCE(SUM(v.pending_amount),0)  AS "pendingAmount",
            COALESCE(SUM(v.amount) FILTER (WHERE v.is_rejected),0) AS "rejectedAmount",
            ROUND(AVG(v.decision_hours)::numeric, 1) AS "avgDecisionHours"
       FROM v_expense_claims v
      WHERE ${s.sql} AND v.status <> 'draft'
        AND v.expense_date BETWEEN $${n + 1}::date AND $${n + 2}::date
        AND ($${n + 3}::uuid IS NULL OR v.project_id = $${n + 3})
      GROUP BY ${groupSql}
      ORDER BY "approvedAmount" DESC`,
    [...s.params, from, to, f.projectId ?? null]);

  await deliver(req, res, name, rows, { range: { from, to } });
});

reportRouter.get('/expenses/by-employee', groupedExpenseReport(
  'expense-by-employee', 'v.employee_code, v.employee_name, v.department_name',
  'v.employee_code AS "employeeCode", v.employee_name AS "employeeName", v.department_name AS "department"'));

reportRouter.get('/expenses/by-project', groupedExpenseReport(
  'expense-by-project', 'v.project_code, v.project_name',
  'v.project_code AS "projectCode", COALESCE(v.project_name, \'(no project)\') AS "projectName"'));

reportRouter.get('/expenses/by-category', groupedExpenseReport(
  'expense-by-category', 'v.category_name',
  'v.category_name AS "category"'));

reportRouter.get('/expenses/monthly', asyncHandler(async (req, res) => {
  assertReportAccess(req);
  const s = expenseScope(req, 1);
  const rows = await query(
    `SELECT to_char(v.expense_month, 'YYYY-MM') AS month,
            COUNT(*)::int AS "claimCount",
            COALESCE(SUM(v.approved_amount),0) AS "approvedAmount",
            COALESCE(SUM(v.pending_amount),0)  AS "pendingAmount",
            COALESCE(SUM(v.amount) FILTER (WHERE v.is_rejected),0) AS "rejectedAmount"
       FROM v_expense_claims v
      WHERE ${s.sql} AND v.status <> 'draft'
        AND v.expense_date >= date_trunc('month', CURRENT_DATE - interval '11 months')::date
      GROUP BY v.expense_month ORDER BY v.expense_month`, s.params);
  await deliver(req, res, 'expense-monthly', rows);
}));

/** How long approvals take — the service level for field staff. */
reportRouter.get('/expenses/approval-turnaround', requirePermission('report.view.all', 'report.view.team'),
  asyncHandler(async (req, res) => {
    const s = expenseScope(req, 1);
    const rows = await query(
      `SELECT a.stage,
              u.full_name AS "approverName",
              COUNT(*)::int AS decisions,
              ROUND(AVG(EXTRACT(EPOCH FROM (a.acted_at - v.submitted_at)) / 3600)::numeric, 1) AS "avgHours",
              ROUND(MAX(EXTRACT(EPOCH FROM (a.acted_at - v.submitted_at)) / 3600)::numeric, 1) AS "maxHours",
              COUNT(*) FILTER (WHERE a.action = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE a.action = 'rejected')::int AS rejected,
              COUNT(*) FILTER (WHERE a.action = 'returned')::int AS returned
         FROM expense_approvals a
         JOIN v_expense_claims v ON v.id = a.claim_id
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE ${s.sql} AND a.stage IN ('manager','finance')
          AND v.submitted_at IS NOT NULL AND a.acted_at >= v.submitted_at
        GROUP BY a.stage, u.full_name
        ORDER BY a.stage, "avgHours" DESC`, s.params);
    await deliver(req, res, 'expense-approval-turnaround', rows);
  }));

// =====================================================================
// PROJECTS
// =====================================================================
reportRouter.get('/projects/summary', asyncHandler(async (req, res) => {
  assertReportAccess(req);
  const p = principalOf(req);
  const scope = projectScopeClause(p, 's.project_id', 1);

  const rows = await query(
    `SELECT s.project_code AS "projectCode", s.name AS "projectName", s.client_name AS "client",
            s.status, s.manager_name AS "manager",
            s.start_date AS "startDate", s.expected_end_date AS "expectedEndDate",
            s.member_count AS "members", s.assignment_count AS "assignments",
            s.completed_count AS "completed", pg.completion_pct AS "completionPct",
            ROUND(s.recorded_minutes::numeric / 60, 1) AS "recordedHours",
            ROUND(s.verified_minutes::numeric / 60, 1) AS "verifiedHours",
            s.approved_expense AS "approvedExpense", s.pending_expense AS "pendingExpense",
            CASE WHEN s.budget_enabled THEN s.budget_amount END AS "budget",
            CASE WHEN s.budget_enabled AND s.budget_amount > 0
                 THEN ROUND(s.approved_expense * 100 / s.budget_amount, 1) END AS "budgetUtilisationPct"
       FROM v_project_summary s
       JOIN v_project_progress pg ON pg.project_id = s.project_id
      WHERE ${scope.sql}
      ORDER BY s.approved_expense DESC`, scope.params);

  await deliver(req, res, 'project-summary', rows);
}));

/** The catalogue of available reports, filtered by what the caller may run. */
reportRouter.get('/', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const scope = scopeFor(p, 'report.view');
  const all = [
    { key: 'productivity/summary', name: 'Productivity summary', group: 'Employee',
      description: 'Attendance, recorded and verified hours, acknowledgement and completion rates per employee.' },
    { key: 'productivity/daily', name: 'Daily productivity trend', group: 'Employee',
      description: 'Day-by-day recorded versus verified hours across the selected scope.' },
    { key: 'work/assignments', name: 'Work assignment register', group: 'Employee',
      description: 'Every assignment with its acknowledgement state, planned versus recorded hours and outcome.' },
    { key: 'expenses/detail', name: 'Expense claim register', group: 'Finance',
      description: 'Line-by-line claims with status, receipts and decision turnaround.' },
    { key: 'expenses/by-employee', name: 'Expense by employee', group: 'Finance',
      description: 'Claim totals grouped by employee. Reconciles exactly with the project view.' },
    { key: 'expenses/by-project', name: 'Expense by project', group: 'Finance',
      description: 'Claim totals grouped by project. Reconciles exactly with the employee view.' },
    { key: 'expenses/by-category', name: 'Expense by category', group: 'Finance',
      description: 'Where the spend goes, by expense category.' },
    { key: 'expenses/monthly', name: 'Monthly expense trend', group: 'Finance',
      description: 'Twelve-month approved, pending and rejected trend.' },
    { key: 'expenses/approval-turnaround', name: 'Approval turnaround', group: 'Finance',
      description: 'How long each approver takes to decide, by stage.', requiresScope: 'team' },
    { key: 'projects/summary', name: 'Project summary', group: 'Project',
      description: 'Progress, hours and spend for every project, with budget utilisation where configured.' },
  ];
  const allowed = all.filter((r) => !r.requiresScope || scope === 'all' || scope === 'team');
  res.json({ data: allowed, scope, definitions: METRIC_DEFINITIONS });
}));
