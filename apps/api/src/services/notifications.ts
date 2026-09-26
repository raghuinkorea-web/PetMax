import { query, type Sql } from '../lib/db.js';
import { pool } from '../lib/db.js';

export type NotificationType =
  | 'work.assigned' | 'work.updated' | 'work.acknowledgement_reminder'
  | 'work.returned' | 'work.completed' | 'work.overdue'
  | 'expense.submitted' | 'expense.approved' | 'expense.rejected'
  | 'expense.returned' | 'expense.paid' | 'expense.awaiting_approval'
  | 'leave.applied' | 'leave.approved' | 'leave.rejected'
  | 'announcement';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: 'work_assignment' | 'expense_claim' | 'project' | 'leave_request' | null;
  entityId?: string | null;
  severity?: 'info' | 'success' | 'warning' | 'critical';
}

/**
 * Writes the in-app notification and queues the push/email fan-out in the
 * outbox. Delivery is a background worker's job, so a slow FCM call can
 * never delay the API response the employee is waiting on.
 */
export async function notify(input: NotifyInput | NotifyInput[], client: Sql = pool): Promise<void> {
  const items = Array.isArray(input) ? input : [input];
  if (!items.length) return;

  for (const n of items) {
    const rows = await query<{ id: string }>(
      `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id, severity)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [n.userId, n.type, n.title, n.body, n.entityType ?? null, n.entityId ?? null, n.severity ?? 'info'],
      client);

    const prefs = await query<{ push: boolean; email: boolean }>(
      `SELECT push, email FROM notification_preferences WHERE user_id = $1 AND type = $2`,
      [n.userId, n.type], client);
    const pref = prefs[0] ?? { push: true, email: false };

    const channels: Array<'push' | 'email'> = [];
    if (pref.push) channels.push('push');
    if (pref.email) channels.push('email');

    for (const channel of channels) {
      await query(
        `INSERT INTO notification_outbox (notification_id, channel, payload)
         VALUES ($1,$2,$3)`,
        [rows[0]!.id, channel, JSON.stringify({
          title: n.title, body: n.body,
          data: { type: n.type, entityType: n.entityType ?? null, entityId: n.entityId ?? null },
        })], client);
    }
  }
}

/** Everyone who should hear about activity on a project (manager + super admins). */
export async function projectWatchers(projectId: string, excludeUserId?: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT u.id
       FROM users u
       LEFT JOIN projects p ON p.id = $1
       JOIN roles r ON r.id = u.role_id
      WHERE u.deleted_at IS NULL AND u.status = 'active'
        AND (u.id = p.manager_id OR r.key = 'super_admin')
        AND ($2::uuid IS NULL OR u.id <> $2)`,
    [projectId, excludeUserId ?? null]);
  return rows.map((r) => r.id);
}

export async function usersWithPermissionRole(roleKeys: string[], excludeUserId?: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.key = ANY($1) AND u.deleted_at IS NULL AND u.status = 'active'
        AND ($2::uuid IS NULL OR u.id <> $2)`,
    [roleKeys, excludeUserId ?? null]);
  return rows.map((r) => r.id);
}
