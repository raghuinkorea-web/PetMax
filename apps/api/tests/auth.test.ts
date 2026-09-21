import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/lib/db.js';
import { PASSWORD, seedFixture, tokenFor, type Fixture } from './fixtures.js';

const app = createApp();
let f: Fixture;

beforeAll(async () => { f = await seedFixture(); });
afterAll(async () => { await pool.end(); });

describe('authentication', () => {
  it('signs in with an employee code, an email or a mobile number', async () => {
    for (const identifier of ['T-0004', 'test.employee@test.adisystech.com', '9800000004']) {
      const res = await request(app).post('/api/auth/login').send({ identifier, password: PASSWORD });
      expect(res.status, `identifier ${identifier}`).toBe(200);
      expect(res.body.accessToken).toMatch(/^eyJ/);
      expect(res.body.user.permissions).toContain('expense.create');
    }
  });

  it('gives the same answer for an unknown user and a wrong password', async () => {
    const unknown = await request(app).post('/api/auth/login')
      .send({ identifier: 'T-9999', password: PASSWORD });
    const wrong = await request(app).post('/api/auth/login')
      .send({ identifier: 'T-0004', password: 'wrong-password' });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    // Identical wording, so the endpoint cannot be used to enumerate staff.
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('locks an account after repeated failures and records every attempt', async () => {
    const code = 'T-0005';
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ identifier: code, password: 'nope' });
    }
    const locked = await request(app).post('/api/auth/login')
      .send({ identifier: code, password: PASSWORD });
    expect(locked.status).toBe(401);
    expect(locked.body.error.message).toMatch(/locked/i);

    const attempts = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM login_attempts WHERE identifier = $1 AND successful = false`, [code]);
    expect(attempts[0]!.count).toBeGreaterThanOrEqual(5);

    await query(`UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE employee_code = $1`, [code]);
  });

  it('refuses a request with no token, a malformed token, or a revoked session', async () => {
    expect((await request(app).get('/api/employees')).status).toBe(401);
    expect((await request(app).get('/api/employees').set('Authorization', 'Bearer nonsense')).status).toBe(401);

    const token = await tokenFor(app, f.employee);
    expect((await request(app).get('/api/auth/me').set('Authorization', token)).status).toBe(200);

    await request(app).post('/api/auth/logout').set('Authorization', token);
    // The token itself is still cryptographically valid; the session is not.
    expect((await request(app).get('/api/auth/me').set('Authorization', token)).status).toBe(401);
  });

  it('blocks a deactivated account even with a live token', async () => {
    const token = await tokenFor(app, f.other);
    expect((await request(app).get('/api/auth/me').set('Authorization', token)).status).toBe(200);

    await query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [f.other]);
    const res = await request(app).get('/api/auth/me').set('Authorization', token);
    expect(res.status).toBe(403);

    await query(`UPDATE users SET status = 'active' WHERE id = $1`, [f.other]);
  });

  it('rotates the refresh token and revokes the family if an old one is replayed', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ identifier: 'T-0004', password: PASSWORD, client: 'android' });
    const first = login.body.refreshToken as string;

    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: first });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(first);

    // Replaying the retired token is treated as theft: everything is revoked.
    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: first });
    expect(replay.status).toBe(401);

    const second = rotated.body.refreshToken as string;
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: second })).status).toBe(401);
  });

  it('enforces the password policy and signs other devices out on change', async () => {
    const token = await tokenFor(app, f.employee);
    const otherDevice = await tokenFor(app, f.employee);

    const weak = await request(app).post('/api/auth/change-password').set('Authorization', token)
      .send({ currentPassword: PASSWORD, newPassword: 'short1A' });
    expect(weak.status).toBe(422);
    expect(weak.body.error.details.newPassword).toBeDefined();

    const wrongCurrent = await request(app).post('/api/auth/change-password').set('Authorization', token)
      .send({ currentPassword: 'not-my-password', newPassword: 'Brand@NewPass1' });
    expect(wrongCurrent.status).toBe(400);

    const ok = await request(app).post('/api/auth/change-password').set('Authorization', token)
      .send({ currentPassword: PASSWORD, newPassword: 'Brand@NewPass1' });
    expect(ok.status).toBe(200);

    expect((await request(app).get('/api/auth/me').set('Authorization', otherDevice)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', token)).status).toBe(200);

    // Restore the shared fixture password for the remaining tests.
    await request(app).post('/api/auth/change-password').set('Authorization', token)
      .send({ currentPassword: 'Brand@NewPass1', newPassword: PASSWORD });
  });

  it('answers forgot-password identically whether or not the account exists', async () => {
    const known = await request(app).post('/api/auth/forgot-password').send({ identifier: 'T-0004' });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ identifier: 'T-9999' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
  });
});
