import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../lib/db.js';
import { asyncHandler, offsetOf, pageMeta, paginationSchema, parse, uuid } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';
import { principalOf, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { ROLE_PERMISSIONS, PERMISSIONS } from '@adisys/shared';

export const settingsRouter = Router();

/**
 * Every settings document is validated against a schema here BEFORE it is
 * written. The clients render the form, but they do not decide what is
 * acceptable — these schemas do.
 */
const SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'organization.profile': z.object({
    legalName: z.string().trim().min(2).max(180),
    displayName: z.string().trim().min(2).max(80),
    tagline: z.string().trim().max(120).optional(),
    website: z.string().trim().url().optional(),
    supportEmail: z.string().trim().email().optional(),
    registeredAddress: z.string().trim().max(500).optional(),
    gstin: z.string().trim().max(20).optional(),
    timezone: z.string().trim().max(60),
    currency: z.string().length(3),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
  }),
  'organization.business_hours': z.object({
    workWeek: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).min(1),
    standardStart: z.string().regex(/^\d{2}:\d{2}$/),
    standardEnd: z.string().regex(/^\d{2}:\d{2}$/),
    standardDailyHours: z.number().min(1).max(16),
    halfDays: z.array(z.string()).default([]),
    holidayCalendar: z.string().max(40).optional(),
  }),
  'productivity.rules': z.object({
    timeTrackingMethods: z.object({ timer: z.boolean(), manualEntry: z.boolean(), attendanceCheckIn: z.boolean() }),
    requireManagerVerification: z.boolean(),
    countUnassignedTimeAsProductive: z.boolean(),
    maxTimerHoursPerDay: z.number().min(1).max(24),
    allowBackdatedEntryDays: z.number().int().min(0).max(30),
    overtimeEnabled: z.boolean(),
    autoStopTimerAfterHours: z.number().min(1).max(24),
    productiveHoursDefinition: z.enum(['verified', 'recorded']),
  }),
  'productivity.location_policy': z.object({
    checkInLocationEnabled: z.boolean(),
    requireExplicitConsent: z.boolean(),
    continuousTrackingEnabled: z.literal(false,
      { errorMap: () => ({ message: 'Continuous location tracking is not supported by this platform.' }) }),
    purpose: z.string().trim().min(10).max(400),
    retentionDays: z.number().int().min(1).max(730),
    visibleTo: z.array(z.string()).min(1),
  }),
  'expense.rules': z.object({
    defaultCurrency: z.string().length(3),
    requireProjectOnClaim: z.boolean(),
    maxReceiptSizeMb: z.number().int().min(1).max(50),
    allowedReceiptTypes: z.array(z.string()).min(1),
    backdatedClaimWindowDays: z.number().int().min(1).max(365),
    duplicateDetectionEnabled: z.boolean(),
    ocrEnabled: z.boolean(),
    ocrRequiresEmployeeConfirmation: z.literal(true,
      { errorMap: () => ({ message: 'Extracted values must always be confirmed by the employee.' }) }),
    editableAfterApproval: z.boolean(),
  }),
  'notification.defaults': z.object({
    channels: z.object({ inApp: z.boolean(), push: z.boolean(), email: z.boolean(), whatsapp: z.boolean() }),
    acknowledgementReminderTime: z.string().regex(/^\d{2}:\d{2}$/),
    overdueEscalationHours: z.number().int().min(1).max(168),
    digestEnabled: z.boolean(),
    digestTime: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  'security.policy': z.object({
    passwordMinLength: z.number().int().min(8).max(64),
    passwordRequiresMixedCase: z.boolean(),
    passwordRequiresNumber: z.boolean(),
    maxFailedAttempts: z.number().int().min(3).max(20),
    lockoutMinutes: z.number().int().min(1).max(1440),
    accessTokenMinutes: z.number().int().min(5).max(480),
    refreshTokenDays: z.number().int().min(1).max(365),
    forcePasswordChangeOnFirstLogin: z.boolean(),
    auditRetentionDays: z.number().int().min(30).max(3650),
  }),
};

settingsRouter.get('/', requirePermission('settings.view'), asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT s.scope, s.key, s.value, s.updated_at AS "updatedAt", u.full_name AS "updatedByName"
       FROM settings s LEFT JOIN users u ON u.id = s.updated_by
      ORDER BY s.scope, s.key`);
  res.json({
    data: rows,
    editable: Object.keys(SETTING_SCHEMAS),
  });
}));

// ---------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------
const masterTables: Record<string, { table: string; fields: string[]; label: string }> = {
  departments:    { table: 'departments',    fields: ['code', 'name'], label: 'Department' },
  designations:   { table: 'designations',   fields: ['name', 'grade'], label: 'Designation' },
  'work-locations': { table: 'work_locations', fields: ['code', 'name', 'address_line', 'city', 'state'], label: 'Work location' },
  'project-types': { table: 'project_types', fields: ['name'], label: 'Project type' },
  'work-types':   { table: 'work_types',     fields: ['name'], label: 'Work type' },
};

settingsRouter.post('/master/:resource', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const spec = masterTables[req.params.resource];
  if (!spec) throw notFound('Resource');

  const provided = spec.fields.filter((f) => req.body[toCamel(f)] !== undefined);
  if (!provided.length) throw badRequest(`Provide at least one of: ${spec.fields.map(toCamel).join(', ')}`);

  const row = await one<{ id: string }>(
    `INSERT INTO ${spec.table} (${provided.join(', ')})
     VALUES (${provided.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    provided.map((f) => String(req.body[toCamel(f)]).trim()));

  await recordAudit(req, { action: 'settings.master_created', entityType: spec.table,
    entityId: row!.id, after: req.body });
  res.status(201).json({ id: row!.id });
}));

settingsRouter.patch('/master/:resource/:id', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const spec = masterTables[req.params.resource];
  if (!spec) throw notFound('Resource');

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const f of [...spec.fields, 'active']) {
    const v = req.body[toCamel(f)];
    if (v === undefined) continue;
    params.push(f === 'active' ? Boolean(v) : String(v).trim());
    sets.push(`${f} = $${params.length}`);
  }
  if (!sets.length) throw badRequest('Nothing to update.');

  params.push(req.params.id);
  const row = await one<{ id: string }>(
    `UPDATE ${spec.table} SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`, params);
  if (!row) throw notFound(spec.label);

  await recordAudit(req, { action: 'settings.master_updated', entityType: spec.table,
    entityId: req.params.id, after: req.body });
  res.json({ ok: true });
}));

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());

// ---------------------------------------------------------------------
// Expense categories & policies
// ---------------------------------------------------------------------
settingsRouter.get('/expense/categories', requirePermission('settings.view'), asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT id, parent_id AS "parentId", key, name, icon, receipt_required AS "receiptRequired",
            project_required AS "projectRequired", max_amount_per_claim AS "maxAmountPerClaim",
            daily_limit AS "dailyLimit", form_variant AS "formVariant", sort_order AS "sortOrder", active
       FROM expense_categories ORDER BY sort_order, name`);
  res.json({ data: rows });
}));

settingsRouter.patch('/expense/categories/:id', requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const body = parse(z.object({
      name: z.string().trim().min(2).max(120).optional(),
      receiptRequired: z.boolean().optional(),
      projectRequired: z.boolean().optional(),
      maxAmountPerClaim: z.coerce.number().positive().nullable().optional(),
      dailyLimit: z.coerce.number().positive().nullable().optional(),
      active: z.boolean().optional(),
      sortOrder: z.coerce.number().int().optional(),
    }), req.body);

    const columns: Record<string, string> = {
      name: 'name', receiptRequired: 'receipt_required', projectRequired: 'project_required',
      maxAmountPerClaim: 'max_amount_per_claim', dailyLimit: 'daily_limit',
      active: 'active', sortOrder: 'sort_order',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      params.push(v); sets.push(`${columns[k]} = $${params.length}`);
    }
    if (!sets.length) throw badRequest('Nothing to update.');
    params.push(req.params.id);
    const row = await one<{ id: string }>(
      `UPDATE expense_categories SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`, params);
    if (!row) throw notFound('Expense category');

    await recordAudit(req, { action: 'settings.category_updated', entityType: 'expense_category',
      entityId: req.params.id, after: body });
    res.json({ ok: true });
  }));

settingsRouter.get('/expense/policies', requirePermission('settings.view'), asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT p.id, p.name, p.category_id AS "categoryId", c.name AS "categoryName",
            p.project_id AS "projectId", pr.name AS "projectName",
            p.department_id AS "departmentId", d.name AS "departmentName",
            p.min_amount AS "minAmount", p.max_amount AS "maxAmount",
            p.requires_manager AS "requiresManager", p.requires_finance AS "requiresFinance",
            p.auto_approve_below AS "autoApproveBelow", p.receipt_required AS "receiptRequired",
            p.priority, p.active
       FROM expense_policies p
       LEFT JOIN expense_categories c ON c.id = p.category_id
       LEFT JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN departments d ON d.id = p.department_id
      ORDER BY p.active DESC, p.priority DESC, p.min_amount`);
  res.json({ data: rows });
}));

const policyBase = z.object({
  name: z.string().trim().min(3).max(160),
  categoryId: uuid.nullable().optional(),
  projectId: uuid.nullable().optional(),
  departmentId: uuid.nullable().optional(),
  minAmount: z.coerce.number().min(0).default(0),
  maxAmount: z.coerce.number().positive().nullable().optional(),
  requiresManager: z.boolean().default(true),
  requiresFinance: z.boolean().default(true),
  autoApproveBelow: z.coerce.number().positive().nullable().optional(),
  receiptRequired: z.boolean().nullable().optional(),
  priority: z.coerce.number().int().min(0).max(1000).default(100),
  active: z.boolean().default(true),
});

const maxAtLeastMin = <T extends z.ZodTypeAny>(schema: T) => schema.refine(
  (v: any) => v.maxAmount === null || v.maxAmount === undefined
              || v.minAmount === undefined || v.maxAmount >= v.minAmount,
  { message: 'The maximum must be at least the minimum', path: ['maxAmount'] });

const policySchema = maxAtLeastMin(policyBase);
const policyUpdateSchema = maxAtLeastMin(policyBase.partial());

settingsRouter.post('/expense/policies', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(policySchema, req.body);
  const row = await one<{ id: string }>(
    `INSERT INTO expense_policies (name, category_id, project_id, department_id, min_amount, max_amount,
                                   requires_manager, requires_finance, auto_approve_below, receipt_required,
                                   priority, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [body.name, body.categoryId ?? null, body.projectId ?? null, body.departmentId ?? null,
     body.minAmount, body.maxAmount ?? null, body.requiresManager, body.requiresFinance,
     body.autoApproveBelow ?? null, body.receiptRequired ?? null, body.priority, body.active, p.id]);
  await recordAudit(req, { action: 'settings.policy_created', entityType: 'expense_policy',
    entityId: row!.id, after: body });
  res.status(201).json({ id: row!.id });
}));

settingsRouter.patch('/expense/policies/:id', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const body = parse(policyUpdateSchema, req.body);
  const columns: Record<string, string> = {
    name: 'name', categoryId: 'category_id', projectId: 'project_id', departmentId: 'department_id',
    minAmount: 'min_amount', maxAmount: 'max_amount', requiresManager: 'requires_manager',
    requiresFinance: 'requires_finance', autoApproveBelow: 'auto_approve_below',
    receiptRequired: 'receipt_required', priority: 'priority', active: 'active',
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    params.push(v); sets.push(`${columns[k]} = $${params.length}`);
  }
  if (!sets.length) throw badRequest('Nothing to update.');
  params.push(req.params.id);
  const row = await one<{ id: string }>(
    `UPDATE expense_policies SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`, params);
  if (!row) throw notFound('Expense policy');
  await recordAudit(req, { action: 'settings.policy_updated', entityType: 'expense_policy',
    entityId: req.params.id, after: body });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------
// Roles & audit
// ---------------------------------------------------------------------
settingsRouter.get('/roles', requirePermission('settings.view'), asyncHandler(async (_req, res) => {
  const roles = await query(
    `SELECT r.id, r.key, r.name, r.description, r.is_system AS "isSystem",
            (SELECT COUNT(*)::int FROM users u WHERE u.role_id = r.id AND u.deleted_at IS NULL) AS "userCount",
            ARRAY(SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                   WHERE rp.role_id = r.id ORDER BY p.key) AS permissions
       FROM roles r ORDER BY r.name`);
  res.json({
    data: roles,
    catalogue: Object.entries(PERMISSIONS).map(([key, v]) => ({ key, ...v })),
    defaults: ROLE_PERMISSIONS,
  });
}));

settingsRouter.put('/roles/:id/permissions', requirePermission('rbac.manage'), asyncHandler(async (req, res) => {
  const body = parse(z.object({ permissions: z.array(z.string()).max(200) }), req.body);
  const role = await one<{ key: string }>(`SELECT key FROM roles WHERE id = $1`, [req.params.id]);
  if (!role) throw notFound('Role');
  if (role.key === 'super_admin') throw badRequest('The Super Admin role always holds every permission.');

  await tx(async (client) => {
    await query(`DELETE FROM role_permissions WHERE role_id = $1`, [req.params.id], client);
    for (const key of body.permissions) {
      await query(`INSERT INTO role_permissions (role_id, permission_id)
                   SELECT $1, id FROM permissions WHERE key = $2 ON CONFLICT DO NOTHING`,
        [req.params.id, key], client);
    }
  });
  await recordAudit(req, { action: 'settings.role_permissions_changed', entityType: 'role',
    entityId: req.params.id, after: body.permissions });
  res.json({ ok: true, count: body.permissions.length });
}));

settingsRouter.get('/audit-logs', requirePermission('audit.view'), asyncHandler(async (req, res) => {
  const f = parse(paginationSchema.extend({
    actorId: uuid.optional(), action: z.string().optional(),
    entityType: z.string().optional(), entityId: uuid.optional(),
  }), req.query);

  const rows = await query(
    `SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId",
            a.actor_role AS "actorRole", u.full_name AS "actorName", u.employee_code AS "actorCode",
            a.before, a.after, host(a.ip_address) AS "ipAddress", a.created_at AS "createdAt"
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ($1::uuid IS NULL OR a.actor_id = $1)
        AND ($2::text IS NULL OR a.action ILIKE $2 || '%')
        AND ($3::text IS NULL OR a.entity_type = $3)
        AND ($4::uuid IS NULL OR a.entity_id = $4)
      ORDER BY a.created_at DESC, a.id DESC LIMIT $5 OFFSET $6`,
    [f.actorId ?? null, f.action ?? null, f.entityType ?? null, f.entityId ?? null,
     f.size, offsetOf(f.page, f.size)]);

  const total = await one<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM audit_logs a
      WHERE ($1::uuid IS NULL OR a.actor_id = $1)
        AND ($2::text IS NULL OR a.action ILIKE $2 || '%')
        AND ($3::text IS NULL OR a.entity_type = $3)
        AND ($4::uuid IS NULL OR a.entity_id = $4)`,
    [f.actorId ?? null, f.action ?? null, f.entityType ?? null, f.entityId ?? null]);

  res.json({ data: rows, page: pageMeta(f.page, f.size, total?.count ?? 0) });
}));

// ---------------------------------------------------------------------
// Generic settings documents.
//
// Declared LAST on purpose: "/:scope/:key" would otherwise shadow every
// specific two-segment route above it (/expense/categories, /expense/policies)
// and answer "Setting not found" for all of them.
// ---------------------------------------------------------------------
settingsRouter.get('/:scope/:key', requirePermission('settings.view'), asyncHandler(async (req, res) => {
  const row = await one(
    `SELECT scope, key, value, updated_at AS "updatedAt" FROM settings WHERE scope = $1 AND key = $2`,
    [req.params.scope, req.params.key]);
  if (!row) throw notFound('Setting');
  res.json(row);
}));

settingsRouter.put('/:scope/:key', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const path = `${req.params.scope}.${req.params.key}`;
  const schema = SETTING_SCHEMAS[path];
  if (!schema) throw badRequest(`"${path}" is not a configurable setting.`);

  const value = parse(schema, req.body?.value ?? req.body);
  const before = await one<{ value: unknown }>(
    `SELECT value FROM settings WHERE scope = $1 AND key = $2`, [req.params.scope, req.params.key]);

  await query(
    `INSERT INTO settings (scope, key, value, updated_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (scope, key) DO UPDATE SET value = EXCLUDED.value,
                                            updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [req.params.scope, req.params.key, JSON.stringify(value), p.id]);

  await recordAudit(req, { action: 'settings.updated', entityType: 'setting',
    before: before?.value, after: value });
  res.json({ ok: true, scope: req.params.scope, key: req.params.key, value });
}));
