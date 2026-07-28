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
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body), headers: { 'Content-Type': 'application/json' } }),
    ...(options.signal ? { signal: options.signal } : {}),
    credentials: 'same-origin',
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text === '' ? null : safeParse(text);

  if (!response.ok) {
    const body = (payload ?? {}) as ApiErrorBody;
    throw new ApiError(
      response.status,
      body.error?.code ?? 'internal',
      body.error?.message ?? `Request failed with status ${response.status}.`,
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
