// Post-deployment smoke test. Runs against a DEPLOYED url, not localhost.
//
//   node scripts/smoke-production.mjs https://your-deployment.vercel.app
//
// It exercises the one journey that has to work before anything else matters:
//
//   health → signup → session → onboarding → workspace → project
//         → dashboard → sign out → sign back in → data still there
//
// It refuses to run against localhost unless --allow-local is passed, because the
// entire reason this file exists is that a green localhost run was mistaken for a
// working deployment.
//
// Exits non-zero on the first hard failure. Nothing it prints contains a secret.

const args = process.argv.slice(2);
const allowLocal = args.includes('--allow-local');
const base = (args.find((entry) => !entry.startsWith('--')) ?? '').replace(/\/$/, '');

if (!base) {
  console.error('Usage: node scripts/smoke-production.mjs <deployment-url> [--allow-local]');
  process.exit(2);
}
if (/localhost|127\.0\.0\.1/.test(base) && !allowLocal) {
  console.error(
    `Refusing to treat ${base} as a deployment.\n` +
      'This test exists to check a real deployment. Pass --allow-local to override.',
  );
  process.exit(2);
}

let cookie = '';
let passed = 0;
const failures = [];

const ok = (label, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
  return Boolean(condition);
};

const section = (name) => console.log(`\n${name}`);

async function call(path, { method = 'GET', body, headers = {}, keepCookie = true } = {}) {
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
  if (setCookie && keepCookie) {
    const match = /pl_session=([^;]*)/.exec(setCookie);
    if (match) cookie = match[1] ? `pl_session=${match[1]}` : '';
  }

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, json, text, setCookie };
}

console.log(`PhoneLab production smoke test\nTarget: ${base}\n`);

/* ------------------------------------------------------------------ health */

section('Deployment health');
const health = await call('/api/health');
const h = health.json ?? {};
ok('/api/health responds', health.status === 200 || health.status === 503, `HTTP ${health.status}`);
console.log(
  `    status=${h.status} driver=${h.storageDriver} db=${h.databaseConnected} migrations=${h.migrationsCurrent} env=${h.environment}`,
);
if (Array.isArray(h.problems)) for (const problem of h.problems) console.log(`    ! ${problem}`);

if (h.status !== 'ok' && h.status !== 'degraded') {
  console.log(
    `\nThe deployment reports itself unhealthy, so the journey below cannot pass.` +
      (Array.isArray(h.missingEnvVars) && h.missingEnvVars.length > 0
        ? `\nMissing environment variables: ${h.missingEnvVars.join(', ')}`
        : ''),
  );
  console.log(`\n${passed} passed, ${failures.length + 1} failed`);
  process.exit(1);
}

ok('a real database is behind it', h.databaseConnected === true, `databaseConnected=${h.databaseConnected}`);
ok(
  'it is NOT the file-backed driver',
  h.storageDriver !== 'local',
  `storageDriver=${h.storageDriver} — accounts would not survive`,
);
ok('the migrations are current', h.migrationsCurrent === true);
ok('it does not leak configuration values', !JSON.stringify(h).includes('supabase.co'));

/* ------------------------------------------------------------------ signup */

section('Sign up');
const stamp = Date.now().toString(36);
const email = `smoke-${stamp}@phonelab.test`;
const password = `smoke-pass-${stamp}`;

const signup = await call('/api/auth/signup', {
  method: 'POST',
  body: { name: 'Smoke Tester', email, password },
});
if (
  !ok(
    'the account is created',
    signup.status === 201,
    `HTTP ${signup.status} ${JSON.stringify(signup.json?.error ?? {}).slice(0, 220)}`,
  )
) {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}

ok('a session cookie comes back', cookie.startsWith('pl_session='));
ok('the cookie is HttpOnly', /HttpOnly/i.test(signup.setCookie ?? ''), signup.setCookie ?? 'none');
ok(
  'the cookie is Secure over HTTPS',
  !base.startsWith('https://') || /Secure/i.test(signup.setCookie ?? ''),
  signup.setCookie ?? 'none',
);
ok('the cookie is SameSite=Lax', /SameSite=Lax/i.test(signup.setCookie ?? ''));
ok('the cookie is scoped to the whole site', /Path=\/(;|$)/i.test(signup.setCookie ?? ''));
ok(
  'the cookie is not pinned to a host',
  !/Domain=localhost/i.test(signup.setCookie ?? ''),
  signup.setCookie ?? '',
);

const userId = signup.json?.user?.id;
const workspaceId = signup.json?.workspace?.id;
ok('a workspace is created with it', typeof workspaceId === 'string', String(workspaceId));
ok('the account is not marked as onboarded', signup.json?.user?.onboardingCompletedAt === null);

/* -------------------------------------------------------------- redirects */

section('Session and routing');
const root = await call('/');
ok(
  '/ routes the new account to onboarding',
  root.headers.get('location') === '/onboarding',
  String(root.headers.get('location')),
);
const onboarding = await call('/onboarding');
ok('/onboarding renders for them', onboarding.status === 200, `HTTP ${onboarding.status}`);

const me = await call('/api/me');
ok('the session survives a second request', me.status === 200 && me.json?.user?.id === userId);

/* ------------------------------------------------------------- onboarding */

section('Onboarding creates real data');
const complete = await call('/api/onboarding', {
  method: 'POST',
  body: {
    action: 'complete',
    draft: {
      appName: `Smoke ${stamp}`,
      category: 'booking',
      summary: 'Created by the production smoke test.',
      roles: ['member', 'club'],
      startWith: 'generated',
    },
  },
});
const projectId = complete.json?.projectId;
ok(
  'completing onboarding creates a project',
  complete.status === 200 && typeof projectId === 'string',
  `HTTP ${complete.status} ${JSON.stringify(complete.json?.error ?? {}).slice(0, 200)}`,
);

if (projectId) {
  const files = await call(`/api/projects/${projectId}/files`);
  const paths = (files.json?.files ?? []).map((file) => file.path);
  ok('the project has real files', paths.length >= 8, `${paths.length} files`);
  ok('including the config generated from the brief', paths.includes('src/lib/config.ts'));

  const devices = await call(`/api/projects/${projectId}/devices`);
  ok('and a phone per role', (devices.json?.devices ?? []).length === 2);

  const build = await call(`/api/projects/${projectId}/preview/build`, {
    method: 'POST',
    body: { ref: 'working' },
  });
  ok(
    'and it compiles on the server',
    build.json?.ok === true,
    JSON.stringify(build.json?.diagnostics ?? []).slice(0, 200),
  );
}

const dashboard = await call('/dashboard');
ok('the dashboard renders', dashboard.status === 200, `HTTP ${dashboard.status}`);
ok('and shows the new project', dashboard.text.includes(`Smoke ${stamp}`));

/* ------------------------------------------------- sign out and back in */

section('Persistence across sessions');
await call('/api/auth/logout', { method: 'POST' });
cookie = '';

const anonymous = await call('/dashboard');
ok(
  'signing out really ends the session',
  anonymous.status === 307 && (anonymous.headers.get('location') ?? '').includes('/login'),
  `HTTP ${anonymous.status}`,
);

const signin = await call('/api/auth/login', { method: 'POST', body: { email, password } });
ok('signing back in works', signin.status === 200, `HTTP ${signin.status}`);
ok('it is the same account', signin.json?.user?.id === userId);

const projects = await call('/api/projects');
const names = (projects.json?.projects ?? []).map((project) => project.name);
ok(
  'the project is still there after signing back in',
  names.includes(`Smoke ${stamp}`),
  JSON.stringify(names).slice(0, 200),
);
ok(
  'THE DATA IS IN A DATABASE, NOT A LAMBDA',
  names.includes(`Smoke ${stamp}`) && h.storageDriver !== 'local',
  'a project written by one invocation was read back by another',
);

/* ------------------------------------------------------------ error paths */

section('Error reporting');
const duplicate = await call('/api/auth/signup', {
  method: 'POST',
  body: { name: 'Smoke Tester', email, password },
  keepCookie: false,
});
ok('a duplicate email is a 409, not a 500', duplicate.status === 409, `HTTP ${duplicate.status}`);
ok('with a code a client can branch on', duplicate.json?.error?.code === 'conflict');

const shortPassword = await call('/api/auth/signup', {
  method: 'POST',
  body: { name: 'X', email: `short-${stamp}@phonelab.test`, password: 'short' },
  keepCookie: false,
});
ok('a short password is a 422', shortPassword.status === 422, `HTTP ${shortPassword.status}`);
ok(
  'with a message that says what to do',
  /10 characters/.test(shortPassword.json?.error?.message ?? ''),
  shortPassword.json?.error?.message,
);

/* ------------------------------------------------------------------ done */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nProduction smoke test passed against ${base}`);
console.log(`Account left behind for manual checks: ${email}`);
