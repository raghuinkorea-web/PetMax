import { Router } from 'express';
import { one } from '../lib/db.js';
import { asyncHandler } from '../lib/http.js';
import { forbidden, notFound } from '../lib/errors.js';
import { can, principalOf } from '../middleware/auth.js';
import { readStreamFor } from '../services/storage.js';
import { scopeFor } from '../services/scope.js';

export const fileRouter = Router();

/**
 * The ONLY way to read an uploaded file.
 *
 * Holding the file's id is not authorisation: the caller must be able to
 * see the record the file is attached to. Uploaders can always see their
 * own uploads; everyone else is checked against expense and assignment
 * visibility.
 */
fileRouter.get('/:id', asyncHandler(async (req, res) => {
  const p = principalOf(req);

  const file = await one<{
    storage_key: string; mime_type: string; original_name: string;
    uploaded_by: string; purpose: string; claim_owner: string | null;
    claim_project: string | null; assignment_assignee: string | null; avatar_of: string | null;
  }>(
    `SELECT f.storage_key, f.mime_type, f.original_name, f.uploaded_by, f.purpose,
            ec.user_id        AS claim_owner,
            ec.project_id     AS claim_project,
            wa.assignee_id    AS assignment_assignee,
            au.id             AS avatar_of
       FROM files f
       LEFT JOIN expense_attachments ea ON ea.file_id = f.id
       LEFT JOIN expense_claims ec      ON ec.id = ea.claim_id AND ec.deleted_at IS NULL
       LEFT JOIN work_assignment_attachments wat ON wat.file_id = f.id
       LEFT JOIN work_assignments wa    ON wa.id = wat.assignment_id AND wa.deleted_at IS NULL
       LEFT JOIN users au               ON au.avatar_file_id = f.id
      WHERE f.id = $1 AND f.deleted_at IS NULL
      LIMIT 1`, [req.params.id]);

  if (!file) throw notFound('File');

  const allowed = await (async () => {
    if (file.uploaded_by === p.id) return true;
    // Avatars are visible to anyone who can see the employee directory.
    if (file.avatar_of) return scopeFor(p, 'employee.view') !== 'none';

    if (file.claim_owner) {
      const scope = scopeFor(p, 'expense.view');
      if (scope === 'all') return true;
      if (scope === 'own') return file.claim_owner === p.id;
      if (scope === 'team') {
        const row = await one(
          `SELECT 1 AS ok FROM users u
            WHERE u.id = $1
              AND (u.reporting_manager_id = $2
                   OR EXISTS (SELECT 1 FROM projects pr WHERE pr.id = $3 AND pr.manager_id = $2))`,
          [file.claim_owner, p.id, file.claim_project]);
        return Boolean(row);
      }
      return false;
    }

    if (file.assignment_assignee) {
      const scope = scopeFor(p, 'work.view');
      if (scope === 'all') return true;
      if (scope === 'own') return file.assignment_assignee === p.id;
      if (scope === 'team') {
        const row = await one(
          `SELECT 1 AS ok FROM users u WHERE u.id = $1 AND u.reporting_manager_id = $2`,
          [file.assignment_assignee, p.id]);
        return Boolean(row);
      }
      return false;
    }

    // An orphaned file (uploaded but not yet attached) stays private to its uploader.
    return can(req, 'audit.view');
  })();

  if (!allowed) throw forbidden('You do not have access to this file.');

  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition',
    `inline; filename="${encodeURIComponent(file.original_name)}"`);
  res.setHeader('Cache-Control', 'private, max-age=300, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  readStreamFor(file.storage_key)
    .on('error', () => { if (!res.headersSent) res.status(404).end(); })
    .pipe(res);
}));
