import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { one, pool, query } from '../src/lib/db.js';
import { seedFixture, tokenFor, type Fixture } from './fixtures.js';

const app = createApp();
let f: Fixture;
const t: Record<string, string> = {};
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  f = await seedFixture();
  for (const who of ['admin', 'manager', 'employee', 'other'] as const) {
    t[who] = await tokenFor(app, f[who]);
  }
});
afterAll(async () => { await pool.end(); });

async function acknowledgedAssignment() {
  const created = await request(app).post('/api/assignments').set('Authorization', t.manager!)
    .send({
      projectId: f.project, assigneeIds: [f.employee], title: 'Timed task',
      assignmentDate: today(), dueDate: today(), estimatedHours: 4,
    });
  const id = created.body.created[0].id as string;
  await request(app).post(`/api/assignments/${id}/acknowledge`)
    .set('Authorization', t.employee!).send({ decision: 'acknowledged' });
  return id;
}

describe('time recording', () => {
  it('runs one timer at a time and closes it into a measurable segment', async () => {
    const id = await acknowledgedAssignment();

    const start = await request(app).post('/api/time/timer/start')
      .set('Authorization', t.employee!).send({ assignmentId: id });
    expect(start.status).toBe(201);

    const second = await request(app).post('/api/time/timer/start')
      .set('Authorization', t.employee!).send({ assignmentId: id });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('TIMER_RUNNING');

    const stop = await request(app).post('/api/time/timer/stop')
      .set('Authorization', t.employee!).send({});
    expect(stop.status).toBe(200);
    expect(stop.body.running).toBe(false);

    const noTimer = await request(app).post('/api/time/timer/stop')
      .set('Authorization', t.employee!).send({});
    expect(noTimer.status).toBe(409);
    expect(noTimer.body.error.code).toBe('NO_TIMER');
  });

  it('moves acknowledged work into progress when the timer starts', async () => {
    const id = await acknowledgedAssignment();
    await request(app).post('/api/time/timer/start')
      .set('Authorization', t.employee!).send({ assignmentId: id });

    const detail = await request(app).get(`/api/assignments/${id}`).set('Authorization', t.employee!);
    expect(detail.body.assignment.status).toBe('in_progress');
    await request(app).post('/api/time/timer/stop').set('Authorization', t.employee!).send({});
  });

  it('refuses time recorded against someone else\'s assignment', async () => {
    const id = await acknowledgedAssignment();
    const res = await request(app).post('/api/time/timer/start')
      .set('Authorization', t.other!).send({ assignmentId: id });
    expect(res.status).toBe(403);
  });

  it('rejects an overlapping manual entry', async () => {
    const id = await acknowledgedAssignment();
    // Yesterday, so the window cannot collide with timer segments other
    // tests created at the current clock time.
    const base = {
      assignmentId: id, projectId: f.project, workDate: yesterday(),
      startTime: '09:00', endTime: '11:00',
    };
    expect((await request(app).post('/api/time/entries')
      .set('Authorization', t.employee!).send(base)).status).toBe(201);

    const overlap = await request(app).post('/api/time/entries')
      .set('Authorization', t.employee!).send({ ...base, startTime: '10:00', endTime: '12:00' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('TIME_OVERLAP');
  });

  it('rejects an end time before the start, and back-dating beyond the window', async () => {
    const id = await acknowledgedAssignment();
    const backwards = await request(app).post('/api/time/entries').set('Authorization', t.employee!)
      .send({ assignmentId: id, projectId: f.project, workDate: today(),
              startTime: '15:00', endTime: '14:00' });
    expect(backwards.status).toBe(400);

    const old = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const tooOld = await request(app).post('/api/time/entries').set('Authorization', t.employee!)
      .send({ assignmentId: id, projectId: f.project, workDate: old,
              startTime: '09:00', endTime: '10:00' });
    expect(tooOld.status).toBe(400);
    expect(tooOld.body.error.details.workDate).toBeDefined();
  });
});

describe('productive hours', () => {
  it('counts ONLY manager-verified time as productive', async () => {
    const id = await acknowledgedAssignment();
    await request(app).post('/api/time/entries').set('Authorization', t.employee!)
      .send({ assignmentId: id, projectId: f.project, workDate: today(),
              startTime: '13:00', endTime: '17:00' });

    const entryId = (await one<{ id: string }>(
      `SELECT id FROM time_entries WHERE assignment_id = $1 AND source = 'manual'`, [id]))!.id;

    const before = await request(app).get('/api/reports/productivity/summary')
      .set('Authorization', t.admin!).query({ from: today(), to: today(), employeeId: f.employee });
    const beforeRow = before.body.rows[0];
    expect(Number(beforeRow.recordedMinutes)).toBeGreaterThanOrEqual(240);
    // Recorded, but nobody has verified it — so it is NOT productive time.
    expect(Number(beforeRow.verifiedMinutes)).toBe(0);

    await request(app).post(`/api/time/entries/${entryId}/verify`)
      .set('Authorization', t.manager!).send({ decision: 'verify' });

    const after = await request(app).get('/api/reports/productivity/summary')
      .set('Authorization', t.admin!).query({ from: today(), to: today(), employeeId: f.employee });
    expect(Number(after.body.rows[0].verifiedMinutes)).toBeGreaterThanOrEqual(240);
  });

  it('never lets anyone verify their own recorded time', async () => {
    const id = await acknowledgedAssignment();
    await request(app).post('/api/time/entries').set('Authorization', t.employee!)
      .send({ assignmentId: id, projectId: f.project, workDate: today(),
              startTime: '18:00', endTime: '19:00' });
    const entryId = (await one<{ id: string }>(
      `SELECT id FROM time_entries WHERE assignment_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]))!.id;

    await query(`INSERT INTO user_permission_overrides (user_id, permission_id, effect)
                 SELECT $1, id, 'allow' FROM permissions WHERE key = 'time.verify'`, [f.employee]);
    const token = await tokenFor(app, f.employee);

    const res = await request(app).post(`/api/time/entries/${entryId}/verify`)
      .set('Authorization', token).send({ decision: 'verify' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/your own/i);

    await query(`DELETE FROM user_permission_overrides WHERE user_id = $1`, [f.employee]);
  });

  it('excludes discounted time from productive hours but keeps the record', async () => {
    const id = await acknowledgedAssignment();
    await request(app).post('/api/time/entries').set('Authorization', t.employee!)
      .send({ assignmentId: id, projectId: f.project, workDate: today(),
              startTime: '20:00', endTime: '22:00' });
    const entryId = (await one<{ id: string }>(
      `SELECT id FROM time_entries WHERE assignment_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]))!.id;

    const noReason = await request(app).post(`/api/time/entries/${entryId}/verify`)
      .set('Authorization', t.manager!).send({ decision: 'reject' });
    expect(noReason.status).toBe(422);

    const rejected = await request(app).post(`/api/time/entries/${entryId}/verify`)
      .set('Authorization', t.manager!)
      .send({ decision: 'reject', note: 'Overlaps another entry for the same hour.' });
    expect(rejected.status).toBe(200);

    const row = await one<{ verification_status: string; verification_note: string; duration_minutes: number }>(
      `SELECT verification_status, verification_note, duration_minutes FROM time_entries WHERE id = $1`,
      [entryId]);
    // The entry survives with its reason; it simply stops counting.
    expect(row!.verification_status).toBe('rejected');
    expect(row!.verification_note).toMatch(/Overlaps/);
    expect(row!.duration_minutes).toBe(120);
  });

  it('reports attendance separately from recorded and verified hours', async () => {
    await request(app).post('/api/time/attendance/check-in')
      .set('Authorization', t.other!).send({});
    const already = await request(app).post('/api/time/attendance/check-in')
      .set('Authorization', t.other!).send({});
    expect(already.status).toBe(409);
    expect(already.body.error.code).toBe('ALREADY_CHECKED_IN');

    const out = await request(app).post('/api/time/attendance/check-out')
      .set('Authorization', t.other!).send({});
    expect(out.status).toBe(200);

    const summary = await request(app).get('/api/reports/productivity/summary')
      .set('Authorization', t.admin!).query({ from: today(), to: today(), employeeId: f.other });
    const row = summary.body.rows[0];
    // Being on duty produces attendance minutes and nothing else.
    expect(row).toBeDefined();
    expect(Number(row.recordedMinutes)).toBe(0);
    expect(Number(row.verifiedMinutes)).toBe(0);
  });

  it('never stores a location without recorded consent', async () => {
    const res = await request(app).post('/api/time/attendance/check-in')
      .set('Authorization', t.employee!)
      .send({ latitude: 17.447, longitude: 78.377, accuracyM: 8 });
    expect(res.status).toBe(201);
    expect(res.body.locationRecorded).toBe(false);

    const row = await one<{ check_in_latitude: string | null; location_consented: boolean }>(
      `SELECT check_in_latitude, location_consented FROM attendance_sessions
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [f.employee]);
    expect(row!.check_in_latitude).toBeNull();
    expect(row!.location_consented).toBe(false);

    await request(app).post('/api/time/attendance/check-out').set('Authorization', t.employee!).send({});

    // With consent recorded, the same call stores coordinates.
    await request(app).post('/api/time/attendance/location-consent')
      .set('Authorization', t.employee!).send({ granted: true });
    const withConsent = await request(app).post('/api/time/attendance/check-in')
      .set('Authorization', t.employee!)
      .send({ latitude: 17.447, longitude: 78.377, accuracyM: 8 });
    expect(withConsent.body.locationRecorded).toBe(true);

    await request(app).post('/api/time/attendance/check-out').set('Authorization', t.employee!).send({});
    await request(app).post('/api/time/attendance/location-consent')
      .set('Authorization', t.employee!).send({ granted: false });
  });

  it('defines every metric it reports', async () => {
    const res = await request(app).get('/api/reports/productivity/summary')
      .set('Authorization', t.admin!).query({ from: today(), to: today() });
    expect(res.body.definitions.verified_hours).toMatch(/only figure ADISYS reports as productive/i);
    expect(res.body.definitions.attendance_hours).toMatch(/NOT productivity/);
  });
});
