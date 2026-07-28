/**
 * Domain errors carry an HTTP status and a stable machine code so that the REST
 * routes and the MCP tool layer can both translate them without duplicating
 * knowledge about what went wrong.
 */
export type AppErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'validation_failed'
  | 'confirmation_required'
  | 'internal';

const STATUS: Record<AppErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  validation_failed: 422,
  confirmation_required: 428,
  internal: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: AppErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError('bad_request', message, details);
export const unauthorized = (message = 'Authentication required.') =>
  new AppError('unauthorized', message);
export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError('forbidden', message);
export const notFound = (message = 'Not found.') => new AppError('not_found', message);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError('conflict', message, details);
export const tooLarge = (message: string, details?: Record<string, unknown>) =>
  new AppError('payload_too_large', message, details);
export const rateLimited = (message = 'Too many requests.') =>
  new AppError('rate_limited', message);
export const confirmationRequired = (message: string, details?: Record<string, unknown>) =>
  new AppError('confirmation_required', message, details);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
