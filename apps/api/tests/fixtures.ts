/**
 * Minimal, explicit fixture: four principals, one project, one category.
 * Each test file builds on exactly what it needs, so a failure points at
 * one rule rather than at a large shared dataset.
 */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import { one, query } from '../src/lib/db.js';
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_PERMISSIONS, type RoleKey } from '@adisys/shared';

export const PASSWORD = 'Test@Passw0rd';

export interface Fixture {
  roles: Record<RoleKey, string>;
  admin: string; manager: string; finance: string; employee: string; other: string;
  project: string; otherProject: string;
  categoryPurchase: string; categoryFood: string; categoryConveyance: string;
}

export async function resetDatabase() {
  await query(`TRUNCATE
    reimbursement_items, reimbursement_batches, expense_approvals, expense_attachments,
    expense_claims, expense_policies, expense_categories,
    work_assignment_attachments, work_assignment_events, assignment_acknowledgements,
    time_entries, attendance_sessions, work_assignments, project_members, projects,
    project_types, work_types, notification_outbox, notifications, notification_preferences,
    push_devices, audit_logs, settings, code_counters, files, password_reset_tokens,
    login_attempts, auth_sessions, user_permission_overrides, users, departments,
    designations, work_locations, role_permissions, permissions, roles, app_enum
    RESTART IDENTITY CASCADE`);
}

export async function seedFixture(): Promise<Fixture> {
  await resetDatabase();

  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await query(`INSERT INTO permissions (key, module, description) VALUES ($1,$2,$3)`,
      [key, meta.module, meta.description]);
  }

  const roles = {} as Record<RoleKey, string>;
  for (const key of ['super_admin', 'ops_manager', 'finance_manager', 'employee'] as RoleKey[]) {
    const row = await one<{ id: string }>(
      `INSERT INTO roles (key, name, is_system) VALUES ($1,$2,true) RETURNING id`, [key, key]);
    roles[key] = row!.id;
    for (const perm of ROLE_PERMISSIONS[key]) {
      await query(`INSERT INTO role_permissions (role_id, permission_id)
                   SELECT $1, id FROM permissions WHERE key = $2 ON CONFLICT DO NOTHING`,
        [row!.id, perm]);
    }
  }

  const hash = await bcrypt.hash(PASSWORD, 4);
  let seq = 0;
  const addUser = async (name: string, roleKey: RoleKey, managerId?: string) => {
    seq += 1;
    const row = await one<{ id: string }>(
      `INSERT INTO users (employee_code, full_name, email, phone, password_hash, must_change_password,
                          role_id, reporting_manager_id, status)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7,'active') RETURNING id`,
      [`T-${String(seq).padStart(4, '0')}`, name,
       `${name.toLowerCase().replace(/\s+/g, '.')}@test.adisystech.com`,
       `9${String(800000000 + seq)}`, hash, roles[roleKey], managerId ?? null]);
    return row!.id;
  };

  const admin    = await addUser('Test Admin', 'super_admin');
  const manager  = await addUser('Test Manager', 'ops_manager', admin);
  const finance  = await addUser('Test Finance', 'finance_manager', admin);
  const employee = await addUser('Test Employee', 'employee', manager);
  const other    = await addUser('Other Employee', 'employee', manager);

  const addProject = async (name: string, managerId: string) => {
    const code = (await one<{ c: string }>(`SELECT next_code('project','PRJ') AS c`))!.c;
    const row = await one<{ id: string }>(
      `INSERT INTO projects (project_code, name, client_name, manager_id, start_date, status, created_by)
       VALUES ($1,$2,'Test Client',$3, CURRENT_DATE - 10, 'active', $4) RETURNING id`,
      [code, name, managerId, admin]);
    return row!.id;
  };

  const project = await addProject('Test Project', manager);
  const otherProject = await addProject('Unrelated Project', admin);

  await query(`INSERT INTO project_members (project_id, user_id, assigned_by) VALUES ($1,$2,$3)`,
    [project, employee, manager]);
  await query(`INSERT INTO project_members (project_id, user_id, assigned_by) VALUES ($1,$2,$3)`,
    [project, other, manager]);

  const addCategory = async (key: string, name: string, opts: Partial<{
    receipt: boolean; projectRequired: boolean; daily: number | null; max: number | null;
  }> = {}) => {
    const row = await one<{ id: string }>(
      `INSERT INTO expense_categories (key, name, receipt_required, project_required, daily_limit, max_amount_per_claim)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [key, name, opts.receipt ?? false, opts.projectRequired ?? true,
       opts.daily ?? null, opts.max ?? null]);
    return row!.id;
  };

  const categoryPurchase   = await addCategory('purchase_bills', 'Purchase Bills', { max: 50000 });
  const categoryFood       = await addCategory('food', 'Food Allowance', { daily: 600, max: 1200 });
  const categoryConveyance = await addCategory('local_conveyance', 'Local Conveyance', { max: 1500 });

  // Routing: conveyance under ₹250 clears itself; everything else needs both stages.
  await query(
    `INSERT INTO expense_policies (name, category_id, min_amount, max_amount,
                                   requires_manager, requires_finance, auto_approve_below, priority)
     VALUES ('Small conveyance', $1, 0, 250, false, false, 250, 200)`, [categoryConveyance]);
  await query(
    `INSERT INTO expense_policies (name, min_amount, requires_manager, requires_finance, priority)
     VALUES ('Standard', 0, true, true, 100)`);

  await query(
    `INSERT INTO settings (scope, key, value) VALUES
       ('expense','rules', $1),
       ('productivity','rules', $2),
       ('productivity','location_policy', $3)`,
    [
      JSON.stringify({ backdatedClaimWindowDays: 45, duplicateDetectionEnabled: true, ocrEnabled: true }),
      JSON.stringify({ allowBackdatedEntryDays: 3, maxTimerHoursPerDay: 14, autoStopTimerAfterHours: 12 }),
      JSON.stringify({ checkInLocationEnabled: true, requireExplicitConsent: true }),
    ]);

  return {
    roles, admin, manager, finance, employee, other,
    project, otherProject, categoryPurchase, categoryFood, categoryConveyance,
  };
}

/** Signs in and returns an Authorization header value. */
export async function tokenFor(app: Express, userId: string): Promise<string> {
  const user = await one<{ employee_code: string }>(
    `SELECT employee_code FROM users WHERE id = $1`, [userId]);
  const res = await request(app).post('/api/auth/login')
    .send({ identifier: user!.employee_code, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed for ${userId}: ${JSON.stringify(res.body)}`);
  return `Bearer ${res.body.accessToken}`;
}

/** A one-pixel PNG, used wherever a test needs a real, valid upload. */
export const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
