import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ROLE_PERMISSIONS, type RoleKey } from '@adisys/shared';
import { config } from '../config.js';
import { one, query, tx } from '../lib/db.js';
import { asyncHandler, parse } from '../lib/http.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { authenticate, loadPermissions, principalOf, signAccessToken } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';

export const authRouter = Router();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const loginLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again shortly.' } },
});

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

async function issueSession(
  userId: string, roleKey: RoleKey, client: 'web' | 'android' | 'ios',
  req: { headers: Record<string, any>; ip?: string }, deviceLabel?: string,
) {
  const sessionId = randomUUID();
  const refreshToken = jwt.sign({ sub: userId, sid: sessionId }, config.jwt.refreshSecret,
    { expiresIn: `${config.jwt.refreshTtlDays}d`, issuer: 'adisys-fieldops' });

  await query(
    `INSERT INTO auth_sessions (id, user_id, refresh_token_hash, client, device_label, user_agent, ip_address, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(days => $8::int))`,
    [sessionId, userId, hashToken(refreshToken), client, deviceLabel ?? null,
     req.headers['user-agent'] ?? null, (req.ip ?? '').replace('::ffff:', '') || null,
     config.jwt.refreshTtlDays]);

  return {
    sessionId,
    refreshToken,
    accessToken: signAccessToken(userId, sessionId, roleKey),
    expiresIn: config.jwt.accessTtlMin * 60,
  };
}

async function buildAuthUser(userId: string) {
  const u = await one<any>(
    `SELECT u.id, u.employee_code, u.full_name, u.email, u.phone, u.avatar_file_id,
            u.must_change_password, u.reporting_manager_id, u.location_consent_at,
            r.key AS role_key, r.name AS role_name,
            d.name AS department_name, dg.name AS designation_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN departments  d  ON d.id  = u.department_id
       LEFT JOIN designations dg ON dg.id = u.designation_id
      WHERE u.id = $1`, [userId]);
  if (!u) throw unauthorized();
  return {
    id: u.id, employeeCode: u.employee_code, fullName: u.full_name, email: u.email, phone: u.phone,
    roleKey: u.role_key as RoleKey, roleName: u.role_name,
    permissions: [...await loadPermissions(u.id, u.role_key)],
    departmentName: u.department_name, designationName: u.designation_name,
    avatarFileId: u.avatar_file_id, mustChangePassword: u.must_change_password,
    reportingManagerId: u.reporting_manager_id, locationConsentAt: u.location_consent_at,
  };
}

const loginSchema = z.object({
  // Employee ID, email or mobile number — field staff remember their ID.
  identifier: z.string().trim().min(3, 'Enter your employee ID, email or mobile number'),
  password: z.string().min(1, 'Enter your password'),
  client: z.enum(['web', 'android', 'ios']).default('web'),
  deviceLabel: z.string().trim().max(120).optional(),
});

authRouter.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const body = parse(loginSchema, req.body);
  const ip = (req.ip ?? '').replace('::ffff:', '') || null;

  const logAttempt = (userId: string | null, ok: boolean, reason?: string) =>
    query(`INSERT INTO login_attempts (identifier, user_id, successful, failure_reason, ip_address, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6)`,
      [body.identifier, userId, ok, reason ?? null, ip, req.headers['user-agent'] ?? null]).catch(() => {});

  const user = await one<any>(
    `SELECT u.id, u.password_hash, u.status, u.failed_login_count, u.locked_until,
            u.must_change_password, r.key AS role_key
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.deleted_at IS NULL
        AND (lower(u.email) = lower($1) OR u.phone = $1 OR lower(u.employee_code) = lower($1))`,
    [body.identifier]);

  // A uniform failure message for unknown users and wrong passwords alike,
  // so the endpoint cannot be used to enumerate ADISYS staff.
  const invalid = () => unauthorized('Incorrect credentials. Check your employee ID and password.');

  if (!user || !user.password_hash) { await logAttempt(null, false, 'unknown_identifier'); throw invalid(); }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await logAttempt(user.id, false, 'locked');
    throw unauthorized(`Too many failed attempts. This account is locked until ${new Date(user.locked_until).toLocaleTimeString('en-IN')}.`);
  }

  if (!await bcrypt.compare(body.password, user.password_hash)) {
    const failed = user.failed_login_count + 1;
    await query(
      `UPDATE users
          SET failed_login_count = $2::int,
              locked_until = CASE WHEN $2::int >= $3::int
                                  THEN now() + make_interval(mins => $4::int)
                                  ELSE locked_until END
        WHERE id = $1`, [user.id, failed, MAX_FAILED, LOCK_MINUTES]);
    await logAttempt(user.id, false, 'bad_password');
    throw invalid();
  }

  if (user.status === 'suspended') { await logAttempt(user.id, false, 'suspended'); throw unauthorized('This account has been suspended. Contact your administrator.'); }
  if (user.status === 'inactive')  { await logAttempt(user.id, false, 'inactive');  throw unauthorized('This account is inactive. Contact your administrator.'); }

  // An invited employee becomes active on first successful sign-in.
  await query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now(),
            status = CASE WHEN status = 'invited' THEN 'active' ELSE status END
      WHERE id = $1`, [user.id]);
  await logAttempt(user.id, true);

  const session = await issueSession(user.id, user.role_key, body.client, req, body.deviceLabel);
  req.principal = { id: user.id, roleKey: user.role_key } as any;
  await recordAudit(req, { action: 'auth.login', entityType: 'user', entityId: user.id, after: { client: body.client } });

  res.cookie('adisys_rt', session.refreshToken, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd,
    path: '/api/auth', maxAge: config.jwt.refreshTtlDays * 86_400_000,
  });

  res.json({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,   // mobile clients store this in secure storage
    expiresIn: session.expiresIn,
    user: await buildAuthUser(user.id),
  });
}));

authRouter.post('/refresh', asyncHandler(async (req, res) => {
  const token = (req.body?.refreshToken as string | undefined) ?? req.cookies?.adisys_rt;
  if (!token) throw unauthorized('No refresh token supplied.');

  let claims: { sub: string; sid: string };
  try {
    claims = jwt.verify(token, config.jwt.refreshSecret, { issuer: 'adisys-fieldops' }) as any;
  } catch { throw unauthorized('Your session has expired. Please sign in again.'); }

  // Reuse detection must survive the transaction that discovers it: if the
  // revocation were issued inside the transaction it would be rolled back by
  // the very error it raises, leaving a stolen token family alive.
  const result = await tx(async (client) => {
    const session = await one<any>(
      `SELECT s.id, s.user_id, s.revoked_at, s.expires_at, s.refresh_token_hash, s.client,
              r.key AS role_key, u.status
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
         JOIN roles r ON r.id = u.role_id
        WHERE s.id = $1 FOR UPDATE OF s`, [claims.sid], client);

    if (!session || session.user_id !== claims.sub) return { compromised: null, session: null };

    const expired = new Date(session.expires_at) < new Date();
    const reused = Boolean(session.revoked_at) || session.refresh_token_hash !== hashToken(token);

    // A retired or mismatched token means the refresh token may have been
    // stolen. Flag the whole family; the revocation happens after COMMIT.
    if (reused || expired) return { compromised: session.user_id as string, session: null };
    if (session.status !== 'active') return { compromised: null, session: null };

    await query(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1`, [session.id], client);
    return {
      compromised: null,
      session: { userId: session.user_id as string, roleKey: session.role_key as RoleKey, client: session.client },
    };
  });

  if (result.compromised) {
    await query(`UPDATE auth_sessions SET revoked_at = now()
                  WHERE user_id = $1 AND revoked_at IS NULL`, [result.compromised]);
    await recordAudit(req, {
      action: 'auth.refresh_token_reuse', entityType: 'user', entityId: result.compromised,
      after: { outcome: 'all sessions revoked' },
    });
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  if (!result.session) throw unauthorized('Your session has expired. Please sign in again.');

  const session = await issueSession(result.session.userId, result.session.roleKey, result.session.client, req);
  res.cookie('adisys_rt', session.refreshToken, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd,
    path: '/api/auth', maxAge: config.jwt.refreshTtlDays * 86_400_000,
  });
  res.json({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresIn: session.expiresIn,
    user: await buildAuthUser(result.session.userId),
  });
}));

authRouter.post('/logout', authenticate, asyncHandler(async (req, res) => {
  const p = principalOf(req);
  await query(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [p.sessionId]);
  await recordAudit(req, { action: 'auth.logout', entityType: 'user', entityId: p.id });
  res.clearCookie('adisys_rt', { path: '/api/auth' });
  res.json({ ok: true });
}));

authRouter.get('/me', authenticate, asyncHandler(async (req, res) => {
  res.json({ user: await buildAuthUser(principalOf(req).id) });
}));

authRouter.get('/sessions', authenticate, asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const rows = await query(
    `SELECT id, client, device_label, user_agent, host(ip_address) AS ip_address,
            created_at, last_used_at, expires_at, (id = $2) AS is_current
       FROM auth_sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_used_at DESC`, [p.id, p.sessionId]);
  res.json({ data: rows });
}));

authRouter.delete('/sessions/:id', authenticate, asyncHandler(async (req, res) => {
  const p = principalOf(req);
  await query(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2`, [req.params.id, p.id]);
  await recordAudit(req, { action: 'auth.session_revoked', entityType: 'auth_session', entityId: req.params.id });
  res.json({ ok: true });
}));

const passwordSchema = z.string()
  .min(10, 'Use at least 10 characters')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[0-9]/, 'Include a number');

authRouter.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const body = parse(z.object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
  }), req.body);
  const p = principalOf(req);

  const user = await one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [p.id]);
  if (!user?.password_hash || !await bcrypt.compare(body.currentPassword, user.password_hash)) {
    throw badRequest('Your current password is incorrect.', { currentPassword: ['Incorrect password'] });
  }
  if (await bcrypt.compare(body.newPassword, user.password_hash)) {
    throw badRequest('Choose a password you have not used before.', { newPassword: ['This is your current password'] });
  }

  await query(
    `UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`,
    [p.id, await bcrypt.hash(body.newPassword, config.bcryptRounds)]);
  // Changing a password signs every OTHER device out.
  await query(`UPDATE auth_sessions SET revoked_at = now()
                WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`, [p.id, p.sessionId]);
  await recordAudit(req, { action: 'auth.password_changed', entityType: 'user', entityId: p.id });
  res.json({ ok: true });
}));

authRouter.post('/forgot-password', loginLimiter, asyncHandler(async (req, res) => {
  const body = parse(z.object({ identifier: z.string().trim().min(3) }), req.body);
  const user = await one<{ id: string }>(
    `SELECT id FROM users WHERE deleted_at IS NULL AND status IN ('active','invited')
       AND (lower(email) = lower($1) OR phone = $1 OR lower(employee_code) = lower($1))`,
    [body.identifier]);

  // Always answers the same way, whether or not the identifier exists.
  if (user) {
    const token = randomBytes(32).toString('hex');
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1,$2, now() + interval '30 minutes')`, [user.id, hashToken(token)]);
    await recordAudit(req, { action: 'auth.reset_requested', entityType: 'user', entityId: user.id });
    if (!config.isProd) {
      console.log(`[auth] password reset token for ${body.identifier}: ${token}`);
    }
  }
  res.json({ ok: true, message: 'If that account exists, a reset link has been sent to the registered email and mobile number.' });
}));

authRouter.post('/reset-password', loginLimiter, asyncHandler(async (req, res) => {
  const body = parse(z.object({ token: z.string().min(32), newPassword: passwordSchema }), req.body);
  const row = await one<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM password_reset_tokens
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [hashToken(body.token)]);
  if (!row) throw badRequest('That reset link is invalid or has expired. Request a new one.');

  await tx(async (client) => {
    await query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [row.id], client);
    await query(`UPDATE users SET password_hash = $2, must_change_password = false,
                        failed_login_count = 0, locked_until = NULL WHERE id = $1`,
      [row.user_id, await bcrypt.hash(body.newPassword, config.bcryptRounds)], client);
    await query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [row.user_id], client);
  });
  await recordAudit(req, { action: 'auth.password_reset', entityType: 'user', entityId: row.user_id });
  res.json({ ok: true });
}));

/** The permission catalogue, so the UI can render exactly what the caller may do. */
authRouter.get('/permissions', authenticate, asyncHandler(async (req, res) => {
  const p = principalOf(req);
  res.json({ roleKey: p.roleKey, permissions: [...p.permissions], catalogue: ROLE_PERMISSIONS });
}));
