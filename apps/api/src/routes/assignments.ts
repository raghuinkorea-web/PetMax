import { Router } from 'express';
import { z } from 'zod';
import { WORK_TRANSITIONS, type WorkStatus } from '@adisys/shared';
import { one, query, tx, SqlBuilder } from '../lib/db.js';
import { asyncHandler, dateString, offsetOf, pageMeta, paginationSchema, parse, uuid } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { can, principalOf, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { notify } from '../services/notifications.js';
import { assertProjectMembership, scopeFor, userScopeClause } from '../services/scope.js';

export const assignmentRouter = Router();

// ---------------------------------------------------------------------
// Shared projection
// ---------------------------------------------------------------------
const SELECT_ASSIGNMENT = `
  SELECT wa.id, wa.assignment_code AS "assignmentCode", wa.title, wa.description,
         wa.project_id AS "projectId", p.name AS "projectName", p.project_code AS "projectCode",
         p.client_name AS "clientName",
         wa.assignee_id AS "assigneeId", u.full_name AS "assigneeName", u.employee_code AS "assigneeCode",
         wa.status, wa.priority, wa.version, wa.progress_pct AS "progressPct",
         wa.assignment_date AS "assignmentDate", wa.due_date AS "dueDate",
         wa.planned_start_at AS "plannedStartAt", wa.planned_end_at AS "plannedEndAt",
         wa.estimated_hours AS "estimatedHours",
         COALESCE(wl.name, wa.location_text) AS "locationText",
         wt.name AS "workTypeName", wa.instructions, wa.completion_notes AS "completionNotes",
         wa.review_comment AS "reviewComment",
         wa.submitted_at AS "submittedAt", wa.completed_at AS "completedAt",
         ab.full_name AS "assignedByName", rv.full_name AS "reviewedByName", wa.reviewed_at AS "reviewedAt",
         ack.decision AS "ackDecision", ack.acknowledged_at AS "ackAt",
         ack.acknowledged_version AS "ackVersion", COALESCE(ack.is_current, false) AS "ackCurrent",
         COALESCE(te.recorded, 0) AS "recordedMinutes",
         EXISTS (SELECT 1 FROM time_entries r
                  WHERE r.assignment_id = wa.id AND r.ended_at IS NULL) AS "timerRunning",
         (wa.due_date < CURRENT_DATE AND wa.status NOT IN ('completed','cancelled')) AS "isOverdue"
    FROM work_assignments wa
    JOIN projects p ON p.id = wa.project_id
    JOIN users u    ON u.id = wa.assignee_id
    JOIN users ab   ON ab.id = wa.assigned_by
    LEFT JOIN users rv        ON rv.id = wa.reviewed_by
    LEFT JOIN work_types wt   ON wt.id = wa.work_type_id
    LEFT JOIN work_locations wl ON wl.id = wa.location_id
    LEFT JOIN v_assignment_acknowledgement ack ON ack.assignment_id = wa.id
    LEFT JOIN LATERAL (
      SELECT SUM(duration_minutes) AS recorded FROM time_entries t
       WHERE t.assignment_id = wa.id AND t.ended_at IS NOT NULL AND t.verification_status <> 'rejected'
    ) te ON true`;

const shape = (r: any) => ({
  ...r,
  estimatedHours: r.estimatedHours === null ? null : Number(r.estimatedHours),
  recordedMinutes: Number(r.recordedMinutes ?? 0),
  acknowledgement: {
    isCurrent: r.ackCurrent,
    decision: r.ackDecision,
    acknowledgedAt: r.ackAt,
    acknowledgedVersion: r.ackVersion,
    // The employee acknowledged an earlier version — the work has changed since.
    changedSinceAck: Boolean(r.ackDecision === 'acknowledged' && r.ackVersion !== null && !r.ackCurrent),
  },
  ackCurrent: undefined, ackDecision: undefined, ackAt: undefined, ackVersion: undefined,
});

// ---------------------------------------------------------------------
// List
// ---------------------------------------------------------------------
const listSchema = paginationSchema.extend({
  view: z.enum(['today', 'tomorrow', 'this_week', 'next_week', 'overdue', 'pending_ack', 'all']).default('all'),
  status: z.string().optional(),
  projectId: uuid.optional(),
  assigneeId: uuid.optional(),
  priority: z.string().optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(['due_date', 'assignment_date', 'priority', 'status']).default('assignment_date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

assignmentRouter.get('/', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const f = parse(listSchema, req.query);
  if (scopeFor(p, 'work.view') === 'none') throw forbidden('You cannot view work assignments.');

  const b = new SqlBuilder();
  b.add('wa.deleted_at IS NULL');
  const scope = userScopeClause(p, 'wa.assignee_id', 1, 'work.view');
  // Managers also see assignments on projects they run, even when the
  // assignee does not report to them.
  if (scope.sql !== 'TRUE' && scope.sql !== 'FALSE') {
    b.add(`(${scope.sql.replace(/\$(\d+)/g, (_m, n) => `$?`)} OR wa.project_id IN (SELECT id FROM projects WHERE manager_id = $?))`,
      ...scope.params, p.id);
  } else {
    b.add(scope.sql);
  }

  b.addIf(f.projectId, 'wa.project_id = $?', f.projectId);
  b.addIf(f.assigneeId, 'wa.assignee_id = $?', f.assigneeId);
  b.addIf(f.status, 'wa.status = ANY($?)', f.status?.split(','));
  b.addIf(f.priority, 'wa.priority = ANY($?)', f.priority?.split(','));
  b.addIf(f.from, 'wa.assignment_date >= $?::date', f.from);
  b.addIf(f.to, 'wa.assignment_date <= $?::date', f.to);
  b.addIf(f.search, `(wa.title ILIKE $? OR wa.assignment_code ILIKE $? OR p.name ILIKE $?)`,
    `%${f.search}%`, `%${f.search}%`, `%${f.search}%`);

  switch (f.view) {
    case 'today':      b.add('wa.assignment_date = CURRENT_DATE'); break;
    case 'tomorrow':   b.add(`wa.assignment_date = CURRENT_DATE + 1`); break;
    case 'this_week':  b.add(`wa.assignment_date BETWEEN date_trunc('week', CURRENT_DATE)::date
                                                     AND date_trunc('week', CURRENT_DATE)::date + 6`); break;
    case 'next_week':  b.add(`wa.assignment_date BETWEEN date_trunc('week', CURRENT_DATE)::date + 7
                                                     AND date_trunc('week', CURRENT_DATE)::date + 13`); break;
    case 'overdue':    b.add(`wa.due_date < CURRENT_DATE AND wa.status NOT IN ('completed','cancelled')`); break;
    case 'pending_ack':b.add(`wa.status = 'assigned'`); break;
  }

  const order = {
    due_date: 'wa.due_date', assignment_date: 'wa.assignment_date',
    priority: `CASE wa.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`,
    status: 'wa.status',
  }[f.sort];

  const rows = await query(
    `${SELECT_ASSIGNMENT} ${b.where}
      ORDER BY ${order} ${f.dir === 'asc' ? 'ASC' : 'DESC'}, wa.created_at DESC
      LIMIT $${b.next} OFFSET $${b.next + 1}`,
    [...b.params, f.size, offsetOf(f.page, f.size)]);

  const total = await one<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM work_assignments wa
       JOIN projects p ON p.id = wa.project_id ${b.where}`, b.params);

  res.json({ data: rows.map(shape), page: pageMeta(f.page, f.size, total?.count ?? 0) });
}));

/**
 * The employee app's week view: assignments grouped by day, with a count
 * of what still needs acknowledgement on each day.
 */
assignmentRouter.get('/my-week', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const f = parse(z.object({ weekOf: dateString.optional() }), req.query);

  const rows = await query(
    `${SELECT_ASSIGNMENT}
      WHERE wa.deleted_at IS NULL AND wa.assignee_id = $1
        AND wa.assignment_date BETWEEN date_trunc('week', $2::date)::date
                                   AND date_trunc('week', $2::date)::date + 6
      ORDER BY wa.assignment_date,
               CASE wa.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC`,
    [p.id, f.weekOf ?? new Date().toISOString().slice(0, 10)]);

  const shaped = rows.map(shape);
  const days = new Map<string, any[]>();
  for (const a of shaped) {
    if (!days.has(a.assignmentDate)) days.set(a.assignmentDate, []);
    days.get(a.assignmentDate)!.push(a);
  }

  res.json({
    weekOf: f.weekOf ?? null,
    days: [...days.entries()].map(([date, items]) => ({
      date,
      total: items.length,
      pendingAcknowledgement: items.filter((i) => i.status === 'assigned').length,
      changedSinceAck: items.filter((i) => i.acknowledgement.changedSinceAck).length,
      completed: items.filter((i) => i.status === 'completed').length,
      items,
    })),
    summary: {
      total: shaped.length,
      pendingAcknowledgement: shaped.filter((i) => i.status === 'assigned').length,
      changedSinceAck: shaped.filter((i) => i.acknowledgement.changedSinceAck).length,
      inProgress: shaped.filter((i) => i.status === 'in_progress').length,
      completed: shaped.filter((i) => i.status === 'completed').length,
    },
  });
}));

// ---------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------
async function loadAssignment(req: any, id: string) {
  const p = principalOf(req);
  const rows = await query(`${SELECT_ASSIGNMENT} WHERE wa.id = $1 AND wa.deleted_at IS NULL`, [id]);
  const a = rows[0];
  if (!a) throw notFound('Assignment');

  const scope = scopeFor(p, 'work.view');
  if (scope === 'all') return a;
  if (a.assigneeId === p.id) return a;
  if (scope === 'team') {
    const ok = await one(
      `SELECT 1 AS ok FROM work_assignments wa
         JOIN projects pr ON pr.id = wa.project_id
        WHERE wa.id = $1
          AND (pr.manager_id = $2
               OR EXISTS (SELECT 1 FROM users u WHERE u.id = wa.assignee_id AND u.reporting_manager_id = $2))`,
      [id, p.id]);
    if (ok) return a;
  }
  throw notFound('Assignment');
}

assignmentRouter.get('/:id', asyncHandler(async (req, res) => {
  const a = await loadAssignment(req, req.params.id);
  const [events, acknowledgements, timeEntries, attachments] = await Promise.all([
    query(`SELECT e.id, e.event_type AS "eventType", e.from_status AS "fromStatus", e.to_status AS "toStatus",
                  e.note, e.changed_fields AS "changedFields", e.created_at AS "createdAt",
                  u.full_name AS "actorName"
             FROM work_assignment_events e LEFT JOIN users u ON u.id = e.actor_id
            WHERE e.assignment_id = $1 ORDER BY e.created_at DESC, e.id DESC`, [req.params.id]),
    query(`SELECT a.id, a.assignment_version AS "assignmentVersion", a.decision, a.mode, a.reason,
                  a.device_label AS "deviceLabel", a.acknowledged_at AS "acknowledgedAt", u.full_name AS "userName"
             FROM assignment_acknowledgements a JOIN users u ON u.id = a.user_id
            WHERE a.assignment_id = $1 ORDER BY a.assignment_version DESC`, [req.params.id]),
    query(`SELECT t.id, t.started_at AS "startedAt", t.ended_at AS "endedAt",
                  t.duration_minutes AS "durationMinutes", t.source, t.notes,
                  t.verification_status AS "verificationStatus", t.verification_note AS "verificationNote",
                  v.full_name AS "verifiedByName"
             FROM time_entries t LEFT JOIN users v ON v.id = t.verified_by
            WHERE t.assignment_id = $1 ORDER BY t.started_at DESC`, [req.params.id]),
    query(`SELECT wat.id, wat.file_id AS "fileId", wat.kind, f.original_name AS "originalName",
                  f.mime_type AS "mimeType", f.size_bytes AS "sizeBytes", wat.created_at AS "createdAt"
             FROM work_assignment_attachments wat JOIN files f ON f.id = wat.file_id
            WHERE wat.assignment_id = $1 ORDER BY wat.created_at`, [req.params.id]),
  ]);
  res.json({ assignment: shape(a), events, acknowledgements, timeEntries, attachments });
}));

// ---------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------
const createSchema = z.object({
  projectId: uuid,
  assigneeIds: z.array(uuid).min(1, 'Select at least one employee').max(50),
  title: z.string().trim().min(3, 'Give the task a clear title').max(180),
  description: z.string().trim().max(4000).optional(),
  workTypeId: uuid.optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  assignmentDate: dateString,
  dueDate: dateString,
  plannedStartAt: z.string().datetime().optional(),
  plannedEndAt: z.string().datetime().optional(),
  estimatedHours: z.coerce.number().positive().max(24).optional(),
  locationId: uuid.optional(),
  locationText: z.string().trim().max(200).optional(),
  instructions: z.string().trim().max(4000).optional(),
  /** Repeats the task on each working day of the range. */
  repeatUntil: dateString.optional(),
}).refine((v) => v.dueDate >= v.assignmentDate, {
  message: 'The due date cannot be before the assignment date', path: ['dueDate'],
});

assignmentRouter.post('/', requirePermission('work.create'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(createSchema, req.body);

  const project = await one<{ id: string; name: string; status: string; manager_id: string }>(
    `SELECT id, name, status, manager_id FROM projects WHERE id = $1 AND deleted_at IS NULL`,
    [body.projectId]);
  if (!project) throw notFound('Project');
  if (!['active', 'on_hold'].includes(project.status)) {
    throw badRequest(`Work cannot be assigned to a ${project.status.replace('_', ' ')} project.`);
  }
  if (project.manager_id !== p.id && !can(req, 'work.view.all')) {
    throw forbidden('You can only assign work on projects you manage.');
  }

  // Every assignee must be an active member of the project.
  for (const assigneeId of body.assigneeIds) {
    await assertProjectMembership(assigneeId, body.projectId);
  }

  const dates: string[] = [body.assignmentDate];
  if (body.repeatUntil) {
    if (body.repeatUntil < body.assignmentDate) throw badRequest('The repeat end date is before the start date.');
    const rows = await query<{ d: string }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS d
         FROM generate_series($1::date, $2::date, interval '1 day') d
        WHERE extract(isodow FROM d) <> 7`, [body.assignmentDate, body.repeatUntil]);
    if (rows.length > 60) throw badRequest('A recurring series may not exceed 60 occurrences.');
    dates.length = 0; dates.push(...rows.map((r) => r.d));
  }

  /*
   * Approved leave blocks work. The check runs across every assignee and every
   * generated date before a single row is written, so a repeating assignment
   * cannot half-succeed and leave someone with work on a day they are away.
   * The message names who and when, so the warning is actionable.
   */
  const clashes = await query<{ name: string; leave_date: string; type_name: string }>(
    `SELECT u.full_name AS name, to_char(ald.leave_date, 'YYYY-MM-DD') AS leave_date,
            ald.leave_type_name AS type_name
       FROM approved_leave_days ald
       JOIN users u ON u.id = ald.user_id
      WHERE ald.user_id = ANY($1::uuid[])
        AND ald.leave_date = ANY($2::date[])
      ORDER BY u.full_name, ald.leave_date`,
    [body.assigneeIds, dates]);

  if (clashes.length) {
    const byPerson = new Map<string, string[]>();
    for (const c of clashes) {
      if (!byPerson.has(c.name)) byPerson.set(c.name, []);
      byPerson.get(c.name)!.push(c.leave_date);
    }
    const detail = [...byPerson.entries()]
      .map(([name, ds]) => `${name} is on approved leave on ${ds.join(', ')}`)
      .join('; ');
    throw conflict(`Work cannot be assigned on approved leave dates. ${detail}.`, 'LEAVE_CONFLICT');
  }

  const created = await tx(async (client) => {
    const out: any[] = [];
    const dayOffset = (d: string) =>
      Math.round((Date.parse(d) - Date.parse(body.assignmentDate)) / 86_400_000);

    for (const date of dates) {
      for (const assigneeId of body.assigneeIds) {
        const code = (await one<{ c: string }>(`SELECT next_code('assignment','WRK') AS c`, [], client))!.c;
        const due = new Date(Date.parse(body.dueDate) + dayOffset(date) * 86_400_000)
          .toISOString().slice(0, 10);

        const row = await one<{ id: string }>(
          `INSERT INTO work_assignments
             (assignment_code, project_id, assignee_id, title, description, work_type_id, priority,
              assignment_date, due_date, planned_start_at, planned_end_at, estimated_hours,
              location_id, location_text, instructions, recurrence_rule, assigned_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
          [code, body.projectId, assigneeId, body.title, body.description ?? null, body.workTypeId ?? null,
           body.priority, date, due, body.plannedStartAt ?? null, body.plannedEndAt ?? null,
           body.estimatedHours ?? null, body.locationId ?? null, body.locationText ?? null,
           body.instructions ?? null, body.repeatUntil ? `DAILY;UNTIL=${body.repeatUntil}` : null, p.id],
          client);

        await query(`INSERT INTO work_assignment_events (assignment_id, actor_id, event_type, to_status, note)
                     VALUES ($1,$2,'created','assigned','Assignment issued to the employee.')`,
          [row!.id, p.id], client);

        await notify({
          userId: assigneeId, type: 'work.assigned', title: 'New work assigned',
          body: `${project.name} — ${body.title}. Due ${due}.`,
          entityType: 'work_assignment', entityId: row!.id, severity: 'info',
        }, client);

        out.push({ id: row!.id, assignmentCode: code, assigneeId, assignmentDate: date, dueDate: due });
      }
    }
    return out;
  });

  await recordAudit(req, {
    action: 'work.created', entityType: 'work_assignment',
    entityId: created[0]?.id, after: { count: created.length, title: body.title, projectId: body.projectId },
  });
  res.status(201).json({ created, count: created.length });
}));

// ---------------------------------------------------------------------
// Edit — bumps `version`, which invalidates any existing acknowledgement.
// ---------------------------------------------------------------------
const MATERIAL_FIELDS = ['title', 'description', 'dueDate', 'assignmentDate', 'instructions',
                         'estimatedHours', 'priority', 'locationText', 'plannedStartAt', 'plannedEndAt'] as const;

const updateSchema = z.object({
  title: z.string().trim().min(3).max(180).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignmentDate: dateString.optional(),
  dueDate: dateString.optional(),
  plannedStartAt: z.string().datetime().nullable().optional(),
  plannedEndAt: z.string().datetime().nullable().optional(),
  estimatedHours: z.coerce.number().positive().max(24).nullable().optional(),
  locationId: uuid.nullable().optional(),
  locationText: z.string().trim().max(200).nullable().optional(),
  instructions: z.string().trim().max(4000).nullable().optional(),
  assigneeId: uuid.optional(),
});

assignmentRouter.patch('/:id', requirePermission('work.update'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(updateSchema, req.body);
  const before = await loadAssignment(req, req.params.id);

  if (['completed', 'cancelled'].includes(before.status)) {
    throw conflict(`A ${before.status} assignment can no longer be edited.`, 'ASSIGNMENT_CLOSED');
  }
  if (body.assigneeId && body.assigneeId !== before.assigneeId) {
    await assertProjectMembership(body.assigneeId, before.projectId);
  }

  const columnFor: Record<string, string> = {
    title: 'title', description: 'description', priority: 'priority',
    assignmentDate: 'assignment_date', dueDate: 'due_date',
    plannedStartAt: 'planned_start_at', plannedEndAt: 'planned_end_at',
    estimatedHours: 'estimated_hours', locationId: 'location_id',
    locationText: 'location_text', instructions: 'instructions', assigneeId: 'assignee_id',
  };

  const sets: string[] = [];
  const params: unknown[] = [];
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    const prev = (before as any)[key];
    if (String(prev ?? '') === String(value ?? '')) continue;
    params.push(value);
    sets.push(`${columnFor[key]} = $${params.length}`);
    changed[key] = { from: prev ?? null, to: value };
  }
  if (!sets.length) return res.json({ assignment: shape(before), changed: {} });

  // Any change to the substance of the work invalidates the acknowledgement.
  const material = Object.keys(changed).some((k) => (MATERIAL_FIELDS as readonly string[]).includes(k))
                   || 'assigneeId' in changed;
  if (material) sets.push('version = version + 1');
  if ('assigneeId' in changed) sets.push(`status = 'assigned'`);

  const updated = await tx(async (client) => {
    params.push(req.params.id);
    const row = await one<{ id: string; version: number; assignee_id: string }>(
      `UPDATE work_assignments SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, version, assignee_id`, params, client);

    await query(`INSERT INTO work_assignment_events (assignment_id, actor_id, event_type, changed_fields, note)
                 VALUES ($1,$2,'edited',$3,$4)`,
      [req.params.id, p.id, JSON.stringify(changed),
       material ? 'Assignment changed — the employee must acknowledge the new version.' : 'Assignment details updated.'],
      client);

    if (material) {
      await notify({
        userId: row!.assignee_id, type: 'work.updated', title: 'Assignment changed',
        body: `${before.assignmentCode} has changed and needs your acknowledgement again.`,
        entityType: 'work_assignment', entityId: req.params.id, severity: 'warning',
      }, client);
    }
    return row!;
  });

  await recordAudit(req, {
    action: 'work.updated', entityType: 'work_assignment', entityId: req.params.id,
    before: changed && Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
    after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
  });

  const after = await loadAssignment(req, req.params.id);
  res.json({ assignment: shape(after), changed, acknowledgementReset: material, version: updated.version });
}));

// =====================================================================
// ACKNOWLEDGEMENT
//
// Acknowledgement means "I have received and reviewed this assignment".
// It never marks work as done, and it is always recorded against the
// exact assignment VERSION the employee saw.
// =====================================================================

const ackSchema = z.object({
  decision: z.enum(['acknowledged', 'clarification_requested']).default('acknowledged'),
  reason: z.string().trim().max(1000).optional(),
  deviceLabel: z.string().trim().max(120).optional(),
}).refine((v) => v.decision !== 'clarification_requested' || (v.reason && v.reason.length >= 5), {
  message: 'Tell your manager what needs clarifying', path: ['reason'],
});

async function acknowledgeOne(
  client: any, req: any, assignmentId: string,
  decision: 'acknowledged' | 'clarification_requested',
  mode: 'individual' | 'bulk_daily' | 'bulk_weekly',
  reason: string | null, deviceLabel: string | null,
) {
  const p = principalOf(req);
  const a = await one<{ id: string; assignment_code: string; version: number; status: WorkStatus;
                        assignee_id: string; project_id: string; title: string }>(
    `SELECT id, assignment_code, version, status, assignee_id, project_id, title
       FROM work_assignments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [assignmentId], client);

  if (!a) throw notFound('Assignment');
  if (a.assignee_id !== p.id) throw forbidden('You can only acknowledge work assigned to you.');
  if (['completed', 'cancelled'].includes(a.status)) {
    throw conflict('This assignment is closed and cannot be acknowledged.', 'ASSIGNMENT_CLOSED');
  }

  const existing = await one<{ decision: string }>(
    `SELECT decision FROM assignment_acknowledgements
      WHERE assignment_id = $1 AND assignment_version = $2`, [a.id, a.version], client);
  if (existing?.decision === 'acknowledged') {
    return { id: a.id, assignmentCode: a.assignment_code, alreadyAcknowledged: true };
  }

  await query(
    `INSERT INTO assignment_acknowledgements
       (assignment_id, user_id, assignment_version, decision, mode, reason, device_label, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (assignment_id, assignment_version)
     DO UPDATE SET decision = EXCLUDED.decision, reason = EXCLUDED.reason,
                   acknowledged_at = now(), mode = EXCLUDED.mode`,
    [a.id, p.id, a.version, decision, mode, reason, deviceLabel,
     (req.ip ?? '').replace('::ffff:', '') || null], client);

  // Acknowledging moves 'assigned' to 'acknowledged'. Work already in
  // progress keeps its status — re-acknowledging a changed assignment
  // must not rewind the employee's progress.
  const nextStatus: WorkStatus =
    decision === 'clarification_requested' ? 'clarification_requested'
    : a.status === 'assigned' || a.status === 'clarification_requested' ? 'acknowledged'
    : a.status;

  if (nextStatus !== a.status) {
    await query(`UPDATE work_assignments SET status = $2 WHERE id = $1`, [a.id, nextStatus], client);
  }
  await query(
    `INSERT INTO work_assignment_events (assignment_id, actor_id, event_type, from_status, to_status, note)
     VALUES ($1,$2,'status_changed',$3,$4,$5)`,
    [a.id, p.id, a.status, nextStatus,
     decision === 'acknowledged'
       ? `Employee acknowledged version ${a.version} (${mode.replace('_', ' ')}).`
       : `Employee requested clarification: ${reason}`], client);

  if (decision === 'clarification_requested') {
    const mgr = await one<{ manager_id: string }>(
      `SELECT manager_id FROM projects WHERE id = $1`, [a.project_id], client);
    if (mgr) {
      await notify({
        userId: mgr.manager_id, type: 'work.returned', title: 'Clarification requested',
        body: `${p.fullName} needs clarification on ${a.assignment_code}: ${reason}`,
        entityType: 'work_assignment', entityId: a.id, severity: 'warning',
      }, client);
    }
  }

  return { id: a.id, assignmentCode: a.assignment_code, version: a.version,
           status: nextStatus, alreadyAcknowledged: false };
}

assignmentRouter.post('/:id/acknowledge', requirePermission('work.acknowledge'),
  asyncHandler(async (req, res) => {
    const body = parse(ackSchema, req.body);
    const result = await tx((client) =>
      acknowledgeOne(client, req, req.params.id, body.decision, 'individual',
        body.reason ?? null, body.deviceLabel ?? null));
    await recordAudit(req, {
      action: `work.${body.decision}`, entityType: 'work_assignment', entityId: req.params.id,
      after: { decision: body.decision, version: result.version },
    });
    res.json(result);
  }));

/**
 * Bulk acknowledgement for a day or a week.
 *
 * Deliberately NOT a blanket "mark everything done":
 *   • only assignments still awaiting acknowledgement are affected,
 *   • each one is recorded individually against its own version,
 *   • the response reports exactly what was and was not acknowledged.
 */
const bulkAckSchema = z.object({
  scope: z.enum(['day', 'week']),
  date: dateString,
  assignmentIds: z.array(uuid).max(200).optional(),
  deviceLabel: z.string().trim().max(120).optional(),
});

assignmentRouter.post('/acknowledge-bulk', requirePermission('work.acknowledge'),
  asyncHandler(async (req, res) => {
    const p = principalOf(req);
    const body = parse(bulkAckSchema, req.body);

    const range = body.scope === 'day'
      ? { from: body.date, to: body.date }
      : { from: `date_trunc('week', $2::date)::date`, to: `date_trunc('week', $2::date)::date + 6` };

    const candidates = await query<{ id: string }>(
      body.scope === 'day'
        ? `SELECT id FROM work_assignments
            WHERE assignee_id = $1 AND assignment_date = $2::date AND deleted_at IS NULL
              AND status NOT IN ('completed','cancelled')
              AND NOT EXISTS (SELECT 1 FROM assignment_acknowledgements a
                               WHERE a.assignment_id = work_assignments.id
                                 AND a.assignment_version = work_assignments.version
                                 AND a.decision = 'acknowledged')
            ORDER BY assignment_date`
        : `SELECT id FROM work_assignments
            WHERE assignee_id = $1 AND deleted_at IS NULL
              AND assignment_date BETWEEN ${range.from} AND ${range.to}
              AND status NOT IN ('completed','cancelled')
              AND NOT EXISTS (SELECT 1 FROM assignment_acknowledgements a
                               WHERE a.assignment_id = work_assignments.id
                                 AND a.assignment_version = work_assignments.version
                                 AND a.decision = 'acknowledged')
            ORDER BY assignment_date`,
      [p.id, body.date]);

    let ids = candidates.map((c) => c.id);
    if (body.assignmentIds?.length) {
      const allowed = new Set(ids);
      ids = body.assignmentIds.filter((id) => allowed.has(id));
    }

    if (!ids.length) {
      return res.json({ acknowledged: [], count: 0,
        message: 'Everything in this period is already acknowledged.' });
    }

    const acknowledged = await tx(async (client) => {
      const out = [];
      for (const id of ids) {
        out.push(await acknowledgeOne(client, req, id, 'acknowledged',
          body.scope === 'day' ? 'bulk_daily' : 'bulk_weekly', null, body.deviceLabel ?? null));
      }
      return out;
    });

    await recordAudit(req, {
      action: 'work.acknowledged_bulk', entityType: 'work_assignment',
      after: { scope: body.scope, date: body.date, count: acknowledged.length, ids },
    });

    res.json({
      acknowledged, count: acknowledged.length,
      message: `${acknowledged.length} assignment${acknowledged.length === 1 ? '' : 's'} acknowledged. ` +
               'Acknowledgement confirms receipt — the work still needs to be completed.',
    });
  }));

/** Preview for the confirmation screen shown before a bulk acknowledgement. */
assignmentRouter.get('/acknowledge-bulk/preview', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const f = parse(z.object({ scope: z.enum(['day', 'week']), date: dateString }), req.query);

  const where = f.scope === 'day'
    ? `wa.assignment_date = $2::date`
    : `wa.assignment_date BETWEEN date_trunc('week', $2::date)::date AND date_trunc('week', $2::date)::date + 6`;

  const rows = await query(
    `${SELECT_ASSIGNMENT}
      WHERE wa.deleted_at IS NULL AND wa.assignee_id = $1 AND ${where}
        AND wa.status NOT IN ('completed','cancelled')
      ORDER BY wa.assignment_date, wa.due_date`, [p.id, f.date]);

  const shaped = rows.map(shape);
  const pending = shaped.filter((a) => !a.acknowledgement.isCurrent);
  res.json({
    scope: f.scope, date: f.date,
    pending, pendingCount: pending.length,
    alreadyAcknowledged: shaped.length - pending.length,
    changedSinceAck: shaped.filter((a) => a.acknowledgement.changedSinceAck).length,
    totalEstimatedHours: pending.reduce((s, a) => s + Number(a.estimatedHours ?? 0), 0),
  });
}));

// =====================================================================
// STATUS TRANSITIONS
// =====================================================================

const transitionSchema = z.object({
  status: z.enum(['in_progress', 'on_hold', 'submitted', 'cancelled']),
  note: z.string().trim().max(1000).optional(),
  progressPct: z.coerce.number().int().min(0).max(100).optional(),
});

assignmentRouter.post('/:id/status', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(transitionSchema, req.body);

  const result = await tx(async (client) => {
    const a = await one<any>(
      `SELECT wa.*, pr.manager_id, pr.name AS project_name
         FROM work_assignments wa JOIN projects pr ON pr.id = wa.project_id
        WHERE wa.id = $1 AND wa.deleted_at IS NULL FOR UPDATE OF wa`, [req.params.id], client);
    if (!a) throw notFound('Assignment');

    const isAssignee = a.assignee_id === p.id;
    const isManager = a.manager_id === p.id || can(req, 'work.view.all');
    if (body.status === 'cancelled') {
      if (!isManager || !can(req, 'work.cancel')) throw forbidden('Only the project manager can cancel an assignment.');
    } else if (!isAssignee) {
      throw forbidden('Only the assigned employee can update the progress of this work.');
    }

    const allowed = WORK_TRANSITIONS[a.status as WorkStatus] ?? [];
    if (!allowed.includes(body.status)) {
      throw conflict(
        `An assignment that is "${a.status.replace('_', ' ')}" cannot move to "${body.status.replace('_', ' ')}".`,
        'INVALID_TRANSITION');
    }
    if (body.status === 'in_progress' && !a.status.match(/acknowledged|on_hold|clarification_requested/)) {
      throw conflict('Acknowledge the assignment before starting work on it.', 'ACKNOWLEDGEMENT_REQUIRED');
    }

    const progress = body.status === 'submitted' ? 100
      : body.progressPct ?? (body.status === 'in_progress' ? Math.max(a.progress_pct, 5) : a.progress_pct);

    await query(
      `UPDATE work_assignments
          SET status = $2, progress_pct = $3,
              submitted_at = CASE WHEN $2 = 'submitted' THEN now() ELSE submitted_at END,
              completion_notes = COALESCE($4, completion_notes)
        WHERE id = $1`,
      [a.id, body.status, progress, body.status === 'submitted' ? (body.note ?? null) : null], client);

    // Stopping or pausing work closes any running timer for this task.
    if (['on_hold', 'submitted', 'cancelled'].includes(body.status)) {
      await query(
        `UPDATE time_entries SET ended_at = now()
          WHERE assignment_id = $1 AND user_id = $2 AND ended_at IS NULL`, [a.id, p.id], client);
    }

    await query(
      `INSERT INTO work_assignment_events (assignment_id, actor_id, event_type, from_status, to_status, note)
       VALUES ($1,$2,'status_changed',$3,$4,$5)`,
      [a.id, p.id, a.status, body.status, body.note ?? null], client);

    if (body.status === 'submitted') {
      await notify({
        userId: a.manager_id, type: 'work.completed', title: 'Work submitted for review',
        body: `${p.fullName} submitted ${a.assignment_code} — ${a.title}.`,
        entityType: 'work_assignment', entityId: a.id, severity: 'info',
      }, client);
    }
    if (body.status === 'cancelled') {
      await notify({
        userId: a.assignee_id, type: 'work.updated', title: 'Assignment cancelled',
        body: `${a.assignment_code} has been cancelled${body.note ? `: ${body.note}` : '.'}`,
        entityType: 'work_assignment', entityId: a.id, severity: 'warning',
      }, client);
    }
    return { from: a.status, to: body.status, progressPct: progress };
  });

  await recordAudit(req, {
    action: `work.${body.status}`, entityType: 'work_assignment', entityId: req.params.id,
    before: { status: result.from }, after: { status: result.to },
  });
  res.json({ ...result, assignment: shape(await loadAssignment(req, req.params.id)) });
}));

/** Progress update without a status change. */
assignmentRouter.post('/:id/progress', requirePermission('work.progress'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({
    progressPct: z.coerce.number().int().min(0).max(100),
    note: z.string().trim().max(1000).optional(),
  }), req.body);

  const a = await one<{ assignee_id: string; status: string; progress_pct: number }>(
    `SELECT assignee_id, status, progress_pct FROM work_assignments
      WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
  if (!a) throw notFound('Assignment');
  if (a.assignee_id !== p.id) throw forbidden('You can only update progress on your own work.');
  if (['completed', 'cancelled'].includes(a.status)) throw conflict('This assignment is closed.', 'ASSIGNMENT_CLOSED');

  await tx(async (client) => {
    await query(`UPDATE work_assignments SET progress_pct = $2 WHERE id = $1`,
      [req.params.id, body.progressPct], client);
    await query(`INSERT INTO work_assignment_events (assignment_id, actor_id, event_type, note, changed_fields)
                 VALUES ($1,$2,'progress_updated',$3,$4)`,
      [req.params.id, p.id, body.note ?? null,
       JSON.stringify({ progressPct: { from: a.progress_pct, to: body.progressPct } })], client);
  });
  res.json({ progressPct: body.progressPct });
}));

/** Manager review: accept the completed work, or return it for clarification. */
assignmentRouter.post('/:id/review', requirePermission('work.review'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({
    decision: z.enum(['accept', 'return']),
    comment: z.string().trim().max(1000).optional(),
  }).refine((v) => v.decision !== 'return' || (v.comment && v.comment.length >= 5), {
    message: 'Explain what the employee needs to clarify', path: ['comment'],
  }), req.body);

  const result = await tx(async (client) => {
    const a = await one<any>(
      `SELECT wa.*, pr.manager_id FROM work_assignments wa JOIN projects pr ON pr.id = wa.project_id
        WHERE wa.id = $1 AND wa.deleted_at IS NULL FOR UPDATE OF wa`, [req.params.id], client);
    if (!a) throw notFound('Assignment');
    if (a.manager_id !== p.id && !can(req, 'work.view.all')) {
      throw forbidden('Only the project manager can review this work.');
    }
    if (a.status !== 'submitted') {
      throw conflict('Only work that has been submitted for review can be reviewed.', 'NOT_SUBMITTED');
    }

    const to: WorkStatus = body.decision === 'accept' ? 'completed' : 'clarification_requested';
    await query(
      `UPDATE work_assignments
          SET status = $2, reviewed_by = $3, reviewed_at = now(), review_comment = $4,
              completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END,
              progress_pct = CASE WHEN $2 = 'completed' THEN 100 ELSE progress_pct END
        WHERE id = $1`, [a.id, to, p.id, body.comment ?? null], client);

    await query(`INSERT INTO work_assignment_events (assignment_id, actor_id, event_type, from_status, to_status, note)
                 VALUES ($1,$2,'reviewed','submitted',$3,$4)`,
      [a.id, p.id, to, body.comment ?? null], client);

    await notify({
      userId: a.assignee_id,
      type: body.decision === 'accept' ? 'work.completed' : 'work.returned',
      title: body.decision === 'accept' ? 'Work accepted' : 'Work returned for clarification',
      body: body.decision === 'accept'
        ? `${a.assignment_code} has been accepted as complete.`
        : `${a.assignment_code} needs clarification: ${body.comment}`,
      entityType: 'work_assignment', entityId: a.id,
      severity: body.decision === 'accept' ? 'success' : 'warning',
    }, client);

    return { status: to };
  });

  await recordAudit(req, {
    action: `work.review_${body.decision}`, entityType: 'work_assignment', entityId: req.params.id,
    after: { status: result.status, comment: body.comment },
  });
  res.json({ ...result, assignment: shape(await loadAssignment(req, req.params.id)) });
}));
