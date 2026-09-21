/**
 * ADISYS FieldOps — permission catalogue and role matrix.
 *
 * Scope suffixes are meaningful and enforced server-side:
 *   .own   -> only rows the caller owns
 *   .team  -> rows belonging to the caller's direct/indirect reports,
 *             or to projects the caller manages
 *   .all   -> organisation-wide
 *
 * A caller's effective scope for a module is the widest scope they hold.
 */

export const PERMISSIONS = {
  // Dashboard
  'dashboard.view':            { module: 'dashboard',     description: 'Open the operational dashboard' },

  // Employees
  'employee.view.own':         { module: 'employee',     description: 'View own employee profile' },
  'employee.view.team':        { module: 'employee',     description: 'View employees who report to the caller' },
  'employee.view.all':         { module: 'employee',     description: 'View all employees' },
  'employee.create':           { module: 'employee',     description: 'Create employees and issue credentials' },
  'employee.update':           { module: 'employee',     description: 'Edit employee records' },
  'employee.deactivate':       { module: 'employee',     description: 'Activate or deactivate employees' },

  // Projects
  'project.view.assigned':     { module: 'project',      description: 'View projects the caller is a member of' },
  'project.view.managed':      { module: 'project',      description: 'View projects the caller manages' },
  'project.view.all':          { module: 'project',      description: 'View all projects' },
  'project.create':            { module: 'project',      description: 'Create projects' },
  'project.update':            { module: 'project',      description: 'Edit project details' },
  'project.assign_members':    { module: 'project',      description: 'Add or remove project members' },

  // Work assignments
  'work.view.own':             { module: 'work',         description: 'View own assignments' },
  'work.view.team':            { module: 'work',         description: 'View assignments on managed projects / reports' },
  'work.view.all':             { module: 'work',         description: 'View all assignments' },
  'work.create':               { module: 'work',         description: 'Assign work to employees' },
  'work.update':               { module: 'work',         description: 'Edit or reassign work' },
  'work.cancel':               { module: 'work',         description: 'Cancel an assignment' },
  'work.acknowledge':          { module: 'work',         description: 'Acknowledge assigned work' },
  'work.progress':             { module: 'work',         description: 'Update progress and submit work for review' },
  'work.review':               { module: 'work',         description: 'Accept completion or return for clarification' },

  // Productivity & time
  'time.log':                  { module: 'productivity', description: 'Record time against assignments' },
  'time.verify':               { module: 'productivity', description: 'Verify recorded time as productive hours' },
  'attendance.record':         { module: 'productivity', description: 'Check in and out' },
  'productivity.view.own':     { module: 'productivity', description: 'View own productivity' },
  'productivity.view.team':    { module: 'productivity', description: 'View team productivity' },
  'productivity.view.all':     { module: 'productivity', description: 'View organisation-wide productivity' },

  // Expenses
  'expense.create':            { module: 'expense',      description: 'Submit expense claims' },
  'expense.view.own':          { module: 'expense',      description: 'View own claims' },
  'expense.view.team':         { module: 'expense',      description: 'View claims from reports / managed projects' },
  'expense.view.all':          { module: 'expense',      description: 'View all claims' },
  'expense.approve.manager':   { module: 'expense',      description: 'Approve, reject or return at the manager stage' },
  'expense.approve.finance':   { module: 'expense',      description: 'Approve, reject or return at the finance stage' },
  'expense.mark_paid':         { module: 'expense',      description: 'Record reimbursement payment' },
  'expense.edit_approved':     { module: 'expense',      description: 'Amend a claim after approval (restricted)' },

  // Reports
  'report.view.own':           { module: 'report',       description: 'Run reports scoped to self' },
  'report.view.team':          { module: 'report',       description: 'Run reports scoped to team/projects' },
  'report.view.all':           { module: 'report',       description: 'Run organisation-wide reports' },
  'report.export':             { module: 'report',       description: 'Export reports to CSV/PDF' },

  // Administration
  'settings.view':             { module: 'settings',     description: 'View configuration' },
  'settings.manage':           { module: 'settings',     description: 'Change configuration' },
  'rbac.manage':               { module: 'settings',     description: 'Manage roles and permissions' },
  'audit.view':                { module: 'settings',     description: 'Read the audit log' },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLE_KEYS = ['super_admin', 'ops_manager', 'finance_manager', 'employee'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  super_admin:     'Super Admin',
  ops_manager:     'Operations / Project Manager',
  finance_manager: 'Finance / Accounts Manager',
  employee:        'Employee / Field Staff',
};

const OPS_MANAGER: PermissionKey[] = [
  'dashboard.view',
  'employee.view.own', 'employee.view.team',
  'project.view.assigned', 'project.view.managed', 'project.create', 'project.update', 'project.assign_members',
  'work.view.own', 'work.view.team', 'work.create', 'work.update', 'work.cancel', 'work.review',
  'work.acknowledge', 'work.progress',
  'time.log', 'time.verify', 'attendance.record',
  'productivity.view.own', 'productivity.view.team',
  'expense.create', 'expense.view.own', 'expense.view.team', 'expense.approve.manager',
  'report.view.own', 'report.view.team', 'report.export',
  'settings.view',
];

const FINANCE_MANAGER: PermissionKey[] = [
  'dashboard.view',
  'employee.view.own', 'employee.view.all',
  'project.view.all',
  'expense.create', 'expense.view.own', 'expense.view.all',
  'expense.approve.finance', 'expense.mark_paid',
  'productivity.view.all',
  'report.view.own', 'report.view.all', 'report.export',
  'settings.view',
  'audit.view',
];

const EMPLOYEE: PermissionKey[] = [
  'employee.view.own',
  'project.view.assigned',
  'work.view.own', 'work.acknowledge', 'work.progress',
  'time.log', 'attendance.record',
  'productivity.view.own',
  'expense.create', 'expense.view.own',
  'report.view.own',
];

export const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  super_admin:     ALL_PERMISSIONS,
  ops_manager:     OPS_MANAGER,
  finance_manager: FINANCE_MANAGER,
  employee:        EMPLOYEE,
};

/** Widest data scope the caller holds for a module. */
export type DataScope = 'none' | 'own' | 'team' | 'all';

export function resolveScope(
  held: readonly string[],
  base: 'employee.view' | 'project.view' | 'work.view' | 'productivity.view' | 'expense.view' | 'report.view',
): DataScope {
  const has = (s: string) => held.includes(`${base}.${s}`);
  if (has('all')) return 'all';
  if (has('team') || has('managed')) return 'team';
  if (has('own') || has('assigned')) return 'own';
  return 'none';
}
