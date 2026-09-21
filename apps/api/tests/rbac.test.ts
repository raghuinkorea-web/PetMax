import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/lib/db.js';
import { seedFixture, tokenFor, type Fixture } from './fixtures.js';

const app = createApp();
let f: Fixture;
const t: Record<string, string> = {};

beforeAll(async () => {
  f = await seedFixture();
  for (const who of ['admin', 'manager', 'finance', 'employee', 'other'] as const) {
    t[who] = await tokenFor(app, f[who]);
  }
});
afterAll(async () => { await pool.end(); });

describe('role-based access control', () => {
  it('denies administration endpoints to an employee', async () => {
    for (const path of ['/api/settings', '/api/settings/audit-logs', '/api/settings/roles']) {
      const res = await request(app).get(path).set('Authorization', t.employee!);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('scopes the employee directory to the caller', async () => {
    const asEmployee = await request(app).get('/api/employees').set('Authorization', t.employee!);
    expect(asEmployee.status).toBe(200);
    // An employee holds employee.view.own only: they see exactly themselves.
    expect(asEmployee.body.page.total).toBe(1);
    expect(asEmployee.body.data[0].id).toBe(f.employee);

    const asAdmin = await request(app).get('/api/employees').set('Authorization', t.admin!);
    expect(asAdmin.body.page.total).toBe(5);
  });

  it('returns 404, not 403, for a record outside the caller\'s scope', async () => {
    // Leaking "this exists but you cannot see it" is itself an information leak.
    const res = await request(app).get(`/api/employees/${f.other}`).set('Authorization', t.employee!);
    expect(res.status).toBe(404);
  });

  it('hides projects the caller is not a member of', async () => {
    const res = await request(app).get('/api/projects').set('Authorization', t.employee!);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: any) => p.id);
    expect(ids).toContain(f.project);
    expect(ids).not.toContain(f.otherProject);
  });

  it('stops a manager assigning work on a project they do not manage', async () => {
    const res = await request(app).post('/api/assignments').set('Authorization', t.manager!)
      .send({
        projectId: f.otherProject, assigneeIds: [f.employee], title: 'Not your project',
        assignmentDate: today(), dueDate: today(),
      });
    expect(res.status).toBe(403);
  });

  it('stops an employee assigning work at all', async () => {
    const res = await request(app).post('/api/assignments').set('Authorization', t.employee!)
      .send({
        projectId: f.project, assigneeIds: [f.other], title: 'Self-assigned',
        assignmentDate: today(), dueDate: today(),
      });
    expect(res.status).toBe(403);
  });

  it('stops an employee assigning work to someone off the project', async () => {
    const outsider = await query<{ id: string }>(
      `INSERT INTO users (employee_code, full_name, email, phone, role_id, status)
       VALUES ('T-9001','Outsider','outsider@test.adisystech.com','9899999001',
               (SELECT id FROM roles WHERE key = 'employee'), 'active') RETURNING id`);
    const res = await request(app).post('/api/assignments').set('Authorization', t.manager!)
      .send({
        projectId: f.project, assigneeIds: [outsider[0]!.id], title: 'Not a member',
        assignmentDate: today(), dueDate: today(),
      });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not assigned to this project/i);
  });

  it('grants a per-user override without changing the role', async () => {
    const before = await request(app).post('/api/time/entries/verify-bulk')
      .set('Authorization', t.employee!).send({ entryIds: [f.project], decision: 'verify' });
    expect(before.status).toBe(403);

    await query(`INSERT INTO user_permission_overrides (user_id, permission_id, effect)
                 SELECT $1, id, 'allow' FROM permissions WHERE key = 'time.verify'`, [f.employee]);

    const token = await tokenFor(app, f.employee);
    const after = await request(app).post('/api/time/entries/verify-bulk')
      .set('Authorization', token).send({ entryIds: [], decision: 'verify' });
    // The permission gate now passes; the payload is what fails validation.
    expect(after.status).toBe(422);

    await query(`DELETE FROM user_permission_overrides WHERE user_id = $1`, [f.employee]);
  });

  it('applies a deny override even when the role grants the permission', async () => {
    await query(`INSERT INTO user_permission_overrides (user_id, permission_id, effect)
                 SELECT $1, id, 'deny' FROM permissions WHERE key = 'expense.create'`, [f.employee]);
    const token = await tokenFor(app, f.employee);

    const res = await request(app).post('/api/expenses').set('Authorization', token)
      .field('categoryId', f.categoryConveyance).field('expenseDate', today())
      .field('amount', '100').field('description', 'Denied by override');
    expect(res.status).toBe(403);

    await query(`DELETE FROM user_permission_overrides WHERE user_id = $1`, [f.employee]);
  });
});

const today = () => new Date().toISOString().slice(0, 10);
