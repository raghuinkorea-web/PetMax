-- =====================================================================
-- 012 — A project names its Sales Manager as well as its Project Manager
--
-- 011 gave every project a Project Manager and made the hand-over a
-- distinct step, but "who hands it over" was still anyone holding the
-- Sales Manager role. A project now names both people:
--
--   sales_manager_id  — the Sales Manager who owns the hand-over
--   manager_id        — the Project Manager who runs the work
--
-- Both are nullable: an Admin may open a project before either is known.
-- =====================================================================

-- --- 1. The column ---------------------------------------------------
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS sales_manager_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_projects_sales_manager
    ON projects (sales_manager_id) WHERE deleted_at IS NULL;

-- A project cannot have the same person on both sides of the hand-over:
-- the point of the split is that two people are involved.
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS chk_project_distinct_managers;
ALTER TABLE projects
  ADD CONSTRAINT chk_project_distinct_managers
  CHECK (sales_manager_id IS NULL OR manager_id IS NULL OR sales_manager_id <> manager_id);

-- --- 2. The permission that sets it ----------------------------------
INSERT INTO permissions (key, module, description)
VALUES ('project.assign_sales_manager', 'project',
        'Put a Sales Manager in charge of a project')
ON CONFLICT (key) DO NOTHING;

-- Admin only: assigning the Sales Manager is part of opening the project.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'super_admin'
ON CONFLICT DO NOTHING;

-- --- 3. Carry both people through the summary view -------------------
-- New columns are appended, which is all CREATE OR REPLACE VIEW permits.
CREATE OR REPLACE VIEW v_project_summary AS
SELECT p.id AS project_id,
       p.project_code,
       p.name,
       p.client_name,
       p.status,
       p.priority,
       p.start_date,
       p.expected_end_date,
       p.actual_end_date,
       p.budget_enabled,
       p.budget_amount,
       p.currency,
       p.manager_id,
       mgr.full_name AS manager_name,
       ( SELECT count(*) AS count
           FROM project_members pm
          WHERE pm.project_id = p.id AND pm.removed_at IS NULL) AS member_count,
       ( SELECT count(*) AS count
           FROM work_assignments wa
          WHERE wa.project_id = p.id AND wa.deleted_at IS NULL) AS assignment_count,
       ( SELECT count(*) AS count
           FROM work_assignments wa
          WHERE wa.project_id = p.id AND wa.deleted_at IS NULL
            AND wa.status = 'completed'::text) AS completed_count,
       ( SELECT COALESCE(sum(te.duration_minutes), 0::bigint) AS "coalesce"
           FROM time_entries te
          WHERE te.project_id = p.id AND te.ended_at IS NOT NULL
            AND te.verification_status <> 'rejected'::text) AS recorded_minutes,
       ( SELECT COALESCE(sum(te.duration_minutes), 0::bigint) AS "coalesce"
           FROM time_entries te
          WHERE te.project_id = p.id AND te.ended_at IS NOT NULL
            AND te.verification_status = 'verified'::text) AS verified_minutes,
       ( SELECT COALESCE(sum(v.approved_amount), 0::numeric) AS "coalesce"
           FROM v_expense_claims v
          WHERE v.project_id = p.id) AS approved_expense,
       ( SELECT COALESCE(sum(v.pending_amount), 0::numeric) AS "coalesce"
           FROM v_expense_claims v
          WHERE v.project_id = p.id) AS pending_expense,
       p.sales_manager_id,
       sm.full_name AS sales_manager_name
  FROM projects p
  LEFT JOIN users mgr ON mgr.id = p.manager_id
  LEFT JOIN users sm  ON sm.id  = p.sales_manager_id
 WHERE p.deleted_at IS NULL;
