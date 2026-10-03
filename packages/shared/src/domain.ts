/**
 * ADISYS FieldOps — shared domain vocabulary.
 * Status values, their human labels and their semantic tone are declared
 * ONCE here so a status always looks and reads the same in the admin
 * portal, the employee app and every exported report.
 */

export type Tone = 'neutral' | 'info' | 'progress' | 'warning' | 'success' | 'danger';

export interface StatusMeta<T extends string> { value: T; label: string; tone: Tone; description: string }

const meta = <T extends string>(list: StatusMeta<T>[]) => {
  const byValue = Object.fromEntries(list.map((s) => [s.value, s])) as Record<T, StatusMeta<T>>;
  return { list, byValue, values: list.map((s) => s.value) as T[] };
};

// ---------------------------------------------------------------------
// Work assignments
// ---------------------------------------------------------------------
export type WorkStatus =
  | 'assigned' | 'acknowledged' | 'in_progress' | 'on_hold'
  | 'submitted' | 'completed' | 'clarification_requested' | 'cancelled';

export const WORK_STATUS = meta<WorkStatus>([
  { value: 'assigned',                label: 'Acknowledgement pending', tone: 'warning',  description: 'Sent to the employee, not yet acknowledged' },
  { value: 'acknowledged',            label: 'Acknowledged',            tone: 'info',     description: 'Employee has received and reviewed the assignment' },
  { value: 'in_progress',             label: 'In progress',             tone: 'progress', description: 'Work has started' },
  { value: 'on_hold',                 label: 'On hold',                 tone: 'neutral',  description: 'Paused by the employee or the manager' },
  { value: 'submitted',               label: 'Awaiting review',         tone: 'progress', description: 'Employee has submitted completion for review' },
  { value: 'completed',               label: 'Completed',               tone: 'success',  description: 'Manager has accepted the completed work' },
  { value: 'clarification_requested', label: 'Needs clarification',     tone: 'danger',   description: 'Returned to the employee with questions' },
  { value: 'cancelled',               label: 'Cancelled',               tone: 'neutral',  description: 'Withdrawn before completion' },
]);

/** Permitted status transitions. Enforced by the API, never by the UI alone. */
export const WORK_TRANSITIONS: Record<WorkStatus, WorkStatus[]> = {
  assigned:                ['acknowledged', 'clarification_requested', 'cancelled'],
  acknowledged:            ['in_progress', 'clarification_requested', 'cancelled'],
  in_progress:             ['on_hold', 'submitted', 'cancelled'],
  on_hold:                 ['in_progress', 'cancelled'],
  submitted:               ['completed', 'clarification_requested'],
  clarification_requested: ['acknowledged', 'in_progress', 'cancelled'],
  completed:               [],
  cancelled:               [],
};

// ---------------------------------------------------------------------
// Expense claims
// ---------------------------------------------------------------------
export type ExpenseStatus =
  | 'draft' | 'submitted' | 'under_review' | 'returned'
  | 'approved' | 'rejected' | 'reimbursement_pending' | 'paid' | 'cancelled';

export const EXPENSE_STATUS = meta<ExpenseStatus>([
  { value: 'draft',                 label: 'Draft',            tone: 'neutral',  description: 'Saved but not submitted' },
  { value: 'submitted',             label: 'Submitted',        tone: 'info',     description: 'Awaiting first review' },
  { value: 'under_review',          label: 'Under review',     tone: 'progress', description: 'An approver has opened the claim' },
  { value: 'returned',              label: 'Returned',         tone: 'warning',  description: 'Sent back for correction; history is preserved' },
  { value: 'approved',              label: 'Approved',         tone: 'success',  description: 'Cleared all required approval stages' },
  { value: 'rejected',              label: 'Rejected',         tone: 'danger',   description: 'Declined with a recorded reason' },
  { value: 'reimbursement_pending', label: 'Awaiting payment', tone: 'progress', description: 'Approved and queued for reimbursement' },
  { value: 'paid',                  label: 'Reimbursed',       tone: 'success',  description: 'Payment recorded' },
  { value: 'cancelled',             label: 'Cancelled',        tone: 'neutral',  description: 'Withdrawn by the employee' },
]);

export const EXPENSE_TRANSITIONS: Record<ExpenseStatus, ExpenseStatus[]> = {
  draft:                 ['submitted', 'cancelled'],
  submitted:             ['under_review', 'approved', 'rejected', 'returned', 'cancelled'],
  under_review:          ['approved', 'rejected', 'returned'],
  returned:              ['submitted', 'cancelled'],
  approved:              ['reimbursement_pending', 'paid'],
  reimbursement_pending: ['paid'],
  rejected:              [],
  paid:                  [],
  cancelled:             [],
};

/** Statuses an employee may still edit. */
export const EMPLOYEE_EDITABLE_EXPENSE_STATUSES: ExpenseStatus[] = ['draft', 'returned'];

// ---------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------
export type ProjectStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export const PROJECT_STATUS = meta<ProjectStatus>([
  { value: 'draft',     label: 'Draft',     tone: 'neutral',  description: 'Being set up; not visible to field staff' },
  { value: 'active',    label: 'Active',    tone: 'success',  description: 'Live; work can be assigned' },
  { value: 'on_hold',   label: 'On hold',   tone: 'warning',  description: 'Temporarily paused' },
  { value: 'completed', label: 'Completed', tone: 'info',     description: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled', tone: 'neutral',  description: 'Closed without delivery' },
]);

export type Priority = 'low' | 'medium' | 'high' | 'critical';
export const PRIORITY = meta<Priority>([
  { value: 'low',      label: 'Low',      tone: 'neutral',  description: 'Can slip without impact' },
  { value: 'medium',   label: 'Medium',   tone: 'info',     description: 'Normal scheduling' },
  { value: 'high',     label: 'High',     tone: 'warning',  description: 'Needs attention today' },
  { value: 'critical', label: 'Critical', tone: 'danger',   description: 'Blocking; escalate immediately' },
]);

export type EmployeeStatus = 'invited' | 'active' | 'inactive' | 'suspended';
export const EMPLOYEE_STATUS = meta<EmployeeStatus>([
  { value: 'invited',   label: 'Invited',   tone: 'info',    description: 'Credentials issued, first login pending' },
  { value: 'active',    label: 'Active',    tone: 'success', description: 'Can sign in and receive work' },
  { value: 'inactive',  label: 'Inactive',  tone: 'neutral', description: 'No longer receives work; history retained' },
  { value: 'suspended', label: 'Suspended', tone: 'danger',  description: 'Access blocked by an administrator' },
]);

// ---------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const LEAVE_STATUS = meta<LeaveStatus>([
  { value: 'pending',   label: 'Pending',   tone: 'warning', description: 'Applied for; awaiting a manager decision' },
  { value: 'approved',  label: 'Approved',  tone: 'success', description: 'Entitled absence; the employee is On Leave on these dates' },
  { value: 'rejected',  label: 'Rejected',  tone: 'danger',  description: 'Declined with a recorded reason' },
  { value: 'cancelled', label: 'Cancelled', tone: 'neutral', description: 'Withdrawn by the employee before a decision' },
]);

export const LEAVE_TRANSITIONS: Record<LeaveStatus, LeaveStatus[]> = {
  pending:   ['approved', 'rejected', 'cancelled'],
  approved:  [],
  rejected:  [],
  cancelled: [],
};

export type TimeVerification = 'unverified' | 'verified' | 'rejected';
export const TIME_VERIFICATION = meta<TimeVerification>([
  { value: 'unverified', label: 'Recorded',  tone: 'info',    description: 'Logged by the employee, not yet verified' },
  { value: 'verified',   label: 'Verified',  tone: 'success', description: 'Confirmed by a manager as productive time' },
  { value: 'rejected',   label: 'Discounted',tone: 'danger',  description: 'Excluded from productivity figures' },
]);

// ---------------------------------------------------------------------
// Metric definitions — shown as tooltips so every number is explainable.
// ---------------------------------------------------------------------
export const METRIC_DEFINITIONS: Record<string, string> = {
  attendance_hours:
    'Time between check-in and check-out. Measures availability on duty. NOT productivity.',
  recorded_hours:
    'Time the employee logged against a specific work assignment, excluding entries a manager discounted.',
  verified_hours:
    'Recorded hours a manager has explicitly verified. This is the only figure ADISYS reports as productive hours.',
  unassigned_hours:
    'Logged time not linked to any assignment. Reported separately and never counted as productive.',
  task_completion_rate:
    'Assignments accepted as completed by a manager, divided by assignments due in the period.',
  acknowledgement_rate:
    'Assignments acknowledged at their current version, divided by assignments issued in the period.',
  plan_vs_actual:
    'Estimated hours on the assignment compared with recorded hours logged against it.',
  approved_expense:
    'Sum of claims in Approved, Awaiting payment or Reimbursed status. Each claim is counted once.',
  pending_expense:
    'Sum of claims in Submitted or Under review status. Each claim is counted once.',
  budget_utilisation:
    'Approved project expense divided by the configured project budget. Shown only when a budget is set.',
  leave_days:
    'Calendar days covered by an approved leave request, counting both the first and last day. '
    + 'An approved leave day is an entitled absence: it is not on-duty time and is never counted as an absence.',
};
