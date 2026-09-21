/** Typed application errors. Every failure the client can act on has a stable code. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string[]>,
  ) { super(message); this.name = 'AppError'; }
}

export const badRequest  = (m: string, d?: Record<string, string[]>) => new AppError(400, 'BAD_REQUEST', m, d);
export const unauthorized= (m = 'Authentication required')           => new AppError(401, 'UNAUTHENTICATED', m);
export const forbidden   = (m = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', m);
export const notFound    = (what = 'Resource')                       => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict    = (m: string, c = 'CONFLICT')               => new AppError(409, c, m);
export const unprocessable = (m: string, d?: Record<string, string[]>) => new AppError(422, 'VALIDATION_FAILED', m, d);
export const tooLarge    = (m: string)                               => new AppError(413, 'PAYLOAD_TOO_LARGE', m);
