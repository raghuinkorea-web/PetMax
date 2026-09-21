import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx, SqlBuilder } from '../lib/db.js';
import { asyncHandler, dateString, offsetOf, pageMeta, paginationSchema, parse, uuid } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { can, principalOf, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { assertProjectMembership, scopeFor, userScopeClause } from '../services/scope.js';

export const timeRouter = Router();

const settingsValue = async <T,>(scope: string, key: string, fallback: T): Promise<T> => {
  const row = await one<{ value: T }>(`SELECT value FROM settings WHERE scope = $1 AND key = $2`, [scope, key]);
  return row?.value ?? fallback;
};

// =====================================================================
// TIMER
// A run/resume cycle produces one closed segment per stretch of work, so
// elapsed time is always the sum of real segments. There is never a
// "still running since yesterday" entry inflating anyone's hours.
// =====================================================================

timeRouter.get('/timer', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const running = await one<any>(
    `SELECT t.id, t.assignment_id AS "assignmentId", t.project_id AS "projectId",
            t.started_at AS "startedAt", wa.title AS "assignmentTitle",
            wa.assignment_code AS "assignmentCode", pr.name AS "projectName"
       FROM time_entries t
       LEFT JOIN work_assignments wa ON wa.id = t.assignment_id
       LEFT JOIN projects pr ON pr.id = t.project_id
      WHERE t.user_id = $1 AND t.ended_at IS NULL`, [p.id]);

  const today = await one<{ recorded: number; verified: number }>(
    `SELECT COALESCE(SUM(duration_minutes),0)::int AS recorded,
            COALESCE(SUM(duration_minutes) FILTER (WHERE verification_status = 'verified'),0)::int AS verified
       FROM time_entries
      WHERE user_id = $1 AND work_date = CURRENT_DATE AND ended_at IS NOT NULL
        AND verification_status <> 'rejected'`, [p.id]);

  res.json({
    running: Boolean(running),
    entryId: running?.id ?? null,
    assignmentId: running?.assignmentId ?? null,
    assignmentTitle: running?.assignmentTitle ?? null,
    assignmentCode: running?.assignmentCode ?? null,
    projectId: running?.projectId ?? null,
    projectName: running?.projectName ?? null,
    startedAt: running?.startedAt ?? null,
    recordedMinutesToday: today?.recorded ?? 0,
    verifiedMinutesToday: today?.verified ?? 0,
  });
}));

timeRouter.post('/timer/start', requirePermission('time.log'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({ assignmentId: uuid, notes: z.string().trim().max(500).optional() }), req.body);

  const result = await tx(async (client) => {
    const open = await one<{ id: string }>(
      `SELECT id FROM time_entries WHERE user_id = $1 AND ended_at IS NULL FOR UPDATE`, [p.id], client);
    if (open) throw conflict('A timer is already running. Pause or stop it before starting another.', 'TIMER_RUNNING');

    const a = await one<{ project_id: string; status: string; assignee_id: string; title: string }>(
      `SELECT project_id, status, assignee_id, title FROM work_assignments
        WHERE id = $1 AND deleted_at IS NULL`, [body.assignmentId], client);
    if (!a) throw notFound('Assignment');
    if (a.assignee_id !== p.id) throw forbidden('You can only record time against your own assignments.');
    if (['completed', 'cancelled'].includes(a.status)) throw conflict('This assignment is closed.', 'ASSIGNMENT_CLOSED');
    if (a.status === 'assigned') {
      throw conflict('Acknowledge the assignment before starting work on it.', 'ACKNOWLEDGEMENT_REQUIRED');
    }
    await assertProjectMembership(p.id, a.project_id);

    const entry = await one<{ id: string; started_at: string }>(
      `INSERT INTO time_entries (user_id, assignment_id, project_id, work_date, started_at, source, notes)
       VALUES ($1,$2,$3,CURRENT_DATE, now(), 'timer', $4) RETURNING id, started_at`,
      [p.id, body.assignmentId, a.project_id, body.notes ?? null], client);

    // Starting the timer moves acknowledged work into progress.
    if (a.status === 'acknowledged' || a.status === 'on_hold') {
      await query(`UPDATE work_assignments SET status = 'in_progress',
                          progress_pct = GREATEST(progress_pct, 5) WHERE id = $1`, [body.assignmentId], client);
      await query(`INSERT INTO work_assignment_events (assignment_id, actor_id, event_type, from_status, to_status, note)
                   VALUES ($1,$2,'status_changed',$3,'in_progress','Employee started the work timer.')`,
        [body.assignmentId, p.id, a.status], client);
    }
    return entry!;
  });

  await recordAudit(req, { action: 'time.timer_started', entityType: 'time_entry', entityId: result.id,
    after: { assignmentId: body.assignmentId } });
  res.status(201).json({ entryId: result.id, startedAt: result.started_at, running: true });
}));

const stopTimer = async (req: any, close: 'pause' | 'stop') => {
  const p = principalOf(req);
  const body = parse(z.object({ notes: z.string().trim().max(500).optional() }), req.body ?? {});

  return tx(async (client) => {
    const open = await one<any>(
      `SELECT id, assignment_id, started_at FROM time_entries
        WHERE user_id = $1 AND ended_at IS NULL FOR UPDATE`, [p.id], client);
    if (!open) throw conflict('No timer is currently running.', 'NO_TIMER');

    const rules = await settingsValue('productivity', 'rules', { autoStopTimerAfterHours: 12 } as any);
    const elapsedH = (Date.now() - new Date(open.started_at).getTime()) / 3_600_000;
    const capped = elapsedH > (rules.autoStopTimerAfterHours ?? 12);

    const closed = await one<{ duration_minutes: number }>(
      `UPDATE time_entries
          SET ended_at = CASE WHEN $2::boolean
                              THEN started_at + make_interval(hours => $3::int)
                              ELSE now() END,
              notes = COALESCE($4, notes)
        WHERE id = $1 RETURNING duration_minutes`,
      [open.id, capped, Math.round(rules.autoStopTimerAfterHours ?? 12), body.notes ?? null], client);

    if (close === 'stop' && open.assignment_id) {
      await query(`UPDATE work_assignments SET status = 'on_hold'
                    WHERE id = $1 AND status = 'in_progress'`, [open.assignment_id], client);
    }
    return { entryId: open.id, durationMinutes: closed?.duration_minutes ?? 0, cappedAtLimit: capped };
  });
};

timeRouter.post('/timer/pause', requirePermission('time.log'), asyncHandler(async (req, res) => {
  const r = await stopTimer(req, 'pause');
  res.json({ ...r, running: false,
    message: r.cappedAtLimit ? 'The timer had run past the configured daily limit and was capped.' : undefined });
}));

timeRouter.post('/timer/stop', requirePermission('time.log'), asyncHandler(async (req, res) => {
  const r = await stopTimer(req, 'stop');
  await recordAudit(req, { action: 'time.timer_stopped', entityType: 'time_entry', entityId: r.entryId,
    after: { durationMinutes: r.durationMinutes } });
  res.json({ ...r, running: false });
}));

// =====================================================================
// MANUAL ENTRIES
// =====================================================================

const manualSchema = z.object({
  assignmentId: uuid.optional(),
  projectId: uuid,
  workDate: dateString,
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
  notes: z.string().trim().max(500).optional(),
});

timeRouter.post('/entries', requirePermission('time.log'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(manualSchema, req.body);
  if (body.endTime <= body.startTime) {
    throw badRequest('The end time must be after the start time.', { endTime: ['Must be after the start time'] });
  }

  const rules = await settingsValue('productivity', 'rules',
    { allowBackdatedEntryDays: 3, maxTimerHoursPerDay: 14 } as any);
  const ageDays = Math.floor((Date.now() - Date.parse(body.workDate)) / 86_400_000);
  if (ageDays > (rules.allowBackdatedEntryDays ?? 3)) {
    throw badRequest(
      `Time can only be recorded up to ${rules.allowBackdatedEntryDays} day(s) after the fact. Ask your manager to add it for you.`,
      { workDate: ['Outside the permitted back-dating window'] });
  }
  if (ageDays < 0) throw badRequest('Time cannot be recorded for a future date.', { workDate: ['Future date'] });

  await assertProjectMembership(p.id, body.projectId);
  if (body.assignmentId) {
    const a = await one<{ assignee_id: string; project_id: string; status: string }>(
      `SELECT assignee_id, project_id, status FROM work_assignments WHERE id = $1 AND deleted_at IS NULL`,
      [body.assignmentId]);
    if (!a) throw notFound('Assignment');
    if (a.assignee_id !== p.id) throw forbidden('You can only record time against your own assignments.');
    if (a.project_id !== body.projectId) throw badRequest('That assignment belongs to a different project.');
  }

  // Overlap check: the same person cannot be in two places at once.
  const overlap = await one<{ id: string }>(
    `SELECT id FROM time_entries
      WHERE user_id = $1 AND work_date = $2::date AND ended_at IS NOT NULL
        AND tstzrange(started_at, ended_at) && tstzrange(($2 || ' ' || $3)::timestamptz, ($2 || ' ' || $4)::timestamptz)`,
    [p.id, body.workDate, body.startTime, body.endTime]);
  if (overlap) throw conflict('This overlaps time you have already recorded for that day.', 'TIME_OVERLAP');

  const dayTotal = await one<{ minutes: number }>(
    `SELECT COALESCE(SUM(duration_minutes),0)::int AS minutes FROM time_entries
      WHERE user_id = $1 AND work_date = $2::date AND ended_at IS NOT NULL`, [p.id, body.workDate]);
  const newMinutes = (Date.parse(`1970-01-01T${body.endTime}:00Z`) - Date.parse(`1970-01-01T${body.startTime}:00Z`)) / 60000;
  if ((dayTotal?.minutes ?? 0) + newMinutes > (rules.maxTimerHoursPerDay ?? 14) * 60) {
    throw badRequest(`That would take this day past the ${rules.maxTimerHoursPerDay}-hour recording limit.`);
  }

  const entry = await one<any>(
    `INSERT INTO time_entries (user_id, assignment_id, project_id, work_date, started_at, ended_at, source, notes)
     VALUES ($1,$2,$3,$4::date, ($4 || ' ' || $5)::timestamptz, ($4 || ' ' || $6)::timestamptz, 'manual', $7)
     RETURNING id, duration_minutes AS "durationMinutes"`,
    [p.id, body.assignmentId ?? null, body.projectId, body.workDate, body.startTime, body.endTime, body.notes ?? null]);

  await recordAudit(req, { action: 'time.entry_created', entityType: 'time_entry', entityId: entry.id, after: body });
  res.status(201).json({ entry, note: 'Recorded. A manager must verify this before it counts as productive time.' });
}));

timeRouter.get('/entries', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const f = parse(paginationSchema.extend({
    userId: uuid.optional(), assignmentId: uuid.optional(), projectId: uuid.optional(),
    from: dateString.optional(), to: dateString.optional(),
    verification: z.enum(['unverified', 'verified', 'rejected']).optional(),
  }), req.query);

  const b = new SqlBuilder();
  b.add('t.ended_at IS NOT NULL');
  const scope = userScopeClause(p, 't.user_id', 1, 'productivity.view');
  b.add(scope.sql.replace(/\$\d+/g, '$?'), ...scope.params);
  b.addIf(f.userId, 't.user_id = $?', f.userId);
  b.addIf(f.assignmentId, 't.assignment_id = $?', f.assignmentId);
  b.addIf(f.projectId, 't.project_id = $?', f.projectId);
  b.addIf(f.from, 't.work_date >= $?::date', f.from);
  b.addIf(f.to, 't.work_date <= $?::date', f.to);
  b.addIf(f.verification, 't.verification_status = $?', f.verification);

  const rows = await query(
    `SELECT t.id, t.user_id AS "userId", u.full_name AS "userName",
            t.assignment_id AS "assignmentId", wa.assignment_code AS "assignmentCode", wa.title AS "assignmentTitle",
            t.project_id AS "projectId", pr.name AS "projectName",
            t.work_date AS "workDate", t.started_at AS "startedAt", t.ended_at AS "endedAt",
            t.duration_minutes AS "durationMinutes", t.source, t.notes,
            t.verification_status AS "verificationStatus", t.verification_note AS "verificationNote",
            v.full_name AS "verifiedByName", t.verified_at AS "verifiedAt"
       FROM time_entries t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN work_assignments wa ON wa.id = t.assignment_id
       LEFT JOIN projects pr ON pr.id = t.project_id
       LEFT JOIN users v ON v.id = t.verified_by
       ${b.where}
      ORDER BY t.work_date DESC, t.started_at DESC
      LIMIT $${b.next} OFFSET $${b.next + 1}`,
    [...b.params, f.size, offsetOf(f.page, f.size)]);

  const total = await one<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM time_entries t ${b.where}`, b.params);
  res.json({ data: rows, page: pageMeta(f.page, f.size, total?.count ?? 0) });
}));

/**
 * Manager verification. This is what turns recorded time into the
 * "productive hours" figure ADISYS reports — nothing else does.
 */
timeRouter.post('/entries/:id/verify', requirePermission('time.verify'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({
    decision: z.enum(['verify', 'reject']),
    note: z.string().trim().max(500).optional(),
  }).refine((v) => v.decision !== 'reject' || (v.note && v.note.length >= 5), {
    message: 'Record why this time is being discounted', path: ['note'],
  }), req.body);

  const entry = await one<{ user_id: string; project_id: string; manager_id: string }>(
    `SELECT t.user_id, t.project_id, pr.manager_id
       FROM time_entries t LEFT JOIN projects pr ON pr.id = t.project_id
      WHERE t.id = $1 AND t.ended_at IS NOT NULL`, [req.params.id]);
  if (!entry) throw notFound('Time entry');
  if (entry.user_id === p.id) throw forbidden('You cannot verify your own recorded time.');
  if (entry.manager_id !== p.id && !can(req, 'productivity.view.all')) {
    throw forbidden('Only the project manager can verify time on this project.');
  }

  await query(
    `UPDATE time_entries
        SET verification_status = $2, verified_by = $3, verified_at = now(), verification_note = $4
      WHERE id = $1`,
    [req.params.id, body.decision === 'verify' ? 'verified' : 'rejected', p.id, body.note ?? null]);

  await recordAudit(req, { action: `time.${body.decision}`, entityType: 'time_entry',
    entityId: req.params.id, after: { decision: body.decision, note: body.note } });
  res.json({ ok: true, verificationStatus: body.decision === 'verify' ? 'verified' : 'rejected' });
}));

timeRouter.post('/entries/verify-bulk', requirePermission('time.verify'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({
    entryIds: z.array(uuid).min(1).max(200),
    decision: z.enum(['verify', 'reject']),
    note: z.string().trim().max(500).optional(),
  }), req.body);

  const updated = await query<{ id: string }>(
    `UPDATE time_entries t
        SET verification_status = $2, verified_by = $3, verified_at = now(), verification_note = $4
       FROM projects pr
      WHERE t.id = ANY($1) AND t.project_id = pr.id AND t.ended_at IS NOT NULL
        AND t.user_id <> $3
        AND (pr.manager_id = $3 OR $5)
      RETURNING t.id`,
    [body.entryIds, body.decision === 'verify' ? 'verified' : 'rejected', p.id,
     body.note ?? null, can(req, 'productivity.view.all')]);

  await recordAudit(req, { action: `time.${body.decision}_bulk`, entityType: 'time_entry',
    after: { count: updated.length, decision: body.decision } });
  res.json({ count: updated.length, skipped: body.entryIds.length - updated.length });
}));

// =====================================================================
// ATTENDANCE — availability on duty, reported separately from work time.
// =====================================================================

timeRouter.get('/attendance/today', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const open = await one<any>(
    `SELECT id, check_in_at AS "checkInAt", work_date AS "workDate"
       FROM attendance_sessions WHERE user_id = $1 AND check_out_at IS NULL`, [p.id]);
  const today = await one<{ minutes: number }>(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (check_out_at - check_in_at))/60),0)::int AS minutes
       FROM attendance_sessions
      WHERE user_id = $1 AND work_date = CURRENT_DATE AND check_out_at IS NOT NULL`, [p.id]);
  res.json({
    onDuty: Boolean(open), sessionId: open?.id ?? null,
    checkInAt: open?.checkInAt ?? null, workDate: open?.workDate ?? null,
    attendanceMinutesToday: today?.minutes ?? 0,
  });
}));

const geoSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  accuracyM: z.coerce.number().min(0).max(10000).optional(),
  locationId: uuid.optional(),
  note: z.string().trim().max(300).optional(),
});

timeRouter.post('/attendance/check-in', requirePermission('attendance.record'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(geoSchema, req.body);

  const policy = await settingsValue('productivity', 'location_policy',
    { checkInLocationEnabled: true, requireExplicitConsent: true } as any);
  const user = await one<{ location_consent_at: string | null }>(
    `SELECT location_consent_at FROM users WHERE id = $1`, [p.id]);

  // Location is only ever stored with a recorded consent. Without it the
  // check-in still succeeds — it simply carries no coordinates.
  const mayStoreGeo = policy.checkInLocationEnabled &&
    (!policy.requireExplicitConsent || Boolean(user?.location_consent_at));
  const hasGeo = mayStoreGeo && body.latitude !== undefined && body.longitude !== undefined;

  const open = await one<{ id: string }>(
    `SELECT id FROM attendance_sessions WHERE user_id = $1 AND check_out_at IS NULL`, [p.id]);
  if (open) throw conflict('You are already checked in.', 'ALREADY_CHECKED_IN');

  const session = await one<any>(
    `INSERT INTO attendance_sessions
       (user_id, work_date, check_in_at, check_in_latitude, check_in_longitude,
        location_accuracy_m, location_consented, location_id, source, note)
     VALUES ($1, CURRENT_DATE, now(), $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, check_in_at AS "checkInAt"`,
    [p.id, hasGeo ? body.latitude : null, hasGeo ? body.longitude : null,
     hasGeo ? body.accuracyM ?? null : null, hasGeo, body.locationId ?? null,
     req.headers['x-client'] === 'android' ? 'android' : 'web', body.note ?? null]);

  await recordAudit(req, { action: 'attendance.check_in', entityType: 'attendance_session',
    entityId: session.id, after: { locationRecorded: hasGeo } });
  res.status(201).json({ ...session, onDuty: true, locationRecorded: hasGeo });
}));

timeRouter.post('/attendance/check-out', requirePermission('attendance.record'), asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(geoSchema, req.body);

  const result = await tx(async (client) => {
    const open = await one<any>(
      `SELECT id, location_consented FROM attendance_sessions
        WHERE user_id = $1 AND check_out_at IS NULL FOR UPDATE`, [p.id], client);
    if (!open) throw conflict('You are not currently checked in.', 'NOT_CHECKED_IN');

    const hasGeo = open.location_consented && body.latitude !== undefined && body.longitude !== undefined;
    const row = await one<any>(
      `UPDATE attendance_sessions
          SET check_out_at = now(), check_out_latitude = $2, check_out_longitude = $3
        WHERE id = $1
        RETURNING id, check_in_at AS "checkInAt", check_out_at AS "checkOutAt",
                  (EXTRACT(EPOCH FROM (check_out_at - check_in_at))/60)::int AS "durationMinutes"`,
      [open.id, hasGeo ? body.latitude : null, hasGeo ? body.longitude : null], client);

    // Checking out closes any timer left running.
    await query(`UPDATE time_entries SET ended_at = now() WHERE user_id = $1 AND ended_at IS NULL`,
      [p.id], client);
    return row!;
  });

  await recordAudit(req, { action: 'attendance.check_out', entityType: 'attendance_session', entityId: result.id });
  res.json({ ...result, onDuty: false });
}));

/** Explicit, revocable consent for check-in geotagging. */
timeRouter.post('/attendance/location-consent', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({ granted: z.boolean() }), req.body);
  await query(`UPDATE users SET location_consent_at = $2 WHERE id = $1`,
    [p.id, body.granted ? new Date().toISOString() : null]);
  await recordAudit(req, { action: 'attendance.location_consent', entityType: 'user',
    entityId: p.id, after: { granted: body.granted } });
  res.json({ granted: body.granted });
}));
