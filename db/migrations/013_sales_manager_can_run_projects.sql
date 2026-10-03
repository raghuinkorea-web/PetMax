-- =====================================================================
-- 013 — A Sales Manager may also be the Project Manager
--
-- The Project Manager dropdown now offers Sales Managers as well, so one
-- of them can be put in charge of a project. For that to be worth
-- anything they need the permissions to actually run it: add technicians,
-- assign activities, review completion.
--
-- This is narrower than it reads. Every permission below is scoped per
-- project by `projects.manager_id = caller` in the API, so it applies
-- only to projects a Sales Manager has actually been given. It grants
-- nothing on projects run by somebody else.
--
-- Deliberately NOT granted: leave.approve and time.verify. Those follow
-- the reporting line rather than the project, and nothing in this change
-- puts a Sales Manager in anyone's reporting line.
-- =====================================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN (
        'project.view.managed',
        'project.assign_members',
        'work.view.team',
        'work.create',
        'work.update',
        'work.cancel',
        'work.review',
        'expense.approve.manager')
 WHERE r.key = 'sales_manager'
ON CONFLICT DO NOTHING;
