import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import {
  createPersonalToken,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  issueAuthorizationCode,
  prepareAuthorization,
  registerClient,
  resolveAccessToken,
  revokeConnection,
} from '@/server/oauth/service';
import { mcpResourceUri, unauthorizedChallenge } from '@/server/oauth/urls';
import { makeFixture, type Fixture } from './helpers';

const BASE = 'https://phonelab.test';
const RESOURCE = mcpResourceUri(BASE);
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

let fixture: Fixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

function pkce() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function registerAndAuthorize(scopes = 'projects.read projects.write') {
  fixture = await makeFixture();
  const store = fixture.store;
  const client = await registerClient(store, {
    client_name: 'Claude',
    redirect_uris: [REDIRECT],
  });
  const { verifier, challenge } = pkce();

  const context = await prepareAuthorization(
    store,
    {
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: scopes,
      state: 'xyz',
      resource: RESOURCE,
    },
    RESOURCE,
  );

  const code = await issueAuthorizationCode(store, context, fixture.userId, context.scopes);
  return { store, client, code, verifier, context, userId: fixture.userId };
}

describe('client registration', () => {
  it('registers a public client without a secret', async () => {
    fixture = await makeFixture();
    const client = await registerClient(fixture.store, {
      client_name: 'Claude',
      redirect_uris: [REDIRECT],
    });
    expect(client.client_id).toMatch(/^plc_/);
    expect(client.client_secret).toBeUndefined();
    expect(client.token_endpoint_auth_method).toBe('none');
  });

  it('rejects unsafe redirect URIs', async () => {
    fixture = await makeFixture();
    await expect(
      registerClient(fixture.store, { redirect_uris: ['http://evil.example.com/cb'] }),
    ).rejects.toThrow(/https, a loopback http address, or a custom scheme/);
    await expect(
      registerClient(fixture.store, { redirect_uris: ['https://ok.example.com/cb#frag'] }),
    ).rejects.toThrow(/must not contain a fragment/);
  });

  it('allows loopback and custom schemes for desktop clients', async () => {
    fixture = await makeFixture();
    await expect(
      registerClient(fixture.store, {
        redirect_uris: ['http://127.0.0.1:8976/callback', 'myapp://auth'],
      }),
    ).resolves.toBeTruthy();
  });

  it('refuses grant types it does not implement', async () => {
    fixture = await makeFixture();
    await expect(
      registerClient(fixture.store, {
        redirect_uris: [REDIRECT],
        grant_types: ['client_credentials'],
      }),
    ).rejects.toThrow(/Unsupported grant_types/);
  });
});

describe('authorization request validation', () => {
  it('rejects a redirect_uri that is not registered exactly', async () => {
    fixture = await makeFixture();
    const client = await registerClient(fixture.store, { redirect_uris: [REDIRECT] });
    const { challenge } = pkce();
    await expect(
      prepareAuthorization(
        fixture.store,
        {
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: `${REDIRECT}/extra`,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          resource: RESOURCE,
        },
        RESOURCE,
      ),
    ).rejects.toThrow(/does not exactly match/);
  });

  it('rejects a resource that is not this server', async () => {
    fixture = await makeFixture();
    const client = await registerClient(fixture.store, { redirect_uris: [REDIRECT] });
    const { challenge } = pkce();
    await expect(
      prepareAuthorization(
        fixture.store,
        {
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          resource: 'https://somewhere-else.example.com/mcp',
        },
        RESOURCE,
      ),
    ).rejects.toThrow(/is not this MCP server/);
  });
});

describe('token exchange', () => {
  it('issues tokens for a valid code + verifier', async () => {
    const { store, client, code, verifier } = await registerAndAuthorize();
    const tokens = await exchangeAuthorizationCode(
      store,
      { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier },
      RESOURCE,
    );
    expect(tokens.access_token).toMatch(/^pla_/);
    expect(tokens.refresh_token).toMatch(/^plr_/);
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.scope).toContain('projects.read');
  });

  it('rejects a wrong PKCE verifier', async () => {
    const { store, client, code } = await registerAndAuthorize();
    await expect(
      exchangeAuthorizationCode(
        store,
        { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: 'wrong' },
        RESOURCE,
      ),
    ).rejects.toThrow(/PKCE verification failed/);
  });

  it('rejects a replayed code and revokes the grant', async () => {
    const { store, client, code, verifier } = await registerAndAuthorize();
    const tokens = await exchangeAuthorizationCode(
      store,
      { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier },
      RESOURCE,
    );

    await expect(
      exchangeAuthorizationCode(
        store,
        { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier },
        RESOURCE,
      ),
    ).rejects.toThrow(/already used/);

    // Replay invalidates everything that code produced.
    await expect(resolveAccessToken(store, tokens.access_token, RESOURCE)).rejects.toThrow(
      /revoked/,
    );
  });

  it('rejects a mismatched redirect_uri at the token endpoint', async () => {
    const { store, client, code, verifier } = await registerAndAuthorize();
    await expect(
      exchangeAuthorizationCode(
        store,
        {
          code,
          clientId: client.client_id,
          redirectUri: 'https://claude.ai/other',
          codeVerifier: verifier,
        },
        RESOURCE,
      ),
    ).rejects.toThrow(/redirect_uri does not match/);
  });

  it('rotates refresh tokens', async () => {
    const { store, client, code, verifier } = await registerAndAuthorize();
    const first = await exchangeAuthorizationCode(
      store,
      { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier },
      RESOURCE,
    );
    const second = await exchangeRefreshToken(
      store,
      { refreshToken: first.refresh_token, clientId: client.client_id },
      RESOURCE,
    );
    expect(second.refresh_token).not.toBe(first.refresh_token);

    await expect(
      exchangeRefreshToken(
        store,
        { refreshToken: first.refresh_token, clientId: client.client_id },
        RESOURCE,
      ),
    ).rejects.toThrow(/revoked/);
  });
});

describe('resource server validation', () => {
  it('accepts a token issued for this resource', async () => {
    const { store, client, code, verifier, userId } = await registerAndAuthorize();
    const tokens = await exchangeAuthorizationCode(
      store,
      { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier },
      RESOURCE,
    );
    const resolved = await resolveAccessToken(store, tokens.access_token, RESOURCE);
    expect(resolved.actor.userId).toBe(userId);
    expect(resolved.actor.via).toBe('mcp');
  });

  it('rejects a token minted for a different audience', async () => {
    const { store, client, code, verifier } = await registerAndAuthorize();
    const tokens = await exchangeAuthorizationCode(
      store,
      { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier },
      RESOURCE,
    );
    await expect(
      resolveAccessToken(store, tokens.access_token, 'https://other.example.com/mcp'),
    ).rejects.toThrow(/not issued for this MCP server/);
  });

  it('rejects a token whose connection was revoked in the UI', async () => {
    const { store, client, code, verifier, userId } = await registerAndAuthorize();
    const tokens = await exchangeAuthorizationCode(
      store,
      { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifier },
      RESOURCE,
    );
    const resolved = await resolveAccessToken(store, tokens.access_token, RESOURCE);
    await revokeConnection(store, userId, resolved.actor.connectionId as string);

    await expect(resolveAccessToken(store, tokens.access_token, RESOURCE)).rejects.toThrow(
      /revoked/,
    );
  });

  it('accepts a personal access token on the same path', async () => {
    fixture = await makeFixture();
    const { token } = await createPersonalToken(fixture.store, fixture.userId, {
      name: 'Inspector',
      scopes: ['projects.read'],
      resource: RESOURCE,
    });
    const resolved = await resolveAccessToken(fixture.store, token, RESOURCE);
    expect(resolved.actor.scopes).toEqual(['projects.read']);
  });

  it('stores only token hashes', async () => {
    fixture = await makeFixture();
    const { token } = await createPersonalToken(fixture.store, fixture.userId, {
      name: 'Inspector',
      scopes: ['projects.read'],
      resource: RESOURCE,
    });
    const rows = await fixture.store.select('oauthTokens', {});
    expect(rows.every((row) => row.tokenHash !== token)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});

describe('challenge headers', () => {
  it('points at the protected resource metadata', () => {
    const challenge = unauthorizedChallenge(BASE, ['projects.read']);
    expect(challenge).toContain('Bearer resource_metadata=');
    expect(challenge).toContain('/.well-known/oauth-protected-resource');
    expect(challenge).toContain('scope="projects.read"');
  });
});
