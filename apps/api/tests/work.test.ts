import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { one, pool, query } from '../src/lib/db.js';
import { seedFixture, tokenFor, type Fixture } from './fixtures.js';

const app = createApp();
let f: Fixture;
const t: Record<string, string> = {};
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  f = await seedFixture();
  for (const who of ['admin', 'manager', 'employee', 'other'] as const) {
    t[who] = await tokenFor(app, f[who]);
  }
});
afterAll(async () => { await pool.end(); });

async function assignWork(overrides: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/assignments').set('Authorization', t.manager!)
    .send({
      projectId: f.project, assigneeIds: [f.employee], title: 'Verify panel earthing',
      description: 'Check continuity and record readings.',
      assignmentDate: today(), dueDate: today(), estimatedHours: 3, ...overrides,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.created[0].id as string;
}

describe('work assignment workflow', () => {
  it('issues work and notifies the employee', async () => {
    const id = await assignWork();
    const detail = await request(app).get(`/api/assignments/${id}`).set('Authorization', t.employee!);
    expect(detail.status).toBe(200);
    expect(detail.body.assignment.status).toBe('assigned');
    expect(detail.body.assignment.acknowledgement.isCurrent).toBe(false);

    const notified = await one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM notifications
        WHERE user_id = $1 AND entity_id = $2 AND type = 'work.assigned'`, [f.employee, id]);
    expect(notified!.count).toBe(1);
  });

  it('refuses to start work that has not been acknowledged', async () => {
    const id = await assignWork();
    const res = await request(app).post('/api/time/timer/start').set('Authorization', t.employee!)
      .send({ assignmentId: id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACKNOWLEDGEMENT_REQUIRED');
  });

  it('records acknowledgement WITHOUT marking the work complete', async () => {
    const id = await assignWork();
    const ack = await request(app).post(`/api/assignments/${id}/acknowledge`)
      .set('Authorization', t.employee!).send({ decision: 'acknowledged' });
    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe('acknowledged');

    const detail = await request(app).get(`/api/assignments/${id}`).set('Authorization', t.employee!);
    // The critical business rule: acknowledgement is receipt, not completion.
    expect(detail.body.assignment.status).toBe('acknowledged');
    expect(detail.body.assignment.status).not.toBe('completed');
    expect(detail.body.assignment.progressPct).toBe(0);
    expect(detail.body.assignment.acknowledgement.isCurrent).toBe(true);
  });

  it('rejects an acknowledgement from anyone but the assignee', async () => {
    const id = await assignWork();
    const res = await request(app).post(`/api/assignments/${id}/acknowledge`)
      .set('Authorization', t.other!).send({ decision: 'acknowledged' });
    expect(res.status).toBe(403);
  });

  it('invalidates the acknowledgement when the work materially changes', async () => {
    const id = await assignWork();
    await request(app).post(`/api/assignments/${id}/acknowledge`)
      .set('Authorization', t.employee!).send({ decision: 'acknowledged' });

    const edit = await request(app).patch(`/api/assignments/${id}`).set('Authorization', t.manager!)
      .send({ estimatedHours: 6, instructions: 'A hot-work permit is now required.' });
    expect(edit.status).toBe(200);
    expect(edit.body.acknowledgementReset).toBe(true);
    expect(edit.body.version).toBe(2);

    const detail = await request(app).get(`/api/assignments/${id}`).set('Authorization', t.employee!);
    expect(detail.body.assignment.acknowledgement.isCurrent).toBe(false);
    expect(detail.body.assignment.acknowledgement.changedSinceAck).toBe(true);
    // The earlier acknowledgement is retained, not overwritten.
    expect(detail.body.acknowledgements).toHaveLength(1);
    expect(detail.body.acknowledgements[0].assignmentVersion).toBe(1);
  });

  it('keeps progress when a changed assignment is re-acknowledged', async () => {
    const id = await assignWork();
    await request(app).post(`/api/assignments/${id}/acknowledge`)
      .set('Authorization', t.employee!).send({ decision: 'acknowledged' });
    await request(app).post(`/api/assignments/${id}/status`)
      .set('Authorization', t.employee!).send({ status: 'in_progress', progressPct: 40 });

    await request(app).patch(`/api/assignments/${id}`).set('Authorization', t.manager!)
      .send({ instructions: 'Revised drawing issued.' });
    await request(app).post(`/api/assignments/${id}/acknowledge`)
      .set('Authorization', t.employee!).send({ decision: 'acknowledged' });

    const detail = await request(app).get(`/api/assignments/${id}`).set('Authorization', t.employee!);
    // Re-acknowledging must not rewind work already done.
    expect(detail.body.assignment.status).toBe('in_progress');
    expect(detail.body.assignment.progressPct).toBe(40);
  });

  it('acknowledges a whole day in bulk without completing anything', async () => {
    await query(`DELETE FROM work_assignments WHERE assignee_id = $1`, [f.employee]);
    const ids = [await assignWork(), await assignWork({ title: 'Second task' }),
                 await assignWork({ title: 'Third task' })];

    const preview = await request(app).get('/api/assignments/acknowledge-bulk/preview')
      .set('Authorization', t.employee!).query({ scope: 'day', date: today() });
    expect(preview.status).toBe(200);
    expect(preview.body.pendingCount).toBe(3);

    const bulk = await request(app).post('/api/assignments/acknowledge-bulk')
      .set('Authorization', t.employee!).send({ scope: 'day', date: today() });
    expect(bulk.status).toBe(200);
    expect(bulk.body.count).toBe(3);
    expect(bulk.body.message).toMatch(/still needs to be completed/i);

    const statuses = await query<{ status: string }>(
      `SELECT status FROM work_assignments WHERE id = ANY($1)`, [ids]);
    // Every one acknowledged; not one completed.
    expect(statuses.every((s) => s.status === 'acknowledged')).toBe(true);

    const again = await request(app).post('/api/assignments/acknowledge-bulk')
      .set('Authorization', t.employee!).send({ scope: 'day', date: today() });
    expect(again.body.count).toBe(0);
    expect(again.body.message).toMatch(/already acknowledged/i);
  });

  it('refuses an invalid status transition', async () => {
    const id = await assignWork();
    const res = await request(app).post(`/api/assignments/${id}/status`)
      .set('Authorization', t.employee!).send({ status: 'submitted' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('lets only the manager accept completion', async () => {
    const id = await assignWork();
    await request(app).post(`/api/assignments/${id}/acknowledge`)
      .set('Authorization', t.employee!).send({ decision: 'acknowledged' });
    await request(app).post(`/api/assignments/${id}/status`)
      .set('Authorization', t.employee!).send({ status: 'in_progress' });
    await request(app).post(`/api/assignments/${id}/status`)
      .set('Authorization', t.employee!).send({ status: 'submitted', note: 'Done.' });

    const selfAccept = await request(app).post(`/api/assignments/${id}/review`)
      .set('Authorization', t.employee!).send({ decision: 'accept' });
    expect(selfAccept.status).toBe(403);

    const accepted = await request(app).post(`/api/assignments/${id}/review`)
      .set('Authorization', t.manager!).send({ decision: 'accept', comment: 'Verified on site.' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('completed');
  });

  it('returns work for clarification with a required reason', async () => {
    const id = await assignWork();
    await request(app).post(`/api/assignments/${id}/acknowledge`)
      .set('Authorization', t.employee!).send({ decision: 'acknowledged' });
    await request(app).post(`/api/assignments/${id}/status`)
      .set('Authorization', t.employee!).send({ status: 'in_progress' });
    await request(app).post(`/api/assignments/${id}/status`)
      .set('Authorization', t.employee!).send({ status: 'submitted' });

    const noReason = await request(app).post(`/api/assignments/${id}/review`)
      .set('Authorization', t.manager!).send({ decision: 'return' });
    expect(noReason.status).toBe(422);

    const returned = await request(app).post(`/api/assignments/${id}/review`)
      .set('Authorization', t.manager!)
      .send({ decision: 'return', comment: 'Measurement sheet is missing.' });
    expect(returned.status).toBe(200);
    expect(returned.body.status).toBe('clarification_requested');
  });

  it('writes an immutable event for every transition', async () => {
    const id = await assignWork();
    await request(app).post(`/api/assignments/${id}/acknowledge`)
      .set('Authorization', t.employee!).send({ decision: 'acknowledged' });

    const events = await query<{ event_type: string; to_status: string }>(
      `SELECT event_type, to_status FROM work_assignment_events
        WHERE assignment_id = $1 ORDER BY id`, [id]);
    expect(events.map((e) => e.event_type)).toEqual(['created', 'status_changed']);
    expect(events[1]!.to_status).toBe('acknowledged');
  });

  it('creates one acknowledgeable assignment per working day when repeated', async () => {
    const start = today();
    const end = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
    const res = await request(app).post('/api/assignments').set('Authorization', t.manager!)
      .send({
        projectId: f.project, assigneeIds: [f.employee], title: 'Daily PM round',
        assignmentDate: start, dueDate: start, repeatUntil: end,
      });
    expect(res.status).toBe(201);
    // Sundays are excluded, so a 7-day span yields 6 occurrences.
    expect(res.body.count).toBe(6);
    expect(new Set(res.body.created.map((c: any) => c.assignmentCode)).size).toBe(6);
  });
});
