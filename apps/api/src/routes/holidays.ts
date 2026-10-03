import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../lib/db.js';
import { asyncHandler, dateString, parse } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { importYear } from '../services/holidays.js';

export const holidayRouter = Router();

const yearSchema = z.coerce.number().int().min(2000).max(2100);

/** Anyone who can see the leave calendar can see the holidays on it. */
holidayRouter.get('/', asyncHandler(async (req, res) => {
  const { year, observedOnly } = parse(z.object({
    year: yearSchema.default(new Date().getFullYear()),
    observedOnly: z.coerce.boolean().default(false),
  }), req.query);

  const rows = await query(
    `SELECT id, to_char(holiday_date,'YYYY-MM-DD') AS date, name, region, source, observed
       FROM holidays
      WHERE EXTRACT(YEAR FROM holiday_date) = $1
        AND ($2::boolean IS NOT TRUE OR observed)
      ORDER BY holiday_date, name`,
    [year, observedOnly]);

  res.json({
    year,
    data: rows,
    observedCount: rows.filter((r: any) => r.observed).length,
  });
}));

/** Pull the year from the public calendar. Existing rows keep their `observed`. */
holidayRouter.post('/import', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const { year, region } = parse(z.object({
    year: yearSchema,
    region: z.string().trim().max(10).default('IN-KA'),
  }), { ...req.body, ...req.query });

  const result = await importYear(year, region);
  await recordAudit(req, { action: 'holiday.imported', entityType: 'holiday', after: result });
  res.json(result);
}));

/** Tick a day on or off, or correct its name. */
holidayRouter.patch('/:id', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const body = parse(z.object({
    observed: z.boolean().optional(),
    name: z.string().trim().min(2).max(120).optional(),
  }), req.body);

  const before = await one<any>(`SELECT observed, name FROM holidays WHERE id = $1`, [req.params.id]);
  if (!before) throw notFound('Holiday');

  const updated = await one<any>(
    `UPDATE holidays
        SET observed = COALESCE($2, observed), name = COALESCE($3, name), updated_at = now()
      WHERE id = $1
      RETURNING id, to_char(holiday_date,'YYYY-MM-DD') AS date, name, observed`,
    [req.params.id, body.observed ?? null, body.name ?? null]);

  await recordAudit(req, { action: 'holiday.updated', entityType: 'holiday', entityId: req.params.id,
    before, after: body });
  res.json(updated);
}));

/** A company-specific day the public calendar does not carry. */
holidayRouter.post('/', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const body = parse(z.object({
    date: dateString,
    name: z.string().trim().min(2).max(120),
    region: z.string().trim().max(10).default('IN-KA'),
  }), req.body);

  const created = await one<any>(
    `INSERT INTO holidays (holiday_date, name, region, source, observed)
     VALUES ($1,$2,$3,'manual',true)
     ON CONFLICT (holiday_date, name, region)
       DO UPDATE SET observed = true, updated_at = now()
     RETURNING id, to_char(holiday_date,'YYYY-MM-DD') AS date, name, observed`,
    [body.date, body.name, body.region]);

  await recordAudit(req, { action: 'holiday.added', entityType: 'holiday', entityId: created.id, after: body });
  res.status(201).json(created);
}));

holidayRouter.delete('/:id', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const row = await one<any>(`DELETE FROM holidays WHERE id = $1 RETURNING id, name`, [req.params.id]);
  if (!row) throw notFound('Holiday');
  await recordAudit(req, { action: 'holiday.deleted', entityType: 'holiday', entityId: req.params.id,
    before: { name: row.name } });
  res.json({ ok: true });
}));
