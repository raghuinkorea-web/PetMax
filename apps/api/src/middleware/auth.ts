import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { PermissionKey, RoleKey } from '@adisys/shared';
import { ROLE_PERMISSIONS } from '@adisys/shared';

export interface Principal {
  id: string;
  employeeCode: string;
  fullName: string;
  roleId: string;
  roleKey: RoleKey;
  permissions: Set<PermissionKey>;
  reportingManagerId: string | null;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { principal?: Principal; requestId?: string }
  }
}

export interface AccessTokenClaims { sub: string; sid: string; role: RoleKey; }

export function signAccessToken(userId: string, sessionId: string, roleKey: RoleKey): string {
  return jwt.sign({ sub: userId, sid: sessionId, role: roleKey } satisfies AccessTokenClaims,
    config.jwt.accessSecret, { expiresIn: `${config.jwt.accessTtlMin}m`, issuer: 'adisys-fieldops' });
}

/**
 * Effective permissions = role grants, plus per-user allow overrides,
 * minus per-user deny overrides. Denies always win (least privilege).
 */
export async function loadPermissions(userId: string, roleKey: RoleKey): Promise<Set<PermissionKey>> {
  const base = new Set<PermissionKey>(ROLE_PERMISSIONS[roleKey] ?? []);
  const overrides = await query<{ key: PermissionKey; effect: 'allow' | 'deny' }>(
    `SELECT p.key, o.effect
       FROM user_permission_overrides o
       JOIN permissions p ON p.id = o.permission_id
      WHERE o.user_id = $1`, [userId]);
  for (const o of overrides) if (o.effect === 'allow') base.add(o.key);
  for (const o of overrides) if (o.effect === 'deny') base.delete(o.key);
  return base;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let claims: AccessTokenClaims;
    try {
      claims = jwt.verify(header.slice(7), config.jwt.accessSecret,
        { issuer: 'adisys-fieldops' }) as AccessTokenClaims;
    } catch {
      throw unauthorized('Your session has expired. Please sign in again.');
    }

    // The token is not trusted on its own: the session must still be live
    // and the account must still be active on every single request.
    const rows = await query<{
      id: string; employee_code: string; full_name: string; role_id: string; role_key: RoleKey;
      reporting_manager_id: string | null; status: string; session_revoked: boolean;
    }>(
      `SELECT u.id, u.employee_code, u.full_name, u.role_id, r.key AS role_key,
              u.reporting_manager_id, u.status,
              (s.revoked_at IS NOT NULL OR s.expires_at < now()) AS session_revoked
         FROM users u
         JOIN roles r ON r.id = u.role_id
         JOIN auth_sessions s ON s.id = $2 AND s.user_id = u.id
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [claims.sub, claims.sid]);

    const u = rows[0];
    if (!u || u.session_revoked) throw unauthorized('Your session is no longer valid. Please sign in again.');
    if (u.status !== 'active') throw forbidden('This account is not active. Contact your administrator.');

    req.principal = {
      id: u.id, employeeCode: u.employee_code, fullName: u.full_name,
      roleId: u.role_id, roleKey: u.role_key,
      permissions: await loadPermissions(u.id, u.role_key),
      reportingManagerId: u.reporting_manager_id,
      sessionId: claims.sid,
    };
    void query('UPDATE auth_sessions SET last_used_at = now() WHERE id = $1', [claims.sid])
      .catch(() => {});
    next();
  } catch (err) { next(err); }
}

export function requirePermission(...anyOf: PermissionKey[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const p = req.principal;
    if (!p) return next(unauthorized());
    if (anyOf.some((k) => p.permissions.has(k))) return next();
    next(forbidden(`This action requires one of: ${anyOf.join(', ')}`));
  };
}

export const can = (req: Request, key: PermissionKey): boolean =>
  req.principal?.permissions.has(key) ?? false;

export function principalOf(req: Request): Principal {
  if (!req.principal) throw unauthorized();
  return req.principal;
}
