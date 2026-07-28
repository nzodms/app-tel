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
  /** The deployment is missing configuration. Not the caller's fault, not transient. */
  | 'configuration_error'
  /** The database is configured but unreachable, or rejected the query. Retryable. */
  | 'storage_unavailable'
  /** The database is reachable but does not have the schema — a migration is missing. */
  | 'schema_missing'
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
  // 503, not 500: the deployment is misconfigured or its database is down, which
  // is a service-availability problem an operator fixes — and it tells a probe
  // or a load balancer not to treat the instance as healthy.
  configuration_error: 503,
  storage_unavailable: 503,
  schema_missing: 503,
  internal: 500,
};

/**
 * Codes a client may branch on.
 *
 * The REST layer sends these as `error.code`; the sign-up form maps a handful of
 * them to specific messages and everything else to a generic one with a
 * diagnostic reference. Keeping the list here means the two cannot drift.
 */
export const CLIENT_ERROR_CODES = {
  INVALID_INPUT: 'validation_failed',
  EMAIL_ALREADY_EXISTS: 'conflict',
  DATABASE_UNAVAILABLE: 'storage_unavailable',
  DATABASE_SCHEMA_MISSING: 'schema_missing',
  AUTH_CONFIGURATION_ERROR: 'configuration_error',
  RATE_LIMITED: 'rate_limited',
  INTERNAL_ERROR: 'internal',
} as const;

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
export const configurationError = (message: string, details?: Record<string, unknown>) =>
  new AppError('configuration_error', message, details);
export const storageUnavailable = (
  message = 'The database is not reachable right now. Try again in a moment.',
  details?: Record<string, unknown>,
) => new AppError('storage_unavailable', message, details);
export const schemaMissing = (message: string, details?: Record<string, unknown>) =>
  new AppError('schema_missing', message, details);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
