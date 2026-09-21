-- =====================================================================
-- ADISYS FieldOps — 006 Reporting views
-- Every report in the product reads from these views so that a figure
-- means the same thing wherever it appears.
-- =====================================================================

-- Domain vocabulary: "employee" = an active, non-deleted user.
CREATE VIEW employees AS
SELECT u.id, u.employee_code, u.full_name, u.email, u.phone, u.avatar_file_id,
       u.role_id, r.key AS role_key, r.name AS role_name,
       u.department_id, d.name AS department_name,
       u.designation_id, dg.name AS designation_name,
       u.base_location_id, wl.name AS base_location_name,
       u.reporting_manager_id, m.full_name AS reporting_manager_name,
       u.date_of_joining, u.status, u.last_login_at, u.created_at, u.updated_at
FROM users u
JOIN roles r ON r.id = u.role_id
LEFT JOIN departments  d  ON d.id  = u.department_id
LEFT JOIN designations dg ON dg.id = u.designation_id
LEFT JOIN work_locations wl ON wl.id = u.base_location_id
LEFT JOIN users m ON m.id = u.reporting_manager_id
WHERE u.deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- Acknowledgement state of each live assignment.
-- `is_current` is false when the assignment was edited after the
-- employee acknowledged it — the app surfaces this as "changed since
-- you acknowledged".
-- ---------------------------------------------------------------------
CREATE VIEW v_assignment_acknowledgement AS
SELECT wa.id AS assignment_id,
       wa.version                       AS current_version,
       ack.assignment_version           AS acknowledged_version,
       ack.decision,
       ack.acknowledged_at,
       ack.mode,
       (ack.id IS NOT NULL AND ack.decision = 'acknowledged'
          AND ack.assignment_version = wa.version) AS is_current
FROM work_assignments wa
LEFT JOIN LATERAL (
  SELECT a.* FROM assignment_acknowledgements a
  WHERE a.assignment_id = wa.id
  ORDER BY a.assignment_version DESC, a.acknowledged_at DESC
  LIMIT 1
) ack ON true
WHERE wa.deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- The single source of truth for time. Three measures, never merged.
-- ---------------------------------------------------------------------
CREATE VIEW v_time_daily AS
SELECT te.user_id,
       te.work_date,
       te.project_id,
       COUNT(*) FILTER (WHERE te.ended_at IS NOT NULL)                       AS entry_count,
       COALESCE(SUM(te.duration_minutes) FILTER (
         WHERE te.verification_status <> 'rejected'), 0)                     AS recorded_minutes,
       COALESCE(SUM(te.duration_minutes) FILTER (
         WHERE te.verification_status = 'verified'), 0)                      AS verified_minutes,
       COALESCE(SUM(te.duration_minutes) FILTER (
         WHERE te.assignment_id IS NULL
           AND te.verification_status <> 'rejected'), 0)                     AS unassigned_minutes
FROM time_entries te
WHERE te.ended_at IS NOT NULL
GROUP BY te.user_id, te.work_date, te.project_id;

CREATE VIEW v_attendance_daily AS
SELECT a.user_id,
       a.work_date,
       MIN(a.check_in_at)  AS first_check_in,
       MAX(a.check_out_at) AS last_check_out,
       COALESCE(SUM(EXTRACT(EPOCH FROM (a.check_out_at - a.check_in_at)) / 60)
                FILTER (WHERE a.check_out_at IS NOT NULL), 0)::int AS attendance_minutes,
       bool_or(a.check_out_at IS NULL) AS has_open_session
FROM attendance_sessions a
GROUP BY a.user_id, a.work_date;

-- ---------------------------------------------------------------------
-- Base expense view. EVERY expense figure in the product derives from
-- this one relation, so employee-wise and project-wise totals are two
-- groupings of the same rows and can never double-count.
-- ---------------------------------------------------------------------
CREATE VIEW v_expense_claims AS
SELECT ec.id, ec.expense_code, ec.user_id, u.full_name AS employee_name,
       u.employee_code, u.department_id, d.name AS department_name,
       ec.project_id, p.name AS project_name, p.project_code,
       ec.category_id, c.name AS category_name, c.key AS category_key,
       ec.subcategory_id, sc.name AS subcategory_name,
       ec.expense_date, date_trunc('month', ec.expense_date)::date AS expense_month,
       ec.amount, ec.currency, ec.status, ec.current_stage,
       ec.description, ec.vendor_name, ec.invoice_number,
       ec.submitted_at, ec.decided_at, ec.created_at,
       (ec.status IN ('approved','reimbursement_pending','paid'))     AS is_approved,
       (ec.status IN ('submitted','under_review'))                    AS is_pending,
       (ec.status = 'rejected')                                       AS is_rejected,
       (ec.status = 'returned')                                       AS needs_correction,
       CASE WHEN ec.status IN ('approved','reimbursement_pending','paid')
            THEN ec.amount ELSE 0 END                                 AS approved_amount,
       CASE WHEN ec.status IN ('submitted','under_review')
            THEN ec.amount ELSE 0 END                                 AS pending_amount,
       (SELECT COUNT(*) FROM expense_attachments ea WHERE ea.claim_id = ec.id) AS attachment_count,
       EXTRACT(EPOCH FROM (ec.decided_at - ec.submitted_at)) / 3600   AS decision_hours
FROM expense_claims ec
JOIN users u ON u.id = ec.user_id
LEFT JOIN departments d ON d.id = u.department_id
LEFT JOIN projects p ON p.id = ec.project_id
JOIN expense_categories c  ON c.id  = ec.category_id
LEFT JOIN expense_categories sc ON sc.id = ec.subcategory_id
WHERE ec.deleted_at IS NULL;

CREATE VIEW v_project_summary AS
SELECT p.id AS project_id, p.project_code, p.name, p.client_name, p.status, p.priority,
       p.start_date, p.expected_end_date, p.actual_end_date,
       p.budget_enabled, p.budget_amount, p.currency,
       p.manager_id, mgr.full_name AS manager_name,
       (SELECT COUNT(*) FROM project_members pm
          WHERE pm.project_id = p.id AND pm.removed_at IS NULL)              AS member_count,
       (SELECT COUNT(*) FROM work_assignments wa
          WHERE wa.project_id = p.id AND wa.deleted_at IS NULL)              AS assignment_count,
       (SELECT COUNT(*) FROM work_assignments wa
          WHERE wa.project_id = p.id AND wa.deleted_at IS NULL
            AND wa.status = 'completed')                                     AS completed_count,
       (SELECT COALESCE(SUM(te.duration_minutes),0) FROM time_entries te
          WHERE te.project_id = p.id AND te.ended_at IS NOT NULL
            AND te.verification_status <> 'rejected')                        AS recorded_minutes,
       (SELECT COALESCE(SUM(te.duration_minutes),0) FROM time_entries te
          WHERE te.project_id = p.id AND te.ended_at IS NOT NULL
            AND te.verification_status = 'verified')                         AS verified_minutes,
       (SELECT COALESCE(SUM(v.approved_amount),0) FROM v_expense_claims v
          WHERE v.project_id = p.id)                                         AS approved_expense,
       (SELECT COALESCE(SUM(v.pending_amount),0)  FROM v_expense_claims v
          WHERE v.project_id = p.id)                                         AS pending_expense
FROM projects p
JOIN users mgr ON mgr.id = p.manager_id
WHERE p.deleted_at IS NULL;

-- Completion % is derived, never stored, so it cannot drift from the tasks.
CREATE VIEW v_project_progress AS
SELECT project_id,
       assignment_count,
       completed_count,
       CASE WHEN assignment_count = 0 THEN 0
            ELSE ROUND(completed_count::numeric * 100 / assignment_count) END AS completion_pct
FROM v_project_summary;
