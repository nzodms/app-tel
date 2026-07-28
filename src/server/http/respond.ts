import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError, isAppError } from '../core/errors';
import { describeError, log, newDiagnosticRef } from '../core/logging';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Present on 5xx: quote this and the matching log line can be found. */
    reference?: string;
    details?: Record<string, unknown>;
  };
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, { status: 200, ...init });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json(data as object, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function failure(error: unknown): NextResponse {
  if (isAppError(error)) {
    // A configuration or storage failure is ours, not the caller's, and needs to
    // be findable in the logs even though it is not a 500.
    if (error.status >= 500) {
      const reference = newDiagnosticRef();
      log('error', 'route.failed', {
        reference,
        code: error.code,
        message: error.message,
        details: error.details,
      });
      const body: ApiErrorBody = {
        error: {
          code: error.code,
          message: error.message,
          reference,
          ...(error.details ? { details: error.details } : {}),
        },
      };
      return NextResponse.json(body, { status: error.status });
    }
    const body: ApiErrorBody = {
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    };
    return NextResponse.json(body, { status: error.status });
  }

  if (error instanceof z.ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: 'validation_failed',
        message: firstZodMessage(error),
        details: { issues: error.issues },
      },
    };
    return NextResponse.json(body, { status: 422 });
  }

  // Anything reaching here is a bug. The reference is the only thread between
  // what the person saw on screen and the line that explains it, so it goes in
  // both places — that is the whole reason it exists.
  const reference = newDiagnosticRef();
  log('error', 'route.unhandled', { reference, error: describeError(error) });
  if (error instanceof Error && error.stack) {
    console.error(`[phonelab] ${reference} stack`, error.stack);
  }
  const body: ApiErrorBody = {
    error: {
      code: 'internal',
      message: `Something went wrong on our side. Reference: ${reference}`,
      reference,
    },
  };
  return NextResponse.json(body, { status: 500 });
}

export function firstZodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request.';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Wraps a route handler so domain errors become well-formed JSON responses. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return failure(error);
    }
  };
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('bad_request', 'Request body must be valid JSON.');
  }
  return schema.parse(raw);
}
