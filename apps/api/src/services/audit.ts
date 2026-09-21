import type { Request } from 'express';
import { query, type Sql } from '../lib/db.js';
import { pool } from '../lib/db.js';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Fields that must never reach the audit log. */
const REDACT = new Set(['password', 'password_hash', 'passwordHash', 'token', 'refresh_token_hash',
  'token_hash', 'accessToken', 'refreshToken', 'newPassword', 'currentPassword']);

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, REDACT.has(k) ? '[redacted]' : redact(v)]));
  }
  return value;
};

export async function recordAudit(req: Request, input: AuditInput, client: Sql = pool): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id,
                               before, after, ip_address, user_agent, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        req.principal?.id ?? null,
        req.principal?.roleKey ?? null,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.before === undefined ? null : JSON.stringify(redact(input.before)),
        input.after === undefined ? null : JSON.stringify(redact(input.after)),
        (req.ip ?? '').replace('::ffff:', '') || null,
        req.headers['user-agent'] ?? null,
        req.requestId ?? null,
      ], client);
  } catch (err) {
    // Auditing must never break the user's action; it is reported loudly instead.
    console.error('[audit] failed to write entry', input.action, err);
  }
}
