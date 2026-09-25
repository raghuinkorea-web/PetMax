import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query, tx, SqlBuilder } from '../lib/db.js';
import { asyncHandler, dateString, offsetOf, pageMeta, paginationSchema, parse, uuid } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { can, principalOf, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { storeFile } from '../services/storage.js';
import { assertUserVisible, scopeFor, userScopeClause } from '../services/scope.js';

export const employeeRouter = Router();

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.storage.maxUploadBytes, files: 1 },
});

const SELECT_EMPLOYEE = `
  SELECT u.id, u.employee_code AS "employeeCode", u.full_name AS "fullName",
         u.email, u.phone, u.avatar_file_id AS "avatarFileId",
         r.key AS "roleKey", r.name AS "roleName", u.role_id AS "roleId",
         u.department_id AS "departmentId", d.name AS "departmentName",
         u.designation_id AS "designationId", dg.name AS "designationName",
         u.base_location_id AS "baseLocationId", wl.name AS "baseLocationName",
         u.reporting_manager_id AS "reportingManagerId", m.full_name AS "reportingManagerName",
         u.date_of_joining AS "dateOfJoining", u.status, u.last_login_at AS "lastLoginAt",
         u.created_at AS "createdAt",
         (SELECT COUNT(*)::int FROM project_members pm
           WHERE pm.user_id = u.id AND pm.removed_at IS NULL) AS "activeProjectCount",
         (SELECT COUNT(*)::int FROM work_assignments wa
           WHERE wa.assignee_id = u.id AND wa.deleted_at IS NULL
             AND wa.status NOT IN ('completed','cancelled')) AS "openAssignmentCount",
         (SELECT COUNT(*)::int FROM work_assignments wa
           WHERE wa.assignee_id = u.id AND wa.deleted_at IS NULL AND wa.status = 'assigned') AS "pendingAckCount",
         EXISTS (SELECT 1 FROM attendance_sessions a
                  WHERE a.user_id = u.id AND a.check_out_at IS NULL) AS "onDuty",
         EXISTS (SELECT 1 FROM time_entries t
                  WHERE t.user_id = u.id AND t.ended_at IS NULL) AS "timerRunning"
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN departments  d  ON d.id  = u.department_id
    LEFT JOIN designations dg ON dg.id = u.designation_id
    LEFT JOIN work_locations wl ON wl.id = u.base_location_id
    LEFT JOIN users m ON m.id = u.reporting_manager_id`;

employeeRouter.get('/', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  if (scopeFor(p, 'employee.view') === 'none') throw forbidden('You cannot view the employee directory.');

  const f = parse(paginationSchema.extend({
    search: z.string().trim().max(120).optional(),
    status: z.string().optional(),
    departmentId: uuid.optional(),
    roleId: uuid.optional(),
    projectId: uuid.optional(),
    managerId: uuid.optional(),
    sort: z.enum(['full_name', 'employee_code', 'date_of_joining', 'last_login_at']).default('full_name'),
    dir: z.enum(['asc', 'desc']).default('asc'),
  }), req.query);

  const b = new SqlBuilder();
  b.add('u.deleted_at IS NULL');
  const scope = userScopeClause(p, 'u.id', 1, 'employee.view');
  b.add(scope.sql.replace(/\$\d+/g, '$?'), ...scope.params);
  b.addIf(f.status, 'u.status = ANY($?)', f.status?.split(','));
  b.addIf(f.departmentId, 'u.department_id = $?', f.departmentId);
  b.addIf(f.roleId, 'u.role_id = $?', f.roleId);
  b.addIf(f.managerId, 'u.reporting_manager_id = $?', f.managerId);
  b.addIf(f.projectId, `u.id IN (SELECT user_id FROM project_members
                                 WHERE project_id = $? AND removed_at IS NULL)`, f.projectId);
  b.addIf(f.search, `(u.full_name ILIKE $? OR u.employee_code ILIKE $? OR u.email ILIKE $? OR u.phone ILIKE $?)`,
    ...Array(4).fill(`%${f.search}%`));

  const rows = await query(
    `${SELECT_EMPLOYEE} ${b.where}
      ORDER BY u.${f.sort} ${f.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST
      LIMIT $${b.next} OFFSET $${b.next + 1}`,
    [...b.params, f.size, offsetOf(f.page, f.size)]);

  const total = await one<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM users u ${b.where}`, b.params);
  res.json({ data: rows, page: pageMeta(f.page, f.size, total?.count ?? 0) });
}));

employeeRouter.get('/:id', asyncHandler(async (req, res) => {
  await assertUserVisible(req, req.params.id);
  const employee = await one(`${SELECT_EMPLOYEE} WHERE u.id = $1 AND u.deleted_at IS NULL`, [req.params.id]);
  if (!employee) throw notFound('Employee');

  const [projects, productivity, expenses, recentWork] = await Promise.all([
    query(`SELECT pm.project_id AS "projectId", pr.name, pr.project_code AS "projectCode",
                  pr.status, pm.role_in_project AS "roleInProject", pm.allocation_pct AS "allocationPct",
                  pm.assigned_at AS "assignedAt"
             FROM project_members pm JOIN projects pr ON pr.id = pm.project_id
            WHERE pm.user_id = $1 AND pm.removed_at IS NULL AND pr.deleted_at IS NULL
            ORDER BY pr.name`, [req.params.id]),
    one(`SELECT
            COALESCE(SUM(t.duration_minutes) FILTER (WHERE t.verification_status <> 'rejected'),0)::int AS "recordedMinutes",
            COALESCE(SUM(t.duration_minutes) FILTER (WHERE t.verification_status = 'verified'),0)::int AS "verifiedMinutes",
            COALESCE(SUM(t.duration_minutes) FILTER (WHERE t.assignment_id IS NULL
                     AND t.verification_status <> 'rejected'),0)::int AS "unassignedMinutes"
           FROM time_entries t
          WHERE t.user_id = $1 AND t.ended_at IS NOT NULL AND t.work_date >= CURRENT_DATE - 30`, [req.params.id]),
    one(`SELECT COUNT(*)::int AS count,
                COALESCE(SUM(amount) FILTER (WHERE status IN ('approved','reimbursement_pending','paid')),0) AS approved,
                COALESCE(SUM(amount) FILTER (WHERE status IN ('submitted','under_review')),0) AS pending
           FROM expense_claims WHERE user_id = $1 AND deleted_at IS NULL
             AND expense_date >= CURRENT_DATE - 90`, [req.params.id]),
    query(`SELECT wa.id, wa.assignment_code AS "assignmentCode", wa.title, wa.status,
                  wa.assignment_date AS "assignmentDate", wa.due_date AS "dueDate",
                  pr.name AS "projectName"
             FROM work_assignments wa JOIN projects pr ON pr.id = wa.project_id
            WHERE wa.assignee_id = $1 AND wa.deleted_at IS NULL
            ORDER BY wa.assignment_date DESC LIMIT 15`, [req.params.id]),
  ]);

  res.json({ employee, projects, productivity30d: productivity, expenses90d: expenses, recentWork });
}));

// ---------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------
const employeeSchema = z.object({
  employeeCode: z.string().trim().regex(/^[A-Za-z0-9-]{3,20}$/, 'Use 3–20 letters, digits or hyphens').optional(),
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  // Optional: not every employee record carries an address. An empty string
  // from a form is normalised to null rather than stored, so the unique index
  // on lower(email) never sees two blanks.
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().email('Enter a valid email address').max(180).nullish()),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
  roleId: uuid,
  departmentId: uuid.optional(),
  designationId: uuid.optional(),
  baseLocationId: uuid.optional(),
  reportingManagerId: uuid.optional(),
  dateOfJoining: dateString.optional(),
  status: z.enum(['invited', 'active', 'inactive', 'suspended']).default('invited'),
});

employeeRouter.post('/', requirePermission('employee.create'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(employeeSchema, req.body);

  const role = await one<{ key: string }>(`SELECT key FROM roles WHERE id = $1`, [body.roleId]);
  if (!role) throw badRequest('Choose a valid role.', { roleId: ['Unknown role'] });
  // Only a Super Admin can mint another Super Admin.
  if (role.key === 'super_admin' && p.roleKey !== 'super_admin') {
    throw forbidden('Only a Super Admin can create another Super Admin.');
  }
  if (body.reportingManagerId) {
    const mgr = await one<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND status <> 'suspended'`,
      [body.reportingManagerId]);
    if (!mgr) throw badRequest('Choose a valid reporting manager.', { reportingManagerId: ['Unknown manager'] });
  }

  // A one-time password is issued and must be changed at first sign-in.
  const temporaryPassword = `Adi${randomBytes(4).toString('hex').toUpperCase()}@${new Date().getFullYear()}`;

  const created = await tx(async (client) => {
    const code = body.employeeCode
      ?? (await one<{ c: string }>(`SELECT next_code('employee','ADI') AS c`, [], client))!.c;
    const row = await one<{ id: string }>(
      `INSERT INTO users (employee_code, full_name, email, phone, password_hash, must_change_password,
                          role_id, department_id, designation_id, base_location_id, reporting_manager_id,
                          date_of_joining, status, created_by)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [code, body.fullName, body.email, body.phone,
       await bcrypt.hash(temporaryPassword, config.bcryptRounds), body.roleId,
       body.departmentId ?? null, body.designationId ?? null, body.baseLocationId ?? null,
       body.reportingManagerId ?? null, body.dateOfJoining ?? null, body.status, p.id], client);
    return { id: row!.id, employeeCode: code };
  });

  await recordAudit(req, { action: 'employee.created', entityType: 'user', entityId: created.id,
    after: { ...body, employeeCode: created.employeeCode } });

  res.status(201).json({
    ...created,
    temporaryPassword,
    message: 'Employee created. Share the temporary password over a secure channel — ' +
             'they will be required to change it at first sign-in.',
  });
}));

// The optional associations accept null as well as being absent: absent means
// "leave alone", null means "clear it". Without that an edit form has no way to
// remove a department or a reporting manager once one has been set.
const employeePatchSchema = employeeSchema.partial().omit({ employeeCode: true }).extend({
  departmentId: uuid.nullish(),
  designationId: uuid.nullish(),
  baseLocationId: uuid.nullish(),
  reportingManagerId: uuid.nullish(),
  dateOfJoining: dateString.nullish(),
});

employeeRouter.patch('/:id', requirePermission('employee.update'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(employeePatchSchema, req.body);

  const before = await one<any>(
    `SELECT u.*, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1 AND u.deleted_at IS NULL`, [req.params.id]);
  if (!before) throw notFound('Employee');
  if (before.role_key === 'super_admin' && p.roleKey !== 'super_admin') {
    throw forbidden('Only a Super Admin can edit a Super Admin.');
  }
  if (body.reportingManagerId === req.params.id) {
    throw badRequest('An employee cannot report to themselves.', { reportingManagerId: ['Invalid manager'] });
  }
  // Guard against a reporting cycle.
  if (body.reportingManagerId) {
    const cycle = await one<{ id: string }>(
      `WITH RECURSIVE chain AS (
         SELECT id, reporting_manager_id FROM users WHERE id = $1
         UNION SELECT u.id, u.reporting_manager_id FROM users u JOIN chain c ON u.id = c.reporting_manager_id
       ) SELECT id FROM chain WHERE id = $2`, [body.reportingManagerId, req.params.id]);
    if (cycle) throw badRequest('That would create a loop in the reporting line.',
      { reportingManagerId: ['Creates a reporting cycle'] });
  }

  const columns: Record<string, string> = {
    fullName: 'full_name', email: 'email', phone: 'phone', roleId: 'role_id',
    departmentId: 'department_id', designationId: 'designation_id',
    baseLocationId: 'base_location_id', reportingManagerId: 'reporting_manager_id',
    dateOfJoining: 'date_of_joining', status: 'status',
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || !columns[k]) continue;
    params.push(v); sets.push(`${columns[k]} = $${params.length}`); changed[k] = v;
  }
  if (!sets.length) return res.json({ ok: true, changed: {} });

  params.push(req.params.id);
  await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

  // Deactivating or suspending an account terminates its live sessions.
  if (body.status && ['inactive', 'suspended'].includes(body.status)) {
    await query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [req.params.id]);
  }

  await recordAudit(req, { action: 'employee.updated', entityType: 'user', entityId: req.params.id,
    before: Object.fromEntries(Object.keys(changed).map((k) => [k, before[columns[k]]])), after: changed });
  res.json({ ok: true, changed });
}));

employeeRouter.post('/:id/status', requirePermission('employee.deactivate'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({
    status: z.enum(['active', 'inactive', 'suspended']),
    reason: z.string().trim().max(500).optional(),
  }), req.body);
  if (req.params.id === p.id) throw badRequest('You cannot change your own account status.');

  const before = await one<{ status: string; role_key: string; full_name: string }>(
    `SELECT u.status, r.key AS role_key, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1 AND u.deleted_at IS NULL`, [req.params.id]);
  if (!before) throw notFound('Employee');
  if (before.role_key === 'super_admin' && p.roleKey !== 'super_admin') {
    throw forbidden('Only a Super Admin can change a Super Admin\'s status.');
  }

  // Open work must be dealt with before someone is deactivated.
  if (body.status !== 'active') {
    const open = await one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM work_assignments
        WHERE assignee_id = $1 AND deleted_at IS NULL AND status NOT IN ('completed','cancelled')`,
      [req.params.id]);
    if (open && open.count > 0) {
      throw conflict(
        `${before.full_name} still has ${open.count} open assignment(s). Reassign or cancel them first.`,
        'OPEN_WORK_EXISTS');
    }
  }

  await tx(async (client) => {
    await query(`UPDATE users SET status = $2 WHERE id = $1`, [req.params.id, body.status], client);
    if (body.status !== 'active') {
      await query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [req.params.id], client);
    }
  });

  await recordAudit(req, { action: 'employee.status_changed', entityType: 'user', entityId: req.params.id,
    before: { status: before.status }, after: { status: body.status, reason: body.reason } });
  res.json({ ok: true, status: body.status });
}));

/**
 * Profile photo.
 *
 * Anyone who may edit employees can set another person's photo; everyone may
 * set their own. The image replaces whatever was there: the previous file row
 * is left in place rather than deleted, so an audit entry still resolves and a
 * shared checksum is never pulled out from under another record.
 */
async function assertMayEditAvatar(req: any, targetId: string) {
  const p = principalOf(req);
  if (p.id === targetId) return;
  if (!can(req, 'employee.update')) throw forbidden('You cannot change this employee\'s photo.');
  const target = await one<{ role_key: string }>(
    `SELECT r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1 AND u.deleted_at IS NULL`, [targetId]);
  if (!target) throw notFound('Employee');
  if (target.role_key === 'super_admin' && p.roleKey !== 'super_admin') {
    throw forbidden('Only a Super Admin can edit a Super Admin.');
  }
}

employeeRouter.post('/:id/avatar', uploadAvatar.single('avatar'), asyncHandler(async (req, res) => {
  await assertMayEditAvatar(req, req.params.id);
  const p = principalOf(req);

  const file = req.file as Express.Multer.File | undefined;
  if (!file) throw badRequest('Choose an image to upload.', { avatar: ['No file received'] });

  const stored = await storeFile({
    buffer: file.buffer,
    originalName: file.originalname,
    declaredMime: file.mimetype,
    uploadedBy: p.id,
    purpose: 'avatar',
  });
  // storeFile sniffs the real type from the bytes and also permits PDFs, which
  // are fine as a receipt but not as a face.
  if (!stored.mimeType.startsWith('image/')) {
    throw badRequest('A profile photo must be an image.', { avatar: ['Use a JPG, PNG or WEBP image'] });
  }

  const before = await one<{ avatar_file_id: string | null }>(
    `SELECT avatar_file_id FROM users WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
  if (!before) throw notFound('Employee');

  await query(`UPDATE users SET avatar_file_id = $2 WHERE id = $1`, [req.params.id, stored.id]);
  await recordAudit(req, { action: 'employee.avatar_changed', entityType: 'user', entityId: req.params.id,
    before: { avatarFileId: before.avatar_file_id }, after: { avatarFileId: stored.id } });

  res.status(201).json({ ok: true, avatarFileId: stored.id });
}));

employeeRouter.delete('/:id/avatar', asyncHandler(async (req, res) => {
  await assertMayEditAvatar(req, req.params.id);

  const before = await one<{ avatar_file_id: string | null }>(
    `SELECT avatar_file_id FROM users WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
  if (!before) throw notFound('Employee');
  if (!before.avatar_file_id) return res.json({ ok: true, avatarFileId: null });

  await query(`UPDATE users SET avatar_file_id = NULL WHERE id = $1`, [req.params.id]);
  await recordAudit(req, { action: 'employee.avatar_removed', entityType: 'user', entityId: req.params.id,
    before: { avatarFileId: before.avatar_file_id }, after: { avatarFileId: null } });

  res.json({ ok: true, avatarFileId: null });
}));

/** Issue a fresh temporary password. */
employeeRouter.post('/:id/reset-credentials', requirePermission('employee.update'), asyncHandler(async (req, res) => {
  const temporaryPassword = `Adi${randomBytes(4).toString('hex').toUpperCase()}@${new Date().getFullYear()}`;
  const updated = await one<{ id: string }>(
    `UPDATE users SET password_hash = $2, must_change_password = true,
            failed_login_count = 0, locked_until = NULL
      WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [req.params.id, await bcrypt.hash(temporaryPassword, config.bcryptRounds)]);
  if (!updated) throw notFound('Employee');
  await query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [req.params.id]);
  await recordAudit(req, { action: 'employee.credentials_reset', entityType: 'user', entityId: req.params.id });
  res.json({ temporaryPassword, message: 'Share this over a secure channel. All existing sessions were signed out.' });
}));

/** Per-user permission overrides (least-privilege tuning). */
employeeRouter.get('/:id/permissions', requirePermission('rbac.manage'), asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT p.key, p.module, p.description, o.effect
       FROM permissions p
       LEFT JOIN user_permission_overrides o ON o.permission_id = p.id AND o.user_id = $1
      ORDER BY p.module, p.key`, [req.params.id]);
  const role = await one(
    `SELECT r.key AS "roleKey", r.name AS "roleName" FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1`, [req.params.id]);
  res.json({ role, permissions: rows });
}));

employeeRouter.put('/:id/permissions', requirePermission('rbac.manage'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({
    overrides: z.array(z.object({ key: z.string(), effect: z.enum(['allow', 'deny']) })).max(100),
  }), req.body);
  if (req.params.id === p.id) throw badRequest('You cannot change your own permissions.');

  await tx(async (client) => {
    await query(`DELETE FROM user_permission_overrides WHERE user_id = $1`, [req.params.id], client);
    for (const o of body.overrides) {
      await query(
        `INSERT INTO user_permission_overrides (user_id, permission_id, effect, granted_by)
         SELECT $1, id, $3, $4 FROM permissions WHERE key = $2`,
        [req.params.id, o.key, o.effect, p.id], client);
    }
  });
  await recordAudit(req, { action: 'employee.permissions_changed', entityType: 'user',
    entityId: req.params.id, after: body.overrides });
  res.json({ ok: true, count: body.overrides.length });
}));
