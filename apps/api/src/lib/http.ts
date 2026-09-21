import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { unprocessable } from './errors.js';

/** Wraps an async handler so rejected promises reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { void fn(req, res, next).catch(next); };

/** Validates and narrows a request part, raising a field-level 422 on failure. */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    (details[key] ??= []).push(issue.message);
  }
  throw unprocessable('Please correct the highlighted fields.', details);
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(25),
});

export interface PageMeta { number: number; size: number; total: number; totalPages: number }

export const pageMeta = (page: number, size: number, total: number): PageMeta => ({
  number: page, size, total, totalPages: Math.max(1, Math.ceil(total / size)),
});

export const offsetOf = (page: number, size: number) => (page - 1) * size;

/** ISO date string (YYYY-MM-DD) used consistently for all business dates. */
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
export const uuid = z.string().uuid('Not a valid identifier');
