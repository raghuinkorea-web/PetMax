import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../lib/db.js';
import { asyncHandler, offsetOf, pageMeta, paginationSchema, parse, uuid } from '../lib/http.js';
import { principalOf } from '../middleware/auth.js';

export const notificationRouter = Router();

notificationRouter.get('/', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const f = parse(paginationSchema.extend({
    unreadOnly: z.coerce.boolean().default(false),
    type: z.string().optional(),
  }), req.query);

  const rows = await query(
    `SELECT id, type, title, body, entity_type AS "entityType", entity_id AS "entityId",
            severity, read_at AS "readAt", created_at AS "createdAt"
       FROM notifications
      WHERE user_id = $1
        AND ($2::boolean IS FALSE OR read_at IS NULL)
        AND ($3::text IS NULL OR type = $3)
      ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
    [p.id, f.unreadOnly, f.type ?? null, f.size, offsetOf(f.page, f.size)]);

  const counts = await one<{ total: number; unread: number }>(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread
       FROM notifications WHERE user_id = $1`, [p.id]);

  res.json({ data: rows, page: pageMeta(f.page, f.size, counts?.total ?? 0), unread: counts?.unread ?? 0 });
}));

notificationRouter.get('/unread-count', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const row = await one<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [p.id]);
  res.json({ unread: row?.count ?? 0 });
}));

notificationRouter.post('/:id/read', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const row = await one<{ id: string }>(
    `UPDATE notifications SET read_at = now()
      WHERE id = $1 AND user_id = $2 AND read_at IS NULL RETURNING id`, [req.params.id, p.id]);
  res.json({ ok: true, updated: Boolean(row) });
}));

notificationRouter.post('/read-all', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const rows = await query<{ id: string }>(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL RETURNING id`, [p.id]);
  res.json({ ok: true, count: rows.length });
}));

notificationRouter.get('/preferences', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const rows = await query(
    `SELECT type, in_app AS "inApp", push, email FROM notification_preferences WHERE user_id = $1`, [p.id]);
  res.json({ data: rows, defaults: { inApp: true, push: true, email: false } });
}));

notificationRouter.put('/preferences', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({
    preferences: z.array(z.object({
      type: z.string().max(60), inApp: z.boolean(), push: z.boolean(), email: z.boolean(),
    })).max(40),
  }), req.body);

  for (const pref of body.preferences) {
    await query(
      `INSERT INTO notification_preferences (user_id, type, in_app, push, email)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, type)
       DO UPDATE SET in_app = EXCLUDED.in_app, push = EXCLUDED.push, email = EXCLUDED.email`,
      [p.id, pref.type, pref.inApp, pref.push, pref.email]);
  }
  res.json({ ok: true, count: body.preferences.length });
}));

/** Android registers its FCM token here after sign-in. */
notificationRouter.post('/devices', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  const body = parse(z.object({
    token: z.string().min(10).max(500),
    platform: z.enum(['android', 'ios', 'web']),
    deviceLabel: z.string().trim().max(120).optional(),
  }), req.body);

  await query(
    `INSERT INTO push_devices (user_id, token, platform, device_label)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, active = true,
                                       last_seen_at = now(), device_label = EXCLUDED.device_label`,
    [p.id, body.token, body.platform, body.deviceLabel ?? null]);
  res.status(201).json({ ok: true });
}));

notificationRouter.delete('/devices/:token', asyncHandler(async (req, res) => {
  const p = principalOf(req);
  await query(`UPDATE push_devices SET active = false WHERE token = $1 AND user_id = $2`,
    [req.params.token, p.id]);
  res.json({ ok: true });
}));
