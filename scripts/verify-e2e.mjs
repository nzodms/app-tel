// End-to-end smoke test against a running PhoneLab server.
//
// Exercises the paths that are easy to break and hard to notice: project creation
// from a template, the preview compile, the MCP handshake and tool surface, an MCP
// patch landing in the working tree, snapshot + compare, and the share/comment flow
// a reviewer actually uses.
//
//   npm run build && npm start &            # or: npm run dev
//   node scripts/verify-e2e.mjs http://localhost:3000
//
// Exits non-zero on the first failure.

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');

let cookie = '';
let passed = 0;
const failures = [];

function ok(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

async function call(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    const match = /pl_session=([^;]*)/.exec(setCookie);
    if (match) cookie = `pl_session=${match[1]}`;
  }

  if (raw) return response;
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, headers: response.headers, json };
}

async function mcp(token, method, params) {
  const response = await fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method, params }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function tool(token, name, args) {
  const result = await mcp(token, 'tools/call', { name, arguments: args });
  const payload = result.body?.result;
  return {
    status: result.status,
    isError: payload?.isError === true,
    text: payload?.content?.[0]?.text ?? '',
    data: payload?.structuredContent ?? null,
    error: result.body?.error ?? null,
  };
}

/* -------------------------------------------------------------------------- */

const stamp = Date.now().toString(36);
const email = `e2e-${stamp}@phonelab.test`;

section('Routing before sign-in');
const anonOnboarding = await call('/onboarding', { raw: true });
ok(
  '/onboarding sends an anonymous visitor to sign in',
  anonOnboarding.status === 307 &&
    (anonOnboarding.headers.get('location') ?? '').includes('next=%2Fonboarding'),
  `${anonOnboarding.status} → ${anonOnboarding.headers.get('location')}`,
);
const anonDashboard = await call('/dashboard', { raw: true });
ok('/dashboard sends an anonymous visitor to sign in', anonDashboard.status === 307);

section('Auth');
const signup = await call('/api/auth/signup', {
  method: 'POST',
  body: { name: 'E2E Tester', email, password: 'verification-pass-1' },
});
ok('sign up creates an account and a workspace', signup.status === 201, `status ${signup.status}`);
ok('session cookie issued', cookie.startsWith('pl_session='));

section('Onboarding');
ok('a new account has not been onboarded', signup.json?.user?.onboardingCompletedAt === null);
ok('a new account has default preferences', signup.json?.user?.preferences?.leftPaneWidth === 25);

for (const path of ['/', '/app', '/dashboard']) {
  const response = await call(path, { raw: true });
  ok(
    `${path} routes a new account to onboarding`,
    response.headers.get('location') === '/onboarding',
    String(response.headers.get('location')),
  );
}

const onboardingPage = await call('/onboarding', { raw: true });
ok('/onboarding renders', onboardingPage.status === 200, `status ${onboardingPage.status}`);

const saved = await call('/api/onboarding', {
  method: 'POST',
  body: { action: 'save', step: 2, draft: { appName: `Padel Nord ${stamp}`, category: 'booking' } },
});
ok('a step is persisted', saved.json?.state?.step === 2, JSON.stringify(saved.json).slice(0, 160));
const reread = await call('/api/onboarding');
ok('the draft survives a reload', reread.json?.state?.draft?.category === 'booking');
ok('and the account is still not onboarded', reread.json?.state?.completed === false);

const completed = await call('/api/onboarding', {
  method: 'POST',
  body: {
    action: 'complete',
    draft: {
      appName: `Padel Nord ${stamp}`,
      category: 'booking',
      summary: 'Members book a court and the club confirms it.',
      roles: ['member', 'club'],
      startWith: 'generated',
    },
  },
});
const generatedId = completed.json?.projectId;
ok('completing onboarding creates a project', typeof generatedId === 'string', String(generatedId));
ok('and lands in that project', completed.json?.redirectTo === `/studio/${generatedId}`);
ok('and records completion', typeof completed.json?.state?.completedAt === 'string');

const generatedFiles = await call(`/api/projects/${generatedId}/files`);
const generatedPaths = (generatedFiles.json?.files ?? []).map((file) => file.path);
ok('the generated project has an entry point', generatedPaths.includes('src/App.tsx'));
ok('and the config generated from the brief', generatedPaths.includes('src/lib/config.ts'));

const generatedBuild = await call(`/api/projects/${generatedId}/preview/build`, {
  method: 'POST',
  body: { ref: 'working' },
});
ok(
  'the generated project compiles',
  generatedBuild.json?.ok === true &&
    (generatedBuild.json?.diagnostics ?? []).every((entry) => entry.severity !== 'error'),
  JSON.stringify(generatedBuild.json?.diagnostics ?? []).slice(0, 240),
);

const generatedDevices = await call(`/api/projects/${generatedId}/devices`);
const generatedRoles = (generatedDevices.json?.devices ?? []).map((device) => device.role).sort();
ok('one phone per brief role', JSON.stringify(generatedRoles) === '["club","member"]', JSON.stringify(generatedRoles));

for (const [path, expected] of [
  ['/', '/dashboard'],
  ['/app', '/dashboard'],
  ['/onboarding', '/dashboard'],
]) {
  const response = await call(path, { raw: true });
  ok(
    `${path} routes an onboarded account to ${expected}`,
    response.headers.get('location') === expected,
    String(response.headers.get('location')),
  );
}
const revisit = await call('/onboarding?again=1', { raw: true });
ok('/onboarding?again=1 stays reachable after finishing', revisit.status === 200);

for (const path of ['/dashboard', '/projects/new', '/settings', '/settings/connections', '/settings/workspace']) {
  const response = await call(path, { raw: true });
  ok(`${path} renders`, response.status === 200, `status ${response.status}`);
}

const demo = await call('/api/projects/demo', { method: 'POST', body: {} });
ok('the demo can be created from the dashboard', demo.status === 201, `status ${demo.status}`);
ok('and is flagged as a demo, not as your own work', demo.json?.project?.isDemo === true);

const afterReset = await call('/api/onboarding', { method: 'POST', body: { action: 'reset' } });
ok('onboarding can be reopened', afterReset.json?.state?.completed === false);
const keptProjects = await call('/api/projects');
ok(
  'reopening it keeps every project',
  (keptProjects.json?.projects ?? []).length >= 2,
  `${(keptProjects.json?.projects ?? []).length} projects`,
);
const skipped = await call('/api/onboarding', { method: 'POST', body: { action: 'skip' } });
ok('onboarding can be skipped', skipped.json?.state?.completed === true);

const prefs = await call('/api/me', {
  method: 'PATCH',
  body: { preferences: { leftPaneWidth: 34 } },
});
ok('preferences save', prefs.json?.user?.preferences?.leftPaneWidth === 34);
ok('and merge rather than replace', prefs.json?.user?.preferences?.canvasSnap === true);

section('Project creation from the PadelFlow template');
const create = await call('/api/projects', {
  method: 'POST',
  body: { name: `PadelFlow ${stamp}`, templateId: 'padelflow' },
});
const projectId = create.json?.project?.id;
ok('project created', create.status === 201 && Boolean(projectId), JSON.stringify(create.json).slice(0, 200));
ok('two versions created (V1 + V2)', create.json?.versionIds?.length === 2, `got ${create.json?.versionIds?.length}`);
ok('two devices placed on the canvas', create.json?.deviceIds?.length === 2);

const files = await call(`/api/projects/${projectId}/files`);
ok('working tree populated', (files.json?.files?.length ?? 0) > 15, `${files.json?.files?.length} files`);
ok('file tree is nested', Array.isArray(files.json?.tree) && files.json.tree.length > 0);

section('Preview compile');
const build = await call(`/api/projects/${projectId}/preview/build`, {
  method: 'POST',
  body: { ref: 'working' },
});
ok('project compiles', build.json?.ok === true, JSON.stringify(build.json?.diagnostics ?? []).slice(0, 400));
ok('bundle wired to the runtime registry', String(build.json?.code ?? '').includes('__PHONELAB_REQUIRE__'));
ok('JSX carries source locations for click-to-code', String(build.json?.code ?? '').includes('fileName: "src/'));
ok('bundle hash returned', typeof build.json?.hash === 'string' && build.json.hash.length === 16);

section('MCP discovery metadata');
const prm = await call('/.well-known/oauth-protected-resource');
ok('protected resource metadata served', prm.status === 200 && prm.json?.resource?.endsWith('/api/mcp'));
const prmPath = await call('/.well-known/oauth-protected-resource/api/mcp');
ok('path-suffixed resource metadata served', prmPath.status === 200);
const asm = await call('/.well-known/oauth-authorization-server');
ok('authorization server metadata served', asm.status === 200);
ok('PKCE S256 only', JSON.stringify(asm.json?.code_challenge_methods_supported) === '["S256"]');
ok('dynamic client registration advertised', typeof asm.json?.registration_endpoint === 'string');

section('MCP authorization');
const unauth = await fetch(`${base}/api/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
ok('unauthenticated MCP request rejected', unauth.status === 401, `status ${unauth.status}`);
ok(
  'WWW-Authenticate points at the resource metadata',
  (unauth.headers.get('www-authenticate') ?? '').includes('resource_metadata='),
);
const getMcp = await fetch(`${base}/api/mcp`, { headers: { Accept: 'text/event-stream' } });
ok('GET returns 405 (no server-initiated stream)', getMcp.status === 405, `status ${getMcp.status}`);

const dcr = await call('/api/oauth/register', {
  method: 'POST',
  body: { client_name: 'E2E client', redirect_uris: ['https://example.com/callback'] },
});
ok('dynamic client registration works', dcr.status === 201 && typeof dcr.json?.client_id === 'string');

const tokenResponse = await call('/api/mcp-tokens', {
  method: 'POST',
  body: {
    name: 'E2E token',
    scopes: ['projects.read', 'projects.write', 'preview.run', 'share.manage'],
  },
});
const token = tokenResponse.json?.token;
ok('personal access token issued', tokenResponse.status === 201 && typeof token === 'string');

const badAudience = await fetch(`${base}/api/mcp`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer pla_not-a-real-token',
    'MCP-Protocol-Version': '2025-11-25',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
ok('unknown bearer token rejected', badAudience.status === 401);

const badVersion = await fetch(`${base}/api/mcp`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'MCP-Protocol-Version': '1999-01-01',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
ok('unsupported protocol version rejected with 400', badVersion.status === 400);

section('MCP handshake and tools');
const init = await mcp(token, 'initialize', {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'e2e', version: '1' },
});
ok('initialize negotiates the requested revision', init.body?.result?.protocolVersion === '2025-11-25');
ok('server declares the tools capability', Boolean(init.body?.result?.capabilities?.tools));
ok('server identifies itself', init.body?.result?.serverInfo?.name === 'phonelab');

const notified = await fetch(`${base}/api/mcp`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'MCP-Protocol-Version': '2025-11-25',
  },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
});
ok('notifications answered with 202 and no body', notified.status === 202);

const list = await mcp(token, 'tools/list');
const tools = list.body?.result?.tools ?? [];
ok('tools advertised', tools.length >= 40, `${tools.length} tools`);
ok(
  'every tool has a JSON Schema input',
  tools.every((entry) => entry.inputSchema && entry.inputSchema.type === 'object'),
);
ok(
  'destructive tools are annotated',
  tools.find((entry) => entry.name === 'delete_file')?.annotations?.destructiveHint === true,
);

section('MCP acting on the project');
const listProjects = await tool(token, 'list_projects', {});
ok('list_projects finds the project', listProjects.data?.projects?.some((p) => p.id === projectId));

const search = await tool(token, 'search_code', { projectId, query: 'Confirm and pay' });
const hit = search.data?.matches?.[0];
ok('search_code locates a string in the template', Boolean(hit), search.text.slice(0, 160));

const patch = await tool(token, 'apply_patch', {
  projectId,
  path: 'src/player/screens/Review.tsx',
  edits: [{ find: 'Confirm and pay', replace: 'Pay and reserve' }],
});
ok('apply_patch succeeds', !patch.isError, patch.text.slice(0, 200));
ok('apply_patch returns a unified diff', String(patch.data?.diff ?? '').includes('+++ b/'));

const after = await call(
  `/api/projects/${projectId}/files/content?path=${encodeURIComponent('src/player/screens/Review.tsx')}`,
);
ok('patch landed in the working tree', String(after.json?.content ?? '').includes('Pay and reserve'));
ok('file attributed to Claude', after.json?.lastEditedBy === 'claude', after.json?.lastEditedBy);

const ambiguous = await tool(token, 'apply_patch', {
  projectId,
  path: 'src/player/screens/Review.tsx',
  edits: [{ find: 'const', replace: 'let' }],
});
ok('ambiguous patch is refused rather than guessed', ambiguous.isError, ambiguous.text.slice(0, 120));

const rebuild = await tool(token, 'start_preview', { projectId });
ok('start_preview compiles the patched project', !rebuild.isError, rebuild.text.slice(0, 300));

const typeErrors = await tool(token, 'get_type_errors', { projectId });
ok('get_type_errors is explicit about not type checking', typeErrors.data?.typeCheckingPerformed === false);

const snapshot = await tool(token, 'create_snapshot', {
  projectId,
  label: 'V3 · MCP edit',
  description: 'Renamed the confirm button through MCP.',
});
ok('create_snapshot works', !snapshot.isError && Boolean(snapshot.data?.versionId));

const versions = await tool(token, 'list_versions', { projectId });
ok('three versions listed', versions.data?.versions?.length === 3, `${versions.data?.versions?.length}`);

const compare = await tool(token, 'compare_versions', {
  projectId,
  base: versions.data.versions.at(-1).id,
  target: 'working',
});
ok('compare_versions reports changed files', (compare.data?.changes?.length ?? 0) > 0);

section('Destructive tools require confirmation');
const deleteWithout = await tool(token, 'delete_file', { projectId, path: 'src/ui/Avatars.tsx' });
ok('delete_file without confirm refuses', deleteWithout.isError, deleteWithout.text.slice(0, 120));

const stillThere = await call(
  `/api/projects/${projectId}/files/content?path=${encodeURIComponent('src/ui/Avatars.tsx')}`,
);
ok('the file was not deleted', stillThere.status === 200);

const deleteWith = await tool(token, 'delete_file', {
  projectId,
  path: 'src/ui/Avatars.tsx',
  confirm: true,
});
ok('delete_file with confirm deletes', !deleteWith.isError, deleteWith.text.slice(0, 120));
const gone = await call(
  `/api/projects/${projectId}/files/content?path=${encodeURIComponent('src/ui/Avatars.tsx')}`,
);
ok('the file is gone from the tree', gone.status === 404, `status ${gone.status}`);

section('Restore brings it back');
const restoreTarget = versions.data.versions.at(-1).id;
const restore = await tool(token, 'restore_version', {
  projectId,
  versionId: restoreTarget,
  confirm: true,
});
ok('restore_version works', !restore.isError, restore.text.slice(0, 200));
const restored = await call(
  `/api/projects/${projectId}/files/content?path=${encodeURIComponent('src/ui/Avatars.tsx')}`,
);
ok('the deleted file is restored', restored.status === 200);
ok('restore took a safety snapshot', Boolean(restore.data?.safetySnapshotId));

section('Devices and edge cases over MCP');
const devices = await tool(token, 'list_devices', { projectId });
const clubDevice = devices.data?.devices?.find((device) => device.role === 'provider');
ok('devices listed with roles', Boolean(clubDevice));

const flags = await tool(token, 'set_device_state', {
  projectId,
  deviceId: clubDevice.id,
  stateFlags: ['offline', 'empty-list'],
});
ok('set_device_state applies edge cases', !flags.isError && flags.data?.device?.network === 'offline');

const badFlag = await tool(token, 'set_device_state', {
  projectId,
  deviceId: clubDevice.id,
  stateFlags: ['not-a-real-flag'],
});
ok('unknown edge-case flag is rejected with guidance', badFlag.isError);

const capture = await tool(token, 'capture_device', { projectId, deviceId: clubDevice.id });
ok(
  'capture_device says plainly that it needs an open studio',
  capture.isError && capture.text.includes('studio'),
  capture.text.slice(0, 120),
);

section('Journeys');
const journeys = await tool(token, 'list_journeys', { projectId });
ok('template ships a recorded journey', (journeys.data?.journeys?.length ?? 0) >= 1);

section('Sharing and reviewer comments');
// Pin the link to the known-good V3 snapshot. (The newest snapshot at this point is
// the automatic one taken before the restore, which captured the tree *after* the
// delete and therefore does not compile — see the assertion further down.)
const share = await tool(token, 'create_share_link', {
  projectId,
  label: 'E2E review',
  access: 'comment',
  visibility: 'public',
  versionId: snapshot.data.versionId,
});
const shareToken = share.data?.token;
ok('create_share_link returns a URL', !share.isError && typeof shareToken === 'string');

const openShare = await fetch(`${base}/api/share/${shareToken}/open`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
const shareBody = await openShare.json();
ok('reviewer can open the link without an account', openShare.status === 200 && shareBody.state === 'ok');
ok('reviewer receives a compiled bundle', typeof shareBody.bundle?.code === 'string');
ok('reviewer receives no file tree', shareBody.files === undefined && shareBody.tree === undefined);
ok('reviewer sees the pinned version', shareBody.version?.label === 'V3 · MCP edit', shareBody.version?.label);

// A version that genuinely does not compile must say so rather than showing a blank
// phone. The safety snapshot taken before the restore is exactly that case.
const brokenShare = await tool(token, 'create_share_link', {
  projectId,
  label: 'Broken snapshot',
  access: 'read',
  visibility: 'public',
  versionId: restore.data.safetySnapshotId,
});
const brokenOpen = await fetch(`${base}/api/share/${brokenShare.data.token}/open`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
const brokenBody = await brokenOpen.json();
ok(
  'a version that does not compile is reported honestly, not shown blank',
  brokenBody.bundle?.code === null && typeof brokenBody.bundle?.error === 'string',
  JSON.stringify(brokenBody.bundle).slice(0, 160),
);

const comment = await fetch(`${base}/api/share/${shareToken}/comment`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    authorName: 'Associate',
    body: 'The confirm button is easy to miss on this screen.',
    anchorX: 0.5,
    anchorY: 0.82,
    screen: '/review',
    role: 'customer',
    sourceRef: 'src/player/screens/Review.tsx:120:6',
    elementLabel: 'Pay and reserve',
    precedingAction: 'tap Continue',
  }),
});
ok('reviewer comment accepted', comment.status === 201, `status ${comment.status}`);

const comments = await tool(token, 'list_comments', { projectId });
const thread = comments.data?.threads?.[0];
ok('Claude can read the comment through MCP', Boolean(thread));
ok('comment carries its source location', thread?.sourceRef === 'src/player/screens/Review.tsx:120:6');

const detail = await tool(token, 'get_comment', { projectId, threadId: thread.id });
ok('get_comment produces an actionable context block', detail.text.includes('Source:'));

const resolved = await tool(token, 'resolve_comment', { projectId, threadId: thread.id });
ok('resolve_comment works', !resolved.isError && resolved.data?.status === 'resolved');

section('Scope enforcement');
const readOnly = await call('/api/mcp-tokens', {
  method: 'POST',
  body: { name: 'read only', scopes: ['projects.read'] },
});
const readToken = readOnly.json?.token;
const denied = await tool(readToken, 'apply_patch', {
  projectId,
  path: 'src/App.tsx',
  edits: [{ find: 'export default', replace: 'export default' }],
});
ok('a read-only token cannot write', denied.isError, denied.text.slice(0, 160));
const allowed = await tool(readToken, 'list_files', { projectId });
ok('a read-only token can still read', !allowed.isError);

section('Audit trail');
const audit = await call('/api/mcp-tokens');
const connection = audit.json?.connections?.find((entry) => entry.name === 'E2E token');
ok('tool calls counted on the connection', (connection?.toolCallCount ?? 0) > 10, `${connection?.toolCallCount}`);
ok('protocol version recorded', connection?.protocolVersion === '2025-11-25');

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('\nAll end-to-end checks passed.');
