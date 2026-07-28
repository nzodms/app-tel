import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError, isAppError } from '../core/errors';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
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

  console.error('[phonelab] unhandled route error', error);
  const body: ApiErrorBody = {
    error: { code: 'internal', message: 'Something went wrong on our side.' },
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
