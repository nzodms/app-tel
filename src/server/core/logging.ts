/**
 * Structured logging.
 *
 * One JSON object per line on stdout/stderr, which is what Vercel's Runtime Logs
 * index and let you search. A human-readable line is unsearchable the moment the
 * thing you need to find is in production.
 *
 * The redaction list below is not advisory. Anything whose key looks like a
 * secret is replaced before serialisation, so a future caller cannot leak a
 * password or a session token by passing the wrong object.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Key fragments that must never reach a log line, whatever the caller passes. */
const SECRET_KEY_PATTERN =
  /pass(word)?|secret|token|cookie|authorization|apikey|api_key|servicerole|service_role|credential|session|hash|salt|private/i;

const REDACTED = '[redacted]';

/** Values that are safe to print in full because they identify without revealing. */
const ALLOWED_ID_KEYS = new Set(['requestId', 'userId', 'workspaceId', 'projectId', 'sessionId']);

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => redact(entry, depth + 1));
  if (value instanceof Error) return describeError(value);
  if (typeof value !== 'object') return String(value);

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key) && !ALLOWED_ID_KEYS.has(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redact(entry, depth + 1);
  }
  return out;
}

export interface ErrorShape {
  type: string;
  message: string;
  code?: string;
  /** `cause` is where the real reason usually lives — an EROFS, a fetch failure. */
  cause?: ErrorShape | string;
}

/**
 * The shape of an error, without the stack.
 *
 * A message and an errno tell you what to fix; a stack through minified Next.js
 * frames rarely does, and it is the part most likely to contain a connection
 * string. The stack still goes to `console.error` separately.
 */
export function describeError(error: unknown): ErrorShape {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    const cause = (error as { cause?: unknown }).cause;
    return {
      type: error.name,
      message: error.message,
      ...(code ? { code: String(code) } : {}),
      ...(cause ? { cause: cause instanceof Error ? describeError(cause) : String(cause) } : {}),
    };
  }
  return { type: typeof error, message: String(error) };
}

export interface LogFields {
  [key: string]: unknown;
}

let cachedBase: LogFields | null = null;

/** Facts about the deployment that every line should carry. */
function baseFields(): LogFields {
  if (cachedBase) return cachedBase;
  cachedBase = {
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    // Vercel sets these; locally they are simply absent.
    ...(process.env.VERCEL_REGION ? { region: process.env.VERCEL_REGION } : {}),
    ...(process.env.VERCEL_GIT_COMMIT_SHA
      ? { commit: process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) }
      : {}),
  };
  return cachedBase;
}

/** Reset memoised deployment facts. Tests only. */
export function resetLoggingCache(): void {
  cachedBase = null;
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    level,
    event,
    ...baseFields(),
    ...(redact(fields) as LogFields),
    at: new Date().toISOString(),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

/**
 * A short, human-quotable reference tying a user-facing error to its log line.
 *
 * `PL-` + 8 uppercase base32 characters: unambiguous over the phone, and short
 * enough that someone will actually paste it into a bug report.
 */
export function newDiagnosticRef(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `PL-${out}`;
}

/**
 * Correlates our logs with Vercel's.
 *
 * Vercel puts a request id on every invocation; reusing it means a line found in
 * Runtime Logs and a line found in our own output are the same request. Off
 * Vercel there is no such header, so we mint one.
 */
export function requestIdFrom(request: Request | null): string {
  const header =
    request?.headers.get('x-vercel-id') ??
    request?.headers.get('x-request-id') ??
    request?.headers.get('x-vercel-proxy-signature-ts');
  if (header) return header.slice(0, 120);
  return newDiagnosticRef();
}

/**
 * Times a sequence of named steps and logs each one.
 *
 * The point is that a failure says *which* step failed. "signup failed" sends you
 * reading code; "signup.failed at workspace_created after 40ms with EROFS" does not.
 */
export class StepTimer {
  private readonly startedAt = Date.now();
  private stepStartedAt = Date.now();
  private current = 'start';

  constructor(
    private readonly prefix: string,
    private readonly context: LogFields,
  ) {}

  /** Marks a step reached. */
  step(name: string, fields: LogFields = {}): void {
    const now = Date.now();
    log('info', `${this.prefix}.${name}`, {
      ...this.context,
      ...fields,
      stepMs: now - this.stepStartedAt,
      totalMs: now - this.startedAt,
    });
    this.current = name;
    this.stepStartedAt = now;
  }

  /** The last step that completed, for failure reporting. */
  get lastStep(): string {
    return this.current;
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  fail(error: unknown, fields: LogFields = {}): void {
    log('error', `${this.prefix}.failed`, {
      ...this.context,
      ...fields,
      failedAfterStep: this.current,
      error: describeError(error),
      totalMs: this.elapsedMs,
    });
    // The stack goes out separately so it is available when needed without
    // bloating (or contaminating) the structured line.
    if (error instanceof Error && error.stack) {
      console.error(`[${this.prefix}] stack`, error.stack);
    }
  }
}
