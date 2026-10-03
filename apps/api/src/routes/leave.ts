/**
 * Leave management.
 *
 * An employee applies; whoever may approve sees it as Pending immediately and
 * either approves or rejects it. An approved request makes the employee
 * "On Leave" for those dates — an entitled absence, which is deliberately not
 * the same thing as being absent, and which blocks new work being assigned.
 */
import { Router } from 'express';
import { z } from 'zod';
import { LEAVE_STATUS } from '@adisys/shared';
import { one, query, tx } from '../lib/db.js';
import { asyncHandler, dateString, offsetOf, pageMeta, paginationSchema, parse, uuid } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { can, principalOf, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { notify, type NotifyInput } from '../services/notifications.js';
import { scopeFor, userScopeClause } from '../services/scope.js';

export const leaveRouter = Router();

const SELECT_LEAVE = `
  SELECT lr.id, lr.request_code AS "requestCode",
         lr.user_id AS "userId", u.full_name AS "employeeName",
         u.employee_code AS "employeeCode", u.avatar_file_id AS "avatarFileId",
         lr.leave_type_id AS "leaveTypeId", lt.name AS "leaveTypeName", lt.key AS "leaveTypeKey",
         lr.from_date AS "fromDate", lr.to_date AS "toDate", lr.total_days AS "totalDays",
         lr.reason, lr.status,
         lr.decided_by AS "decidedBy", d.full_name AS "decidedByName",
         lr.decided_at AS "decidedAt", lr.decision_note AS "decisionNote",
         lr.created_at AS "createdAt"
    FROM leave_requests lr
    JOIN users u       ON u.id = lr.user_id
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    LEFT JOIN users d  ON d.id = lr.decided_by`;

/** Everyone who should hear about a request: the applicant's manager, plus every approver. */
async function approversFor(userId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.deleted_at IS NULL AND u.status = 'active' AND u.id <> $1
        AND (u.id = (SELECT reporting_manager_id FROM users WHERE id = $1)
             OR r.key IN ('super_admin','ops_manager'))`, [userId]);
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------
leaveRouter.get('/types', asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT id, key, name, description, is_paid AS "isPaid"
       FROM leave_types WHERE active ORDER BY sort_order, name`);
  res.json({ data: rows });
}));

/** The caller's own requests, grouped for the field app's tabs. */
leaveRouter.get('/mine', requirePermission('leave.apply'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const rows = await query(`${SELECT_LEAVE} WHERE lr.user_id = $1 ORDER BY lr.from_date DESC`, [p.id]);
  res.json({
    data: rows,
    counts: LEAVE_STATUS.values.reduce((acc, s) => {
      acc[s] = rows.filter((r: any) => r.status === s).length;
      return acc;
    }, {} as Record<string, number>),
  });
}));

leaveRouter.get('/', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  if (scopeFor(p, 'leave.view') === 'none') throw forbidden('You cannot view leave requests.');

  const f = parse(paginationSchema.extend({
    status: z.string().optional(),
    userId: uuid.optional(),
    from: dateString.optional(),
    to: dateString.optional(),
  }), req.query);

  const scope = userScopeClause(p, 'lr.user_id', 1, 'leave.view');
  const where: string[] = [scope.sql];
  const params: unknown[] = [...scope.params];
  const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace('$?', `$${params.length}`)); };

  if (f.status) add('lr.status = ANY($?)', f.status.split(','));
  if (f.userId) add('lr.user_id = $?', f.userId);
  // Overlap, not containment: a request spanning the window should appear in it.
  if (f.from) add('lr.to_date >= $?', f.from);
  if (f.to) add('lr.from_date <= $?', f.to);

  const clause = `WHERE ${where.join(' AND ')}`;
  const rows = await query(
    `${SELECT_LEAVE} ${clause}
      ORDER BY CASE lr.status WHEN 'pending' THEN 0 ELSE 1 END, lr.from_date DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.size, offsetOf(f.page, f.size)]);

  const total = await one<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM leave_requests lr ${clause}`, params);
  const pending = await one<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM leave_requests lr ${clause} AND lr.status = 'pending'`, params);

  res.json({ data: rows, page: pageMeta(f.page, f.size, total?.count ?? 0), pendingTotal: pending?.count ?? 0 });
}));

/** Everything overlapping a month, for the calendar. */
leaveRouter.get('/calendar', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  if (scopeFor(p, 'leave.view') === 'none') throw forbidden('You cannot view the leave calendar.');

  const { month } = parse(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM').optional(),
  }), req.query);
  const anchor = month ? `${month}-01` : new Date().toISOString().slice(0, 8) + '01';

  const scope = userScopeClause(p, 'lr.user_id', 1, 'leave.view');
  const rows = await query(
    `${SELECT_LEAVE}
      WHERE ${scope.sql}
        AND lr.status IN ('pending','approved')
        AND lr.from_date <= (date_trunc('month', $${scope.params.length + 1}::date)
                             + interval '1 month - 1 day')::date
        AND lr.to_date   >= date_trunc('month', $${scope.params.length + 1}::date)::date
      ORDER BY lr.from_date, u.full_name`,
    [...scope.params, anchor]);

  res.json({ month: anchor.slice(0, 7), data: rows });
}));

// ---------------------------------------------------------------------
const applySchema = z.object({
  leaveTypeId: uuid,
  fromDate: dateString,
  toDate: dateString,
  reason: z.string().trim().min(5, 'Give a short reason').max(500),
});

leaveRouter.post('/', requirePermission('leave.apply'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(applySchema, req.body);

  if (body.toDate < body.fromDate) {
    throw badRequest('The last day cannot be before the first day.', { toDate: ['Must be on or after the first day'] });
  }
  const type = await one<{ name: string }>(
    `SELECT name FROM leave_types WHERE id = $1 AND active`, [body.leaveTypeId]);
  if (!type) throw badRequest('Choose a leave type.', { leaveTypeId: ['Unknown leave type'] });

  const created = await tx(async (client) => {
    const code = (await one<{ c: string }>(
      `SELECT next_code('leave','LV',$1,4) AS c`, [String(new Date().getFullYear())], client))!.c;
    try {
      return await one<any>(
        `INSERT INTO leave_requests (request_code, user_id, leave_type_id, from_date, to_date, reason)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, request_code AS "requestCode", total_days AS "totalDays"`,
        [code, p.id, body.leaveTypeId, body.fromDate, body.toDate, body.reason], client);
    } catch (err: any) {
      // The exclusion constraint is the single source of truth on overlaps.
      if (err?.code === '23P01') {
        throw conflict('You already have a leave request covering some of those dates.', 'LEAVE_OVERLAP');
      }
      throw err;
    }
  });

  const recipients = await approversFor(p.id);
  await notify(recipients.map((userId): NotifyInput => ({
    userId, type: 'leave.applied', severity: 'warning',
    title: 'Leave request awaiting approval',
    body: `${p.fullName} applied for ${type.name}: ${body.fromDate} to ${body.toDate} (${created.totalDays} day${created.totalDays === 1 ? '' : 's'}).`,
    entityType: 'leave_request', entityId: created.id,
  })));

  await recordAudit(req, { action: 'leave.applied', entityType: 'leave_request', entityId: created.id,
    after: { ...body, status: 'pending' } });
  res.status(201).json({ ...created, status: 'pending' });
}));

/** Approve or reject. */
leaveRouter.post('/:id/decision', requirePermission('leave.approve'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(500).optional(),
  }), req.body);

  const result = await tx(async (client) => {
    const lr = await one<any>(
      `SELECT lr.*, lt.name AS type_name FROM leave_requests lr
         JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.id = $1 FOR UPDATE`, [req.params.id], client);
    if (!lr) throw notFound('Leave request');
    if (lr.status !== 'pending') {
      throw conflict(`This request is already ${LEAVE_STATUS.byValue[lr.status as 'approved'].label.toLowerCase()}.`,
        'LEAVE_ALREADY_DECIDED');
    }
    if (lr.user_id === p.id) throw forbidden('You cannot decide your own leave request.');

    const updated = await one<any>(
      `UPDATE leave_requests
          SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, updated_at = now()
        WHERE id = $1
        RETURNING id, request_code AS "requestCode", user_id, status, from_date, to_date, total_days`,
      [req.params.id, body.decision, p.id, body.note ?? null], client);
    return { ...updated, typeName: lr.type_name };
  });

  const approved = body.decision === 'approved';
  await notify({
    userId: result.user_id,
    type: approved ? 'leave.approved' : 'leave.rejected',
    severity: approved ? 'success' : 'critical',
    title: approved ? 'Leave approved' : 'Leave rejected',
    body: `${result.typeName}, ${result.from_date} to ${result.to_date}`
      + (body.note ? ` — ${body.note}` : ''),
    entityType: 'leave_request', entityId: result.id,
  });

  await recordAudit(req, { action: `leave.${body.decision}`, entityType: 'leave_request',
    entityId: result.id, before: { status: 'pending' }, after: { status: body.decision, note: body.note ?? null } });
  res.json({ ok: true, status: result.status });
}));

/**
 * Cancel a request.
 *
 * Two different acts share this route:
 *   - an employee withdrawing their OWN request while it is still pending;
 *   - an approver calling off a pending or already-approved one, because the
 *     work cannot be covered or the employee came back early.
 *
 * Cancelling an approved request releases those dates: the employee stops
 * being On Leave and work can be assigned on them again, so the employee is
 * told. A rejected request is already final and cannot be cancelled.
 */
leaveRouter.post('/:id/cancel', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({ note: z.string().trim().max(500).optional() }), req.body ?? {});

  const lr = await one<any>(
    `SELECT lr.user_id, lr.status, lr.from_date, lr.to_date, lt.name AS type_name
       FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.id = $1`, [req.params.id]);
  if (!lr) throw notFound('Leave request');

  const isOwner = lr.user_id === p.id;
  const isApprover = can(req, 'leave.approve');
  if (!isOwner && !isApprover) throw forbidden('This is not your leave request.');

  if (lr.status === 'cancelled') throw conflict('This request is already cancelled.', 'LEAVE_ALREADY_CANCELLED');
  if (lr.status === 'rejected') {
    throw conflict('A rejected request cannot be cancelled.', 'LEAVE_REJECTED');
  }
  if (lr.status === 'approved' && !isApprover) {
    throw forbidden('Approved leave can only be cancelled by an approver.');
  }

  // An approver's cancellation is attributable; an employee's own withdrawal
  // is not, which is what the 010 constraint allows for.
  const attribute = isApprover && !isOwner;
  // The casts matter: decided_by is null for a self-withdrawal, and Postgres
  // cannot infer a type for a bare null parameter.
  await query(
    `UPDATE leave_requests
        SET status = 'cancelled', updated_at = now(),
            decided_by = $2::uuid,
            decided_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END,
            decision_note = COALESCE($3::text, decision_note)
      WHERE id = $1::uuid`,
    [req.params.id, attribute ? p.id : null, body.note ?? null]);

  if (attribute) {
    await notify({
      userId: lr.user_id,
      type: 'leave.rejected',   // the closest existing channel: the leave will not happen
      severity: 'warning',
      title: lr.status === 'approved' ? 'Approved leave cancelled' : 'Leave request cancelled',
      body: `${lr.type_name}, ${lr.from_date} to ${lr.to_date}`
        + (body.note ? ` — ${body.note}` : ''),
      entityType: 'leave_request', entityId: req.params.id,
    });
  }

  await recordAudit(req, { action: 'leave.cancelled', entityType: 'leave_request', entityId: req.params.id,
    before: { status: lr.status }, after: { status: 'cancelled', note: body.note ?? null } });
  res.json({ ok: true, status: 'cancelled' });
}));
