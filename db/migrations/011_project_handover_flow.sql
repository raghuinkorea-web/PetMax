-- =====================================================================
-- 011 — Project creation becomes a three-step hand-over
--
--   Admin            creates the project (no manager yet)
--   Sales Manager    attaches a Project Manager to it
--   Project Manager  adds technicians and assigns activities
--
-- Until now those first two steps were one action: whoever created a
-- project chose its manager in the same form, and `manager_id` was NOT
-- NULL so a project could not exist without one. Splitting the steps
-- means a project has to be able to sit, visibly, waiting for a manager.
--
-- The existing roles are relabelled rather than replaced, so all 34
-- staff keep their accounts and permissions:
--     ops_manager -> "Project Manager"
--     employee    -> "Technician / Field Staff"
-- and one new role, sales_manager, is added.
-- =====================================================================

-- --- 1. The permission that carries step 2 ---------------------------
INSERT INTO permissions (key, module, description)
VALUES ('project.assign_manager', 'project',
        'Hand a project to a Project Manager')
ON CONFLICT (key) DO NOTHING;

-- --- 2. Relabel the two existing roles -------------------------------
UPDATE roles
   SET name = 'Project Manager',
       description = 'Runs the projects handed to them: adds technicians, '
                  || 'assigns activities, reviews completion and approves '
                  || 'expenses at the manager stage.'
 WHERE key = 'ops_manager';

UPDATE roles
   SET name = 'Technician / Field Staff',
       description = 'Receives and acknowledges activities, records time, '
                  || 'submits expense claims.'
 WHERE key = 'employee';

-- --- 3. The new role -------------------------------------------------
INSERT INTO roles (key, name, description, is_system)
VALUES ('sales_manager', 'Sales Manager',
        'Takes a newly created project and hands it to a Project Manager.',
        true)
ON CONFLICT (key) DO NOTHING;

-- --- 4. What a Sales Manager may do ----------------------------------
-- Deliberately narrow: they need to see every project in order to spot
-- the ones still waiting, and every employee in order to choose a
-- manager. Everything else here is just their own working life in the
-- app — their leave, their own claims.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN (
        'dashboard.view',
        'employee.view.own', 'employee.view.all',
        'project.view.all', 'project.assign_manager',
        'expense.create', 'expense.view.own',
        'leave.apply', 'leave.view.own',
        'attendance.record',
        'report.view.own',
        'settings.view')
 WHERE r.key = 'sales_manager'
ON CONFLICT DO NOTHING;

-- --- 5. Super Admin holds every permission, new one included ---------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'super_admin'
ON CONFLICT DO NOTHING;

-- --- 6. Creating a project is now the Admin's alone ------------------
-- A Project Manager runs projects; they no longer open them.
DELETE FROM role_permissions
 WHERE role_id = (SELECT id FROM roles WHERE key = 'ops_manager')
   AND permission_id = (SELECT id FROM permissions WHERE key = 'project.create');

-- --- 7. A project may now exist before it has a manager --------------
ALTER TABLE projects ALTER COLUMN manager_id DROP NOT NULL;

-- --- 8. Keep unmanaged projects visible ------------------------------
-- v_project_summary INNER JOINed the manager, which every project list
-- and detail read is built on. Left as it was, a project created in
-- step 1 would disappear from the very screen the Sales Manager needs
-- in step 2. Only the join changes.
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
          WHERE v.project_id = p.id) AS pending_expense
  FROM projects p
  LEFT JOIN users mgr ON mgr.id = p.manager_id
 WHERE p.deleted_at IS NULL;
