import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { config } from '../config.js';

/** Maps Postgres integrity violations onto messages an operator can act on. */
function fromPostgres(err: any): AppError | null {
  if (!err?.code || typeof err.code !== 'string') return null;
  switch (err.code) {
    case '23505': { // unique_violation
      const constraint = String(err.constraint ?? '');
      const friendly: Record<string, string> = {
        uq_users_email: 'That email address is already registered to another employee.',
        uq_users_phone: 'That mobile number is already registered to another employee.',
        users_employee_code_key: 'That employee ID is already in use.',
        uq_time_entry_running: 'You already have a timer running. Stop it before starting another.',
        uq_attendance_open_session: 'You are already checked in.',
        uq_ack_assignment_version: 'This version of the assignment has already been acknowledged.',
        uq_project_member_active: 'That employee is already assigned to this project.',
        uq_reimbursement_claim: 'This claim has already been included in a reimbursement batch.',
      };
      return new AppError(409, 'CONFLICT', friendly[constraint] ?? 'That record already exists.');
    }
    case '23503': return new AppError(409, 'REFERENCE_INVALID', 'A referenced record does not exist or is still in use.');
    case '23514': return new AppError(422, 'CONSTRAINT_FAILED', 'The submitted values are not valid for this record.');
    case '22P02': return new AppError(400, 'BAD_REQUEST', 'A supplied identifier is malformed.');
    default: return null;
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const mapped = err instanceof AppError ? err : fromPostgres(err);

  if (mapped) {
    if (mapped.status >= 500) console.error('[error]', req.requestId, mapped);
    res.status(mapped.status).json({
      error: { code: mapped.code, message: mapped.message, details: mapped.details, requestId: req.requestId },
    });
    return;
  }

  console.error('[unhandled]', req.requestId, req.method, req.originalUrl, err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. The incident has been logged.',
      requestId: req.requestId,
      ...(config.isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
    },
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `No API route matches ${req.method} ${req.path}`, requestId: req.requestId },
  });
}
