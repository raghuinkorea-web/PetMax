import { createHash } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { EMPLOYEE_EDITABLE_EXPENSE_STATUSES, EXPENSE_TRANSITIONS, type ExpenseStatus } from '@adisys/shared';
import { config } from '../config.js';
import { one, query, tx, SqlBuilder } from '../lib/db.js';
import { asyncHandler, dateString, offsetOf, pageMeta, paginationSchema, parse, uuid } from '../lib/http.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { can, principalOf, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { notify, usersWithPermissionRole } from '../services/notifications.js';
import { claimedOnDate, initialStage, nextStage, resolvePolicy } from '../services/expensePolicy.js';
import { storeFile } from '../services/storage.js';
import { nullableProjectScopeClause, assertProjectMembership, scopeFor, userScopeClause } from '../services/scope.js';

export const expenseRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.storage.maxUploadBytes, files: 5 },
});

const SELECT_CLAIM = `
  SELECT ec.id, ec.expense_code AS "expenseCode", ec.expense_date AS "expenseDate",
         ec.user_id AS "userId", u.full_name AS "employeeName", u.employee_code AS "employeeCode",
         d.name AS "departmentName",
         ec.project_id AS "projectId", pr.name AS "projectName", pr.project_code AS "projectCode",
         ec.category_id AS "categoryId", c.key AS "categoryKey", c.name AS "categoryName",
         c.form_variant AS "formVariant",
         ec.subcategory_id AS "subcategoryId", sc.name AS "subcategoryName",
         ec.amount, ec.currency, ec.description, ec.vendor_name AS "vendorName",
         ec.invoice_number AS "invoiceNumber", ec.expense_location AS "expenseLocation",
         ec.payment_method AS "paymentMethod", ec.notes,
         ec.vehicle_number AS "vehicleNumber", ec.fuel_type AS "fuelType",
         ec.fuel_quantity AS "fuelQuantity", ec.odometer_reading AS "odometerReading",
         ec.travel_purpose AS "travelPurpose", ec.meal_type AS "mealType",
         ec.claim_period_start AS "claimPeriodStart", ec.claim_period_end AS "claimPeriodEnd",
         ec.status, ec.current_stage AS "currentStage",
         ec.submitted_at AS "submittedAt", ec.decided_at AS "decidedAt",
         ec.rejection_reason AS "rejectionReason", ec.created_at AS "createdAt",
         (SELECT COUNT(*)::int FROM expense_attachments ea WHERE ea.claim_id = ec.id) AS "attachmentCount",
         (SELECT ea.file_id FROM expense_attachments ea
           WHERE ea.claim_id = ec.id AND ea.kind = 'receipt' ORDER BY ea.created_at LIMIT 1) AS "receiptFileId"
    FROM expense_claims ec
    JOIN users u ON u.id = ec.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN projects pr ON pr.id = ec.project_id
    JOIN expense_categories c ON c.id = ec.category_id
    LEFT JOIN expense_categories sc ON sc.id = ec.subcategory_id`;

const duplicateHash = (userId: string, date: string, amount: number, vendor: string | null) =>
  createHash('sha256').update(`${userId}|${date}|${amount.toFixed(2)}|${(vendor ?? '').toLowerCase().trim()}`).digest('hex');

// =====================================================================
// LIST
// =====================================================================
const listSchema = paginationSchema.extend({
  status: z.string().optional(),
  categoryId: uuid.optional(),
  projectId: uuid.optional(),
  userId: uuid.optional(),
  departmentId: uuid.optional(),
  stage: z.enum(['manager', 'finance']).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  search: z.string().trim().max(120).optional(),
  queue: z.enum(['mine', 'awaiting_me', 'all']).default('all'),
  sort: z.enum(['expense_date', 'amount', 'submitted_at', 'status']).default('expense_date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

function claimVisibility(req: any, startIdx: number) {
  const p = principalOf(req);
  const b = new SqlBuilder(startIdx);
  const scope = scopeFor(p, 'expense.view');
  if (scope === 'all') { b.add('TRUE'); return b; }
  if (scope === 'own') { b.add('ec.user_id = $?', p.id); return b; }
  if (scope === 'team') {
    // Own claims, claims from direct/indirect reports, and claims booked
    // to a project the caller manages.
    b.add(`(ec.user_id = $?
            OR ec.user_id IN (WITH RECURSIVE reports AS (
                 SELECT id FROM users WHERE reporting_manager_id = $? AND deleted_at IS NULL
                 UNION SELECT u2.id FROM users u2 JOIN reports r ON u2.reporting_manager_id = r.id
               ) SELECT id FROM reports)
            OR ec.project_id IN (SELECT id FROM projects WHERE manager_id = $?))`,
      p.id, p.id, p.id);
    return b;
  }
  b.add('FALSE');
  return b;
}

expenseRouter.get('/', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const f = parse(listSchema, req.query);
  if (scopeFor(p, 'expense.view') === 'none') throw forbidden('You cannot view expense claims.');

  const b = claimVisibility(req, 1);
  b.add('ec.deleted_at IS NULL');

  // Employees never see other people's drafts, and nobody sees another's.
  b.add(`(ec.status <> 'draft' OR ec.user_id = $?)`, p.id);

  if (f.queue === 'mine') b.add('ec.user_id = $?', p.id);
  if (f.queue === 'awaiting_me') {
    const stages: string[] = [];
    if (can(req, 'expense.approve.manager')) stages.push('manager');
    if (can(req, 'expense.approve.finance')) stages.push('finance');
    if (!stages.length) throw forbidden('You are not an approver.');
    b.add(`ec.status IN ('submitted','under_review') AND ec.current_stage = ANY($?)`, stages);
    b.add('ec.user_id <> $?', p.id);   // nobody approves their own claim
    if (stages.includes('manager') && !can(req, 'expense.view.all')) {
      b.add(`(ec.current_stage = 'finance'
              OR ec.project_id IN (SELECT id FROM projects WHERE manager_id = $?)
              OR ec.user_id IN (SELECT id FROM users WHERE reporting_manager_id = $?))`, p.id, p.id);
    }
  }

  b.addIf(f.status, 'ec.status = ANY($?)', f.status?.split(','));
  b.addIf(f.categoryId, '(ec.category_id = $? OR ec.subcategory_id = $?)', f.categoryId, f.categoryId);
  b.addIf(f.projectId, 'ec.project_id = $?', f.projectId);
  b.addIf(f.userId, 'ec.user_id = $?', f.userId);
  b.addIf(f.departmentId, 'u.department_id = $?', f.departmentId);
  b.addIf(f.stage, 'ec.current_stage = $?', f.stage);
  b.addIf(f.from, 'ec.expense_date >= $?::date', f.from);
  b.addIf(f.to, 'ec.expense_date <= $?::date', f.to);
  b.addIf(f.minAmount, 'ec.amount >= $?', f.minAmount);
  b.addIf(f.maxAmount, 'ec.amount <= $?', f.maxAmount);
  b.addIf(f.search, `(ec.expense_code ILIKE $? OR ec.vendor_name ILIKE $? OR ec.description ILIKE $?
                      OR ec.invoice_number ILIKE $? OR u.full_name ILIKE $?)`,
    ...Array(5).fill(`%${f.search}%`));

  const order = { expense_date: 'ec.expense_date', amount: 'ec.amount',
                  submitted_at: 'ec.submitted_at', status: 'ec.status' }[f.sort];

  const rows = await query(
    `${SELECT_CLAIM} ${b.where}
      ORDER BY ${order} ${f.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, ec.created_at DESC
      LIMIT $${b.next} OFFSET $${b.next + 1}`,
    [...b.params, f.size, offsetOf(f.page, f.size)]);

  const totals = await one<any>(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(ec.amount),0) AS "totalAmount",
            COALESCE(SUM(ec.amount) FILTER (WHERE ec.status IN ('approved','reimbursement_pending','paid')),0) AS "approvedAmount",
            COALESCE(SUM(ec.amount) FILTER (WHERE ec.status IN ('submitted','under_review')),0) AS "pendingAmount"
       FROM expense_claims ec
       JOIN users u ON u.id = ec.user_id ${b.where}`, b.params);

  res.json({
    data: rows,
    page: pageMeta(f.page, f.size, totals?.count ?? 0),
    totals: {
      count: totals?.count ?? 0,
      totalAmount: Number(totals?.totalAmount ?? 0),
      approvedAmount: Number(totals?.approvedAmount ?? 0),
      pendingAmount: Number(totals?.pendingAmount ?? 0),
    },
  });
}));

/** The employee app's expense summary tiles. */
expenseRouter.get('/my-summary', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const rows = await query<any>(
    `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount),0) AS amount
       FROM expense_claims WHERE user_id = $1 AND deleted_at IS NULL
        AND expense_date >= date_trunc('year', CURRENT_DATE)::date
      GROUP BY status`, [p.id]);

  const byCategory = await query<any>(
    `SELECT c.name AS category, COUNT(*)::int AS count, COALESCE(SUM(ec.amount),0) AS amount
       FROM expense_claims ec JOIN expense_categories c ON c.id = ec.category_id
      WHERE ec.user_id = $1 AND ec.deleted_at IS NULL AND ec.status <> 'draft'
        AND ec.expense_date >= (CURRENT_DATE - 90)
      GROUP BY c.name ORDER BY amount DESC`, [p.id]);

  const get = (...statuses: ExpenseStatus[]) =>
    rows.filter((r) => statuses.includes(r.status))
        .reduce((a, r) => ({ count: a.count + r.count, amount: a.amount + Number(r.amount) }), { count: 0, amount: 0 });

  res.json({
    draft: get('draft'),
    pending: get('submitted', 'under_review'),
    approved: get('approved', 'reimbursement_pending'),
    rejected: get('rejected'),
    returned: get('returned'),
    paid: get('paid'),
    total: get('submitted', 'under_review', 'approved', 'reimbursement_pending', 'paid', 'rejected'),
    byCategory: byCategory.map((c) => ({ ...c, amount: Number(c.amount) })),
  });
}));

// =====================================================================
// DETAIL
// =====================================================================
async function loadClaim(req: any, id: string) {
  const b = claimVisibility(req, 2);
  const row = await one<any>(
    `${SELECT_CLAIM} WHERE ec.id = $1 AND ec.deleted_at IS NULL AND ${b.where.replace(/^WHERE /, '')}`,
    [id, ...b.params]);
  if (!row) throw notFound('Expense claim');
  const p = principalOf(req);
  if (row.status === 'draft' && row.userId !== p.id) throw notFound('Expense claim');
  return row;
}

expenseRouter.get('/:id', asyncHandler(async (req, res) => {
  const claim = await loadClaim(req, req.params.id);
  const [attachments, trail, duplicates] = await Promise.all([
    query(`SELECT ea.id, ea.file_id AS "fileId", ea.kind, ea.ocr_status AS "ocrStatus",
                  ea.ocr_payload AS "ocrPayload", ea.ocr_confirmed_by_user AS "ocrConfirmed",
                  f.original_name AS "originalName", f.mime_type AS "mimeType",
                  f.size_bytes AS "sizeBytes", ea.created_at AS "createdAt"
             FROM expense_attachments ea JOIN files f ON f.id = ea.file_id
            WHERE ea.claim_id = $1 ORDER BY ea.created_at`, [req.params.id]),
    query(`SELECT a.id, a.stage, a.actor_id AS "actorId", u.full_name AS "actorName",
                  a.action, a.from_status AS "fromStatus", a.to_status AS "toStatus",
                  a.comment, a.acted_at AS "actedAt"
             FROM expense_approvals a LEFT JOIN users u ON u.id = a.actor_id
            WHERE a.claim_id = $1 ORDER BY a.acted_at, a.id`, [req.params.id]),
    query(`SELECT id, expense_code AS "expenseCode", expense_date AS "expenseDate",
                  amount, status
             FROM expense_claims
            WHERE duplicate_hash = (SELECT duplicate_hash FROM expense_claims WHERE id = $1)
              AND id <> $1 AND deleted_at IS NULL
              AND status NOT IN ('rejected','cancelled')`, [req.params.id]),
  ]);

  const policy = await resolvePolicy({
    amount: Number(claim.amount), categoryId: claim.categoryId,
    projectId: claim.projectId, departmentId: null,
  });

  res.json({ claim, attachments, approvalTrail: trail, possibleDuplicates: duplicates, policy });
}));

// =====================================================================
// CREATE / UPDATE
// =====================================================================
const claimSchema = z.object({
  projectId: uuid.nullable().optional(),
  categoryId: uuid,
  subcategoryId: uuid.nullable().optional(),
  expenseDate: dateString,
  amount: z.coerce.number().positive('Enter an amount greater than zero').max(10_000_000),
  description: z.string().trim().min(3, 'Describe what this expense was for').max(1000),
  vendorName: z.string().trim().max(180).nullable().optional(),
  invoiceNumber: z.string().trim().max(80).nullable().optional(),
  expenseLocation: z.string().trim().max(200).nullable().optional(),
  paymentMethod: z.enum(['cash', 'upi', 'card', 'company_card', 'bank_transfer', 'other']).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  // Fuel
  vehicleNumber: z.string().trim().max(20).nullable().optional(),
  fuelType: z.enum(['petrol', 'diesel', 'cng', 'ev']).nullable().optional(),
  fuelQuantity: z.coerce.number().positive().max(999).nullable().optional(),
  odometerReading: z.coerce.number().positive().max(9_999_999).nullable().optional(),
  travelPurpose: z.string().trim().max(300).nullable().optional(),
  // Food
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'other']).nullable().optional(),
  // Consolidated claims
  claimPeriodStart: dateString.nullable().optional(),
  claimPeriodEnd: dateString.nullable().optional(),
  submit: z.boolean().default(false),
});

/** Server-side validation of everything the Settings module configures. */
async function validateClaim(userId: string, body: z.infer<typeof claimSchema>, excludeClaimId: string | null) {
  const details: Record<string, string[]> = {};

  const category = await one<{ id: string; name: string; project_required: boolean;
                              receipt_required: boolean; parent_id: string | null }>(
    `SELECT id, name, project_required, receipt_required, parent_id
       FROM expense_categories WHERE id = $1 AND active`, [body.categoryId]);
  if (!category) throw badRequest('Choose a valid expense category.', { categoryId: ['Unknown category'] });
  if (category.parent_id) throw badRequest('Choose a top-level category and then a subcategory.',
    { categoryId: ['This is a subcategory'] });

  if (body.subcategoryId) {
    const sub = await one<{ id: string }>(
      `SELECT id FROM expense_categories WHERE id = $1 AND parent_id = $2 AND active`,
      [body.subcategoryId, body.categoryId]);
    if (!sub) details.subcategoryId = ['That subcategory does not belong to the selected category'];
  }

  const rules = await one<{ value: any }>(
    `SELECT value FROM settings WHERE scope = 'expense' AND key = 'rules'`);
  const backdateDays = rules?.value?.backdatedClaimWindowDays ?? 45;

  const ageDays = Math.floor((Date.now() - Date.parse(body.expenseDate)) / 86_400_000);
  if (ageDays < 0) details.expenseDate = ['An expense cannot be dated in the future'];
  else if (ageDays > backdateDays) {
    details.expenseDate = [`Claims must be submitted within ${backdateDays} days of the expense date`];
  }

  if (category.project_required && !body.projectId) {
    details.projectId = [`${category.name} claims must be booked to a project`];
  }
  if (body.projectId) await assertProjectMembership(userId, body.projectId);

  const policy = await resolvePolicy({
    amount: body.amount, categoryId: body.categoryId, projectId: body.projectId ?? null, departmentId: null,
  });

  if (policy.maxAmountPerClaim !== null && body.amount > policy.maxAmountPerClaim) {
    details.amount = [`The limit for ${category.name} is ₹${policy.maxAmountPerClaim.toLocaleString('en-IN')} per claim`];
  }
  if (policy.dailyLimit !== null) {
    const already = await claimedOnDate(userId, body.categoryId, body.expenseDate, excludeClaimId);
    if (already + body.amount > policy.dailyLimit) {
      details.amount = [
        `This would take your ${category.name} total for ${body.expenseDate} to ` +
        `₹${(already + body.amount).toLocaleString('en-IN')}, above the ₹${policy.dailyLimit.toLocaleString('en-IN')} daily limit ` +
        `(₹${already.toLocaleString('en-IN')} already claimed).`];
    }
  }
  if (body.claimPeriodStart && body.claimPeriodEnd && body.claimPeriodEnd < body.claimPeriodStart) {
    details.claimPeriodEnd = ['The period end cannot be before the period start'];
  }

  if (Object.keys(details).length) throw badRequest('Please correct the highlighted fields.', details);
  return { category, policy };
}

const CLAIM_COLUMNS: Array<[keyof z.infer<typeof claimSchema>, string]> = [
  ['projectId', 'project_id'], ['categoryId', 'category_id'], ['subcategoryId', 'subcategory_id'],
  ['expenseDate', 'expense_date'], ['amount', 'amount'], ['description', 'description'],
  ['vendorName', 'vendor_name'], ['invoiceNumber', 'invoice_number'], ['expenseLocation', 'expense_location'],
  ['paymentMethod', 'payment_method'], ['notes', 'notes'], ['vehicleNumber', 'vehicle_number'],
  ['fuelType', 'fuel_type'], ['fuelQuantity', 'fuel_quantity'], ['odometerReading', 'odometer_reading'],
  ['travelPurpose', 'travel_purpose'], ['mealType', 'meal_type'],
  ['claimPeriodStart', 'claim_period_start'], ['claimPeriodEnd', 'claim_period_end'],
];

expenseRouter.post('/', requirePermission('expense.create'), upload.array('receipts', 5),
  asyncHandler(async (req, res) => {
    const p = principalOf(req);
    // multipart bodies arrive as strings; booleans and numbers are coerced by Zod.
    const raw = { ...req.body, submit: req.body.submit === 'true' || req.body.submit === true };
    const body = parse(claimSchema, raw);
    const { category, policy } = await validateClaim(p.id, body, null);

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (body.submit && policy.receiptRequired && !files.length) {
      throw badRequest(`A receipt image is required for ${category.name} claims.`,
        { receipts: ['Attach a photo or PDF of the bill'] });
    }

    const hash = duplicateHash(p.id, body.expenseDate, body.amount, body.vendorName ?? null);
    const duplicate = await one<{ id: string; expense_code: string }>(
      `SELECT id, expense_code FROM expense_claims
        WHERE duplicate_hash = $1 AND user_id = $2 AND deleted_at IS NULL
          AND status NOT IN ('rejected','cancelled') LIMIT 1`, [hash, p.id]);
    if (duplicate && req.body.confirmDuplicate !== 'true') {
      throw conflict(
        `You already have a claim (${duplicate.expense_code}) for the same date, amount and vendor. ` +
        'Resubmit with confirmDuplicate if this is genuinely a second expense.', 'POSSIBLE_DUPLICATE');
    }

    const created = await tx(async (client) => {
      const year = body.expenseDate.slice(0, 4);
      const code = (await one<{ c: string }>(`SELECT next_code('expense','EXP',$1,4) AS c`, [year], client))!.c;

      const status: ExpenseStatus = body.submit ? 'submitted' : 'draft';
      const stage = body.submit ? initialStage(policy, body.amount) : null;
      const autoApproved = body.submit && stage === null;

      const claim = await one<{ id: string }>(
        `INSERT INTO expense_claims
           (expense_code, user_id, project_id, category_id, subcategory_id, expense_date, amount,
            description, vendor_name, invoice_number, expense_location, payment_method, notes,
            vehicle_number, fuel_type, fuel_quantity, odometer_reading, travel_purpose, meal_type,
            claim_period_start, claim_period_end, status, current_stage, submitted_at, decided_at,
            duplicate_hash, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                 $22,$23,$24,$25,$26,$27)
         RETURNING id`,
        [code, p.id, body.projectId ?? null, body.categoryId, body.subcategoryId ?? null,
         body.expenseDate, body.amount, body.description, body.vendorName ?? null,
         body.invoiceNumber ?? null, body.expenseLocation ?? null, body.paymentMethod ?? null,
         body.notes ?? null, body.vehicleNumber ?? null, body.fuelType ?? null,
         body.fuelQuantity ?? null, body.odometerReading ?? null, body.travelPurpose ?? null,
         body.mealType ?? null, body.claimPeriodStart ?? null, body.claimPeriodEnd ?? null,
         autoApproved ? 'approved' : status, stage,
         body.submit ? new Date().toISOString() : null,
         autoApproved ? new Date().toISOString() : null,
         hash, JSON.stringify({ policyId: policy.policyId, policyName: policy.policyName })],
        client);

      for (const file of files) {
        const stored = await storeFile({
          buffer: file.buffer, originalName: file.originalname, declaredMime: file.mimetype,
          uploadedBy: p.id, purpose: 'receipt',
        }, client);
        await query(`INSERT INTO expense_attachments (claim_id, file_id, kind) VALUES ($1,$2,'receipt')`,
          [claim!.id, stored.id], client);
      }

      if (body.submit) {
        await query(`INSERT INTO expense_approvals (claim_id, stage, actor_id, action, from_status, to_status)
                     VALUES ($1,'employee',$2,'submitted','draft','submitted')`, [claim!.id, p.id], client);
        if (autoApproved) {
          await query(`INSERT INTO expense_approvals (claim_id, stage, action, from_status, to_status, comment)
                       VALUES ($1,'system','auto_approved','submitted','approved',$2)`,
            [claim!.id, `Auto-approved under policy "${policy.policyName}".`], client);
          await notify({ userId: p.id, type: 'expense.approved', title: 'Expense approved',
            body: `${code} was approved automatically under ${policy.policyName}.`,
            entityType: 'expense_claim', entityId: claim!.id, severity: 'success' }, client);
        } else {
          const approvers = stage === 'manager'
            ? await approverIdsForStage(claim!.id, 'manager', client)
            : await usersWithPermissionRole(['finance_manager', 'super_admin'], p.id);
          await notify(approvers.map((userId) => ({
            userId, type: 'expense.awaiting_approval' as const, title: 'Expense awaiting your approval',
            body: `${code} · ₹${body.amount.toLocaleString('en-IN')} from ${p.fullName}`,
            entityType: 'expense_claim' as const, entityId: claim!.id, severity: 'warning' as const,
          })), client);
        }
      }
      return { id: claim!.id, expenseCode: code, status: autoApproved ? 'approved' : status, stage };
    });

    await recordAudit(req, { action: body.submit ? 'expense.submitted' : 'expense.draft_created',
      entityType: 'expense_claim', entityId: created.id,
      after: { amount: body.amount, categoryId: body.categoryId, projectId: body.projectId } });

    res.status(201).json({
      ...created,
      policy: { name: policy.policyName, requiresManager: policy.requiresManager, requiresFinance: policy.requiresFinance },
      message: created.status === 'draft' ? 'Saved as a draft.'
        : created.status === 'approved' ? 'Submitted and auto-approved under policy.'
        : `Submitted for ${created.stage} approval.`,
    });
  }));

async function approverIdsForStage(claimId: string, stage: 'manager' | 'finance', client?: any): Promise<string[]> {
  if (stage === 'finance') return usersWithPermissionRole(['finance_manager', 'super_admin']);
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT x.id FROM (
        SELECT pr.manager_id AS id FROM expense_claims ec
          JOIN projects pr ON pr.id = ec.project_id WHERE ec.id = $1
        UNION
        SELECT u.reporting_manager_id FROM expense_claims ec
          JOIN users u ON u.id = ec.user_id WHERE ec.id = $1
     ) x WHERE x.id IS NOT NULL`, [claimId], client);
  return rows.map((r) => r.id);
}

// =====================================================================
// UPDATE — only while the claim is the employee's to change.
// =====================================================================
expenseRouter.patch('/:id', requirePermission('expense.create'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const existing = await one<any>(
    `SELECT * FROM expense_claims WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
  if (!existing) throw notFound('Expense claim');

  const isOwner = existing.user_id === p.id;
  const editableByOwner = EMPLOYEE_EDITABLE_EXPENSE_STATUSES.includes(existing.status);

  if (isOwner && !editableByOwner) {
    throw conflict(
      existing.status === 'submitted' || existing.status === 'under_review'
        ? 'This claim is with an approver and can no longer be edited. Ask them to return it to you.'
        : `A ${existing.status.replace('_', ' ')} claim cannot be edited.`,
      'CLAIM_LOCKED');
  }
  if (!isOwner && !can(req, 'expense.edit_approved')) {
    throw forbidden('You can only edit your own expense claims.');
  }

  const body = parse(claimSchema.partial({ categoryId: true, expenseDate: true, amount: true, description: true }),
    { ...existing_to_camel(existing), ...req.body, submit: false });
  await validateClaim(existing.user_id, body as any, req.params.id);

  const sets: string[] = [];
  const params: unknown[] = [];
  const changed: Record<string, unknown> = {};
  for (const [field, column] of CLAIM_COLUMNS) {
    if (!(field in req.body)) continue;
    params.push((body as any)[field] ?? null);
    sets.push(`${column} = $${params.length}`);
    changed[field] = (body as any)[field] ?? null;
  }
  if (!sets.length) return res.json({ ok: true, changed: {} });

  params.push(duplicateHash(existing.user_id,
    (body as any).expenseDate ?? existing.expense_date,
    Number((body as any).amount ?? existing.amount),
    (body as any).vendorName ?? existing.vendor_name));
  sets.push(`duplicate_hash = $${params.length}`);

  params.push(req.params.id);
  await query(`UPDATE expense_claims SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

  await recordAudit(req, { action: 'expense.updated', entityType: 'expense_claim',
    entityId: req.params.id, before: existing, after: changed });
  res.json({ ok: true, changed });
}));

function existing_to_camel(row: any) {
  return {
    projectId: row.project_id, categoryId: row.category_id, subcategoryId: row.subcategory_id,
    expenseDate: row.expense_date, amount: Number(row.amount), description: row.description,
    vendorName: row.vendor_name, invoiceNumber: row.invoice_number, expenseLocation: row.expense_location,
    paymentMethod: row.payment_method, notes: row.notes, vehicleNumber: row.vehicle_number,
    fuelType: row.fuel_type, fuelQuantity: row.fuel_quantity, odometerReading: row.odometer_reading,
    travelPurpose: row.travel_purpose, mealType: row.meal_type,
    claimPeriodStart: row.claim_period_start, claimPeriodEnd: row.claim_period_end,
  };
}

// =====================================================================
// RECEIPTS
// =====================================================================
expenseRouter.post('/:id/receipts', requirePermission('expense.create'), upload.array('receipts', 5),
  asyncHandler(async (req, res) => {
    const p = principalOf(req);
    const claim = await one<{ user_id: string; status: ExpenseStatus }>(
      `SELECT user_id, status FROM expense_claims WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!claim) throw notFound('Expense claim');
    if (claim.user_id !== p.id) throw forbidden('You can only attach receipts to your own claims.');
    if (!EMPLOYEE_EDITABLE_EXPENSE_STATUSES.includes(claim.status)) {
      throw conflict('Receipts can only be added while the claim is a draft or has been returned to you.', 'CLAIM_LOCKED');
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw badRequest('No file was received.', { receipts: ['Attach at least one file'] });

    const stored = await tx(async (client) => {
      const out = [];
      for (const file of files) {
        const s = await storeFile({
          buffer: file.buffer, originalName: file.originalname, declaredMime: file.mimetype,
          uploadedBy: p.id, purpose: 'receipt',
        }, client);
        const att = await one<{ id: string }>(
          `INSERT INTO expense_attachments (claim_id, file_id, kind) VALUES ($1,$2,'receipt') RETURNING id`,
          [req.params.id, s.id], client);
        out.push({ attachmentId: att!.id, fileId: s.id, mimeType: s.mimeType, sizeBytes: s.sizeBytes });
      }
      return out;
    });

    await recordAudit(req, { action: 'expense.receipt_added', entityType: 'expense_claim',
      entityId: req.params.id, after: { count: stored.length } });
    res.status(201).json({ attachments: stored });
  }));

expenseRouter.delete('/:id/receipts/:attachmentId', requirePermission('expense.create'),
  asyncHandler(async (req, res) => {
    const p = principalOf(req);
    const row = await one<{ status: ExpenseStatus; user_id: string }>(
      `SELECT ec.status, ec.user_id FROM expense_attachments ea
         JOIN expense_claims ec ON ec.id = ea.claim_id
        WHERE ea.id = $1 AND ea.claim_id = $2`, [req.params.attachmentId, req.params.id]);
    if (!row) throw notFound('Attachment');
    if (row.user_id !== p.id) throw forbidden('You can only remove receipts from your own claims.');
    if (!EMPLOYEE_EDITABLE_EXPENSE_STATUSES.includes(row.status)) {
      throw conflict('Receipts cannot be removed once the claim is with an approver.', 'CLAIM_LOCKED');
    }
    await query(`DELETE FROM expense_attachments WHERE id = $1`, [req.params.attachmentId]);
    await recordAudit(req, { action: 'expense.receipt_removed', entityType: 'expense_claim', entityId: req.params.id });
    res.json({ ok: true });
  }));

/**
 * OCR extraction. The result is ALWAYS a suggestion the employee must
 * confirm — it is never written to the claim and never implies approval.
 */
expenseRouter.post('/:id/receipts/:attachmentId/ocr', requirePermission('expense.create'),
  asyncHandler(async (req, res) => {
    const p = principalOf(req);
    const row = await one<any>(
      `SELECT ea.id, ea.ocr_status, ea.ocr_payload, ec.user_id, ec.status
         FROM expense_attachments ea JOIN expense_claims ec ON ec.id = ea.claim_id
        WHERE ea.id = $1 AND ea.claim_id = $2`, [req.params.attachmentId, req.params.id]);
    if (!row) throw notFound('Attachment');
    if (row.user_id !== p.id) throw forbidden('You can only run extraction on your own receipts.');

    const settings = await one<{ value: any }>(
      `SELECT value FROM settings WHERE scope = 'expense' AND key = 'rules'`);
    if (!settings?.value?.ocrEnabled) {
      return res.status(501).json({
        error: { code: 'OCR_DISABLED', message: 'Receipt extraction is switched off for this organisation.' },
      });
    }

    // Queued for the background worker; the client polls the attachment.
    await query(`UPDATE expense_attachments SET ocr_status = 'queued' WHERE id = $1`, [req.params.attachmentId]);
    res.status(202).json({
      status: 'queued',
      message: 'Extraction has been queued. You must review and confirm every extracted value before submitting.',
    });
  }));

// =====================================================================
// SUBMIT / RESUBMIT
// =====================================================================
expenseRouter.post('/:id/submit', requirePermission('expense.create'), asyncHandler(async (req, res) => {
  const p = principalOf(req);

  const result = await tx(async (client) => {
    const claim = await one<any>(
      `SELECT * FROM expense_claims WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [req.params.id], client);
    if (!claim) throw notFound('Expense claim');
    if (claim.user_id !== p.id) throw forbidden('You can only submit your own claims.');
    if (!EXPENSE_TRANSITIONS[claim.status as ExpenseStatus].includes('submitted')) {
      throw conflict(`A ${claim.status.replace('_', ' ')} claim cannot be submitted.`, 'INVALID_TRANSITION');
    }

    const policy = await resolvePolicy({
      amount: Number(claim.amount), categoryId: claim.category_id,
      projectId: claim.project_id, departmentId: null,
    }, client);

    if (policy.receiptRequired) {
      const att = await one<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM expense_attachments WHERE claim_id = $1 AND kind = 'receipt'`,
        [claim.id], client);
      if (!att?.count) throw badRequest('A receipt is required before this claim can be submitted.',
        { receipts: ['Attach a photo or PDF of the bill'] });
    }

    const wasReturned = claim.status === 'returned';
    const stage = initialStage(policy, Number(claim.amount));
    const autoApproved = stage === null;

    await query(
      `UPDATE expense_claims
          SET status = $2, current_stage = $3, submitted_at = now(),
              decided_at = CASE WHEN $2 = 'approved' THEN now() ELSE NULL END,
              rejection_reason = NULL
        WHERE id = $1`,
      [claim.id, autoApproved ? 'approved' : 'submitted', stage], client);

    await query(
      `INSERT INTO expense_approvals (claim_id, stage, actor_id, action, from_status, to_status, comment)
       VALUES ($1,'employee',$2,$3,$4,'submitted',$5)`,
      [claim.id, p.id, wasReturned ? 'resubmitted' : 'submitted', claim.status,
       wasReturned ? 'Corrected and resubmitted by the employee.' : null], client);

    if (autoApproved) {
      await query(`INSERT INTO expense_approvals (claim_id, stage, action, from_status, to_status, comment)
                   VALUES ($1,'system','auto_approved','submitted','approved',$2)`,
        [claim.id, `Auto-approved under policy "${policy.policyName}".`], client);
    } else {
      const approvers = await approverIdsForStage(claim.id, stage!, client);
      await notify(approvers.filter((id) => id !== p.id).map((userId) => ({
        userId, type: 'expense.awaiting_approval' as const, title: 'Expense awaiting your approval',
        body: `${claim.expense_code} · ₹${Number(claim.amount).toLocaleString('en-IN')} from ${p.fullName}`,
        entityType: 'expense_claim' as const, entityId: claim.id, severity: 'warning' as const,
      })), client);
    }

    return { expenseCode: claim.expense_code, status: autoApproved ? 'approved' : 'submitted',
             stage, wasReturned, policyName: policy.policyName };
  });

  await recordAudit(req, { action: result.wasReturned ? 'expense.resubmitted' : 'expense.submitted',
    entityType: 'expense_claim', entityId: req.params.id, after: { status: result.status } });
  res.json(result);
}));

expenseRouter.post('/:id/cancel', requirePermission('expense.create'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const claim = await one<{ user_id: string; status: ExpenseStatus; expense_code: string }>(
    `SELECT user_id, status, expense_code FROM expense_claims WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id]);
  if (!claim) throw notFound('Expense claim');
  if (claim.user_id !== p.id) throw forbidden('You can only cancel your own claims.');
  if (!EXPENSE_TRANSITIONS[claim.status].includes('cancelled')) {
    throw conflict(`A ${claim.status.replace('_', ' ')} claim cannot be cancelled.`, 'INVALID_TRANSITION');
  }
  await tx(async (client) => {
    await query(`UPDATE expense_claims SET status = 'cancelled', current_stage = NULL WHERE id = $1`,
      [req.params.id], client);
    await query(`INSERT INTO expense_approvals (claim_id, stage, actor_id, action, from_status, to_status)
                 VALUES ($1,'employee',$2,'cancelled',$3,'cancelled')`,
      [req.params.id, p.id, claim.status], client);
  });
  await recordAudit(req, { action: 'expense.cancelled', entityType: 'expense_claim', entityId: req.params.id });
  res.json({ ok: true, status: 'cancelled' });
}));

// =====================================================================
// APPROVAL WORKFLOW
// =====================================================================
const decisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'return']),
  comment: z.string().trim().max(1000).optional(),
}).refine((v) => v.action === 'approve' || (v.comment && v.comment.length >= 5), {
  message: 'Record the reason — the employee will see it', path: ['comment'],
});

/**
 * Applies one approval decision. Both the single-claim endpoint and the
 * bulk queue action call THIS function, so the rules cannot diverge.
 */
async function applyDecision(req: any, claimId: string, action: 'approve' | 'reject' | 'return', comment?: string) {
  const p = principalOf(req);

  const result = await tx(async (client) => {
    const claim = await one<any>(
      `SELECT ec.*, pr.manager_id, u.reporting_manager_id, u.full_name AS employee_name
         FROM expense_claims ec
         JOIN users u ON u.id = ec.user_id
         LEFT JOIN projects pr ON pr.id = ec.project_id
        WHERE ec.id = $1 AND ec.deleted_at IS NULL FOR UPDATE OF ec`, [claimId], client);
    if (!claim) throw notFound('Expense claim');

    if (!['submitted', 'under_review'].includes(claim.status)) {
      throw conflict(`This claim is ${claim.status.replace('_', ' ')} and is no longer awaiting a decision.`,
        'NOT_PENDING');
    }
    // Nobody approves their own money.
    if (claim.user_id === p.id) throw forbidden('You cannot decide on your own expense claim.');

    const stage: 'manager' | 'finance' = claim.current_stage ?? 'manager';
    if (stage === 'manager') {
      if (!can(req, 'expense.approve.manager')) throw forbidden('You are not a manager approver.');
      const isTheirs = claim.manager_id === p.id || claim.reporting_manager_id === p.id;
      if (!isTheirs && !can(req, 'expense.view.all')) {
        throw forbidden("This claim belongs to another manager's project or team.");
      }
    } else if (!can(req, 'expense.approve.finance')) {
      throw forbidden('This claim is awaiting finance approval.');
    }

    const policy = await resolvePolicy({
      amount: Number(claim.amount), categoryId: claim.category_id,
      projectId: claim.project_id, departmentId: null,
    }, client);

    let toStatus: ExpenseStatus;
    let nextStageValue: 'manager' | 'finance' | null = null;

    if (action === 'reject')      toStatus = 'rejected';
    else if (action === 'return') toStatus = 'returned';
    else {
      nextStageValue = nextStage(policy, stage);
      toStatus = nextStageValue ? 'under_review' : 'approved';
    }

    await query(
      `UPDATE expense_claims
          SET status = $2, current_stage = $3,
              decided_at = CASE WHEN $2 IN ('approved','rejected') THEN now() ELSE NULL END,
              rejection_reason = CASE WHEN $2 = 'rejected' THEN $4 ELSE NULL END
        WHERE id = $1`,
      [claim.id, toStatus, nextStageValue, comment ?? 'No reason recorded'], client);

    await query(
      `INSERT INTO expense_approvals (claim_id, stage, actor_id, action, from_status, to_status, comment)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [claim.id, stage, p.id,
       action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'returned',
       claim.status, toStatus, comment ?? null], client);

    // Tell the employee, and the next approver if there is one.
    const amount = `\u20b9${Number(claim.amount).toLocaleString('en-IN')}`;
    const messages: Record<string, { type: any; title: string; severity: any; body: string }> = {
      approved: { type: 'expense.approved', title: 'Expense approved', severity: 'success',
        body: `${claim.expense_code} \u00b7 ${amount} has been approved.` },
      rejected: { type: 'expense.rejected', title: 'Expense rejected', severity: 'critical',
        body: `${claim.expense_code} \u00b7 ${amount} was rejected: ${comment}` },
      returned: { type: 'expense.returned', title: 'Expense returned for correction', severity: 'warning',
        body: `${claim.expense_code} needs correction: ${comment}` },
      under_review: { type: 'expense.submitted', title: 'Expense moved to finance', severity: 'info',
        body: `${claim.expense_code} \u00b7 ${amount} cleared manager approval and is now with finance.` },
    };
    await notify({ userId: claim.user_id, entityType: 'expense_claim', entityId: claim.id,
      ...messages[toStatus] }, client);

    if (nextStageValue) {
      const approvers = await approverIdsForStage(claim.id, nextStageValue, client);
      await notify(approvers.filter((id) => id !== p.id).map((userId) => ({
        userId, type: 'expense.awaiting_approval' as const, title: 'Expense awaiting your approval',
        body: `${claim.expense_code} \u00b7 ${amount} from ${claim.employee_name}`,
        entityType: 'expense_claim' as const, entityId: claim.id, severity: 'warning' as const,
      })), client);
    }

    return { expenseCode: claim.expense_code, from: claim.status, to: toStatus,
             stage, nextStage: nextStageValue, policyName: policy.policyName };
  });

  await recordAudit(req, { action: `expense.${action}`, entityType: 'expense_claim',
    entityId: claimId, before: { status: result.from }, after: { status: result.to, comment } });
  return result;
}

expenseRouter.post('/:id/decision', asyncHandler(async (req, res) => {
  const body = parse(decisionSchema, req.body);
  res.json(await applyDecision(req, req.params.id, body.action, body.comment));
}));

/** Bulk decision on an approval queue selection. */
expenseRouter.post('/decision-bulk', asyncHandler(async (req, res) => {
  const body = parse(z.object({
    claimIds: z.array(uuid).min(1).max(100),
    action: z.enum(['approve', 'reject', 'return']),
    comment: z.string().trim().max(1000).optional(),
  }).refine((v) => v.action === 'approve' || (v.comment && v.comment.length >= 5), {
    message: 'Record the reason \u2014 employees will see it', path: ['comment'],
  }), req.body);

  // Each claim is decided independently: one claim the caller may not
  // approve does not block the rest of the queue.
  const processed: Array<{ id: string; expenseCode: string; to: string }> = [];
  const failed: Array<{ id: string; code: string; reason: string }> = [];

  for (const id of body.claimIds) {
    try {
      const r = await applyDecision(req, id, body.action, body.comment);
      processed.push({ id, expenseCode: r.expenseCode, to: r.to });
    } catch (err) {
      failed.push({
        id,
        code: err instanceof AppError ? err.code : 'ERROR',
        reason: err instanceof Error ? err.message : 'Could not be processed',
      });
    }
  }

  res.json({
    processed, failed,
    count: processed.length,
    message: failed.length
      ? `${processed.length} processed, ${failed.length} could not be actioned.`
      : `${processed.length} claim${processed.length === 1 ? '' : 's'} ${body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : 'returned'}.`,
  });
}));

/** Finance marks approved claims as reimbursed. */
expenseRouter.post('/reimburse', requirePermission('expense.mark_paid'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({
    claimIds: z.array(uuid).min(1).max(500),
    paymentReference: z.string().trim().max(120).optional(),
    paymentMode: z.enum(['bank_transfer', 'upi', 'cash', 'payroll']).default('bank_transfer'),
  }), req.body);

  const result = await tx(async (client) => {
    const claims = await query<{ id: string; amount: number; user_id: string; expense_code: string }>(
      `SELECT id, amount, user_id, expense_code FROM expense_claims
        WHERE id = ANY($1) AND deleted_at IS NULL
          AND status IN ('approved','reimbursement_pending') FOR UPDATE`, [body.claimIds], client);
    if (!claims.length) throw badRequest('None of the selected claims are approved and awaiting payment.');

    const year = String(new Date().getFullYear());
    const code = (await one<{ c: string }>(`SELECT next_code('reimbursement','REIMB',$1,3) AS c`, [year], client))!.c;
    const total = claims.reduce((a, c) => a + Number(c.amount), 0);

    const batch = await one<{ id: string }>(
      `INSERT INTO reimbursement_batches (batch_code, paid_at, payment_reference, payment_mode, total_amount, created_by)
       VALUES ($1, now(), $2, $3, $4, $5) RETURNING id`,
      [code, body.paymentReference ?? null, body.paymentMode, total, p.id], client);

    for (const c of claims) {
      await query(`INSERT INTO reimbursement_items (batch_id, claim_id, amount) VALUES ($1,$2,$3)`,
        [batch!.id, c.id, c.amount], client);
      await query(`UPDATE expense_claims SET status = 'paid', current_stage = NULL WHERE id = $1`, [c.id], client);
      await query(`INSERT INTO expense_approvals (claim_id, stage, actor_id, action, from_status, to_status, comment)
                   VALUES ($1,'finance',$2,'marked_paid','approved','paid',$3)`,
        [c.id, p.id, `Settled in batch ${code}.`], client);
      await notify({ userId: c.user_id, type: 'expense.paid', title: 'Expense reimbursed',
        body: `${c.expense_code} · ₹${Number(c.amount).toLocaleString('en-IN')} has been reimbursed (${code}).`,
        entityType: 'expense_claim', entityId: c.id, severity: 'success' }, client);
    }
    return { batchCode: code, count: claims.length, totalAmount: total,
             skipped: body.claimIds.length - claims.length };
  });

  await recordAudit(req, { action: 'expense.reimbursed', entityType: 'reimbursement_batch', after: result });
  res.json(result);
}));
