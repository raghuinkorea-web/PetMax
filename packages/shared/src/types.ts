/** ADISYS FieldOps — API payload contracts shared by the server and both clients. */
import type { PermissionKey, RoleKey } from './permissions.js';
import type {
  WorkStatus, ExpenseStatus, ProjectStatus, Priority, EmployeeStatus, TimeVerification,
} from './domain.js';

export interface ApiError {
  error: { code: string; message: string; details?: Record<string, string[]>; requestId?: string };
}
export interface Paginated<T> {
  data: T[];
  page: { number: number; size: number; total: number; totalPages: number };
}

export interface AuthUser {
  /** `email` is optional: staff may be identified by employee code and mobile only. */
  id: string; employeeCode: string; fullName: string; email: string | null; phone: string;
  roleKey: RoleKey; roleName: string; permissions: PermissionKey[];
  departmentName: string | null; designationName: string | null;
  avatarFileId: string | null; mustChangePassword: boolean;
  reportingManagerId: string | null; locationConsentAt: string | null;
}
export interface LoginResponse { accessToken: string; expiresIn: number; user: AuthUser }

export interface EmployeeSummary {
  id: string; employeeCode: string; fullName: string; email: string | null; phone: string;
  avatarFileId: string | null; roleKey: RoleKey; roleName: string;
  departmentName: string | null; designationName: string | null; baseLocationName: string | null;
  reportingManagerId: string | null; reportingManagerName: string | null;
  dateOfJoining: string | null; status: EmployeeStatus; lastLoginAt: string | null;
  activeProjectCount: number; openAssignmentCount: number; onDuty: boolean;
}

export interface ProjectSummary {
  id: string; projectCode: string; name: string; clientName: string; clientLocation: string | null;
  status: ProjectStatus; priority: Priority; managerId: string; managerName: string;
  startDate: string; expectedEndDate: string | null; actualEndDate: string | null;
  memberCount: number; assignmentCount: number; completedCount: number; completionPct: number;
  recordedMinutes: number; verifiedMinutes: number;
  approvedExpense: number; pendingExpense: number;
  budgetEnabled: boolean; budgetAmount: number | null; currency: string;
}

export interface AssignmentSummary {
  id: string; assignmentCode: string; title: string; description: string | null;
  projectId: string; projectName: string; projectCode: string;
  assigneeId: string; assigneeName: string;
  status: WorkStatus; priority: Priority; version: number; progressPct: number;
  assignmentDate: string; dueDate: string;
  plannedStartAt: string | null; plannedEndAt: string | null;
  estimatedHours: number | null; locationText: string | null;
  workTypeName: string | null; instructions: string | null;
  assignedByName: string;
  acknowledgement: {
    isCurrent: boolean; decision: 'acknowledged' | 'clarification_requested' | 'declined' | null;
    acknowledgedAt: string | null; acknowledgedVersion: number | null; changedSinceAck: boolean;
  };
  recordedMinutes: number; isOverdue: boolean; timerRunning: boolean;
}

export interface ExpenseClaimSummary {
  id: string; expenseCode: string; expenseDate: string;
  userId: string; employeeName: string; employeeCode: string;
  projectId: string | null; projectName: string | null;
  categoryId: string; categoryKey: string; categoryName: string; subcategoryName: string | null;
  amount: number; currency: string; description: string;
  vendorName: string | null; invoiceNumber: string | null;
  status: ExpenseStatus; currentStage: 'manager' | 'finance' | null;
  submittedAt: string | null; decidedAt: string | null; rejectionReason: string | null;
  attachmentCount: number; receiptFileId: string | null;
  possibleDuplicateOf: string | null;
}

export interface ExpenseCategoryNode {
  id: string; key: string; name: string; icon: string | null;
  receiptRequired: boolean; projectRequired: boolean;
  maxAmountPerClaim: number | null; dailyLimit: number | null;
  formVariant: 'standard' | 'fuel' | 'food' | 'purchase';
  children: ExpenseCategoryNode[];
}

export interface ApprovalTrailEntry {
  id: number; stage: 'employee' | 'manager' | 'finance' | 'system';
  actorId: string | null; actorName: string | null; action: string;
  fromStatus: string | null; toStatus: string; comment: string | null; actedAt: string;
}

export interface ProductivityDay {
  workDate: string;
  attendanceMinutes: number;
  recordedMinutes: number;
  verifiedMinutes: number;
  unassignedMinutes: number;
  assignmentsDue: number;
  assignmentsCompleted: number;
}

export interface ProductivitySummary {
  userId: string; employeeName: string; employeeCode: string; departmentName: string | null;
  attendanceMinutes: number; recordedMinutes: number; verifiedMinutes: number; unassignedMinutes: number;
  estimatedMinutes: number;
  assignmentsIssued: number; assignmentsAcknowledged: number;
  assignmentsCompleted: number; assignmentsOverdue: number;
  acknowledgementRate: number; completionRate: number;
}

export interface DashboardKpis {
  totalEmployees: number; activeEmployees: number; onDutyNow: number;
  activeProjects: number;
  workAssignedToday: number; workCompletedToday: number; pendingAcknowledgements: number;
  overdueAssignments: number;
  verifiedMinutesToday: number; recordedMinutesToday: number;
  expensesThisMonth: number; pendingExpenseApprovals: number;
  pendingExpenseAmount: number; totalProjectExpense: number;
}

export interface NotificationItem {
  id: string; type: string; title: string; body: string;
  entityType: string | null; entityId: string | null;
  severity: 'info' | 'success' | 'warning' | 'critical';
  readAt: string | null; createdAt: string;
}

export interface TimerState {
  running: boolean; entryId: string | null;
  assignmentId: string | null; assignmentTitle: string | null;
  projectId: string | null; projectName: string | null;
  startedAt: string | null; elapsedMinutesToday: number;
}

export interface AttendanceState {
  onDuty: boolean; sessionId: string | null;
  checkInAt: string | null; workDate: string | null; attendanceMinutesToday: number;
}

export type { PermissionKey, RoleKey, WorkStatus, ExpenseStatus, ProjectStatus, Priority, EmployeeStatus, TimeVerification };
