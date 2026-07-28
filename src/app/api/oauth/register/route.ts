import { NextResponse } from 'next/server';
import { getStore } from '@/server/db';
import { registerClient, registrationSchema } from '@/server/oauth/service';
import { failure, readJson, route } from '@/server/http/respond';

/**
 * Dynamic Client Registration (RFC 7591).
 *
 * Open registration, which is what lets Claude add PhoneLab as a connector
 * without an out-of-band setup step. It is safe because a registered client can do
 * nothing on its own: it still has to send a user through the consent screen, and
 * the token it receives is bound to that user's own permissions.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request: Request) => {
  try {
    const input = await readJson(request, registrationSchema);
    const client = await registerClient(getStore(), input);
    return NextResponse.json(client, {
      status: 201,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    // RFC 7591 §3.2.2 expects an OAuth-style error body here.
    const response = failure(error);
    if (response.status === 422 || response.status === 400) {
      const body = (await response.json()) as { error?: { message?: string } };
      return NextResponse.json(
        {
          error: 'invalid_client_metadata',
          error_description: body.error?.message ?? 'Invalid client metadata.',
        },
        { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } },
      );
    }
    return response;
  }
});

export function OPTIONS(): Response {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
