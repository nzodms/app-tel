/**
 * Browser-side fetch helper.
 *
 * One place that knows how the API reports failures, so every call site can just
 * `try/catch` and show `error.message` — which is always something a person can
 * act on, because that is what the services produce.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Diagnostic reference on 5xx — the thread to the server log line. */
  readonly reference: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    reference?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.reference = reference;
    this.details = details;
  }
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    reference?: string;
    details?: Record<string, unknown>;
  };
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body), headers: { 'Content-Type': 'application/json' } }),
      ...(options.signal ? { signal: options.signal } : {}),
      credentials: 'same-origin',
    });
  } catch (cause) {
    // The request never left, or never came back. Distinct from a 5xx: there is
    // no server-side log line to reference, and retrying may well work.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'network_error', 'Could not reach PhoneLab. Check your connection.');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text === '' ? null : safeParse(text);

  if (!response.ok) {
    const body = (payload ?? {}) as ApiErrorBody;
    throw new ApiError(
      response.status,
      body.error?.code ?? 'internal',
      body.error?.message ?? `Request failed with status ${response.status}.`,
      body.error?.reference,
      body.error?.details,
    );
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/**
 * Turns a failure into something a person can act on.
 *
 * The server already writes actionable messages for the cases it can name; this
 * adds the front-end half — telling someone whose account exists to sign in
 * instead, and telling someone hitting an outage that it is not their fault and
 * giving them the reference to quote.
 */
export interface FriendlyError {
  message: string;
  /** A next step, when there is a useful one. */
  hint?: string;
  reference?: string;
  /** True when retrying the same thing later is likely to work. */
  retryable: boolean;
}

export function friendlyError(error: unknown): FriendlyError {
  if (!(error instanceof ApiError)) {
    return { message: errorText(error), retryable: false };
  }

  switch (error.code) {
    case 'conflict':
      return {
        message: 'An account already exists for that email address.',
        hint: 'Sign in instead, or use a different address.',
        retryable: false,
      };
    case 'validation_failed':
    case 'bad_request':
      return { message: error.message, retryable: false };
    case 'rate_limited':
      return {
        message: 'Too many attempts. Wait a minute and try again.',
        retryable: true,
      };
    case 'network_error':
      return { message: error.message, retryable: true };
    case 'storage_unavailable':
      return {
        message: 'PhoneLab’s database is not reachable right now.',
        hint: 'This is on our side, not yours. Try again in a moment.',
        ...(error.reference ? { reference: error.reference } : {}),
        retryable: true,
      };
    case 'schema_missing':
    case 'configuration_error':
      return {
        message: 'This PhoneLab deployment is not fully configured yet.',
        hint: error.message,
        ...(error.reference ? { reference: error.reference } : {}),
        retryable: false,
      };
    default:
      return {
        message: 'Could not complete that.',
        hint: 'If it keeps happening, quote the reference below.',
        ...(error.reference ? { reference: error.reference } : {}),
        retryable: true,
      };
  }
}
