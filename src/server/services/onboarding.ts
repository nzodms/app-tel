import { z } from 'zod';
import { badRequest, notFound } from '../core/errors';
import { newId, slugify } from '../core/ids';
import { getStore } from '../db';
import type { Id, ProjectRow, Store, UserRow } from '../db';
import { getTemplate } from '../templates';
import { normalizeUser, toPublicUser, type PublicUser } from './auth';
import { createGeneratedProject, createProject } from './projects';
import { PROJECT_CATEGORIES } from './scaffold';
import type { Actor } from './access';

/**
 * Onboarding.
 *
 * Five steps, and only the last one writes anything beyond the draft: welcome →
 * what you are building → who uses it → connect Claude → first project. Every
 * step is persisted as it is answered so a reload resumes where the person was,
 * and the whole thing can be skipped.
 *
 * `onboardingCompletedAt` is the single source of truth for "has this person been
 * shown around". It is never inferred from the existence of a project: the demo
 * can be opened, a workspace can be shared, and Claude can create a project over
 * MCP — none of those mean the person saw onboarding.
 */

export const TOTAL_STEPS = 5;

export const STEP_IDS = ['welcome', 'product', 'audience', 'connect', 'project'] as const;
export type StepId = (typeof STEP_IDS)[number];

/* -------------------------------------------------------------------------- */
/* Draft                                                                       */
/* -------------------------------------------------------------------------- */

const ROLE_SLUG = /^[a-z][a-z0-9-]{1,23}$/;

export const onboardingDraftSchema = z.object({
  /** Step 2 — what you are building. */
  appName: z.string().trim().max(60).default(''),
  category: z.string().trim().max(40).default(''),
  summary: z.string().trim().max(400).default(''),
  /** Step 3 — who uses it. */
  audience: z.string().trim().max(200).default(''),
  roles: z.array(z.string().trim().regex(ROLE_SLUG, 'Use lowercase letters, digits and dashes.')).max(6).default([]),
  /** Step 4 — Claude connection. Recorded so we can stop nagging, nothing more. */
  connectorAcknowledged: z.boolean().default(false),
  /** Step 5 — what to create. */
  startWith: z.enum(['generated', 'padelflow', 'starter', 'empty']).default('generated'),
  /** Set when the person chose to look around instead of answering. */
  skipped: z.boolean().default(false),
});

export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;

export function parseDraft(raw: unknown): OnboardingDraft {
  const result = onboardingDraftSchema.safeParse(raw ?? {});
  // A draft is a convenience, never a gate: if an older or hand-edited draft no
  // longer matches the schema, start from empty rather than locking the person out.
  return result.success ? result.data : onboardingDraftSchema.parse({});
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

export interface OnboardingState {
  completed: boolean;
  completedAt: string | null;
  /** Index into `STEP_IDS`, clamped to the steps that exist. */
  step: number;
  stepId: StepId;
  totalSteps: number;
  draft: OnboardingDraft;
  /** Present once onboarding created something, so the final screen can link to it. */
  projectId: Id | null;
}

export async function getOnboardingState(store: Store, userId: Id): Promise<OnboardingState> {
  const row = await store.find('users', { match: { id: userId } });
  if (!row) throw notFound('Account not found.');
  return stateFor(normalizeUser(row));
}

function stateFor(user: UserRow): OnboardingState {
  const step = clampStep(user.onboardingStep);
  return {
    completed: user.onboardingCompletedAt !== null,
    completedAt: user.onboardingCompletedAt,
    step,
    stepId: STEP_IDS[step] ?? 'welcome',
    totalSteps: TOTAL_STEPS,
    draft: parseDraft(user.onboardingDraft),
    projectId: user.activeProjectId,
  };
}

function clampStep(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), TOTAL_STEPS - 1);
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

export const saveProgressSchema = z.object({
  step: z.number().int().min(0).max(TOTAL_STEPS - 1),
  draft: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Records where the person is and what they have answered.
 *
 * The draft is merged, not replaced, so a step can send only its own fields.
 */
export async function saveOnboardingProgress(
  store: Store,
  userId: Id,
  input: z.infer<typeof saveProgressSchema>,
): Promise<OnboardingState> {
  const parsed = saveProgressSchema.parse(input);
  const row = await store.find('users', { match: { id: userId } });
  if (!row) throw notFound('Account not found.');
  const user = normalizeUser(row);

  const merged = parseDraft({ ...parseDraft(user.onboardingDraft), ...(parsed.draft ?? {}) });
  const updated = await store.update('users', userId, {
    onboardingStep: clampStep(parsed.step),
    onboardingDraft: merged as unknown as Record<string, unknown>,
    updatedAt: new Date().toISOString(),
  });
  return stateFor(normalizeUser(updated));
}

/* -------------------------------------------------------------------------- */
/* Completion                                                                  */
/* -------------------------------------------------------------------------- */

export interface CompleteResult {
  user: PublicUser;
  state: OnboardingState;
  project: ProjectRow | null;
  /** Where the client should go next. */
  redirectTo: string;
}

/**
 * Finishes onboarding, creating the first project for real.
 *
 * "For real" means the same code path the rest of the product uses:
 * `createProject` lays down files, devices, a version snapshot and a journey, so
 * the project the person lands in is a working project — not a placeholder that
 * gets filled in later.
 */
export async function completeOnboarding(
  store: Store,
  actor: Actor,
  input: { draft?: Record<string, unknown> } = {},
): Promise<CompleteResult> {
  const row = await store.find('users', { match: { id: actor.userId } });
  if (!row) throw notFound('Account not found.');
  const user = normalizeUser(row);

  const draft = parseDraft({ ...parseDraft(user.onboardingDraft), ...(input.draft ?? {}) });
  const workspaceId = await resolveWorkspaceId(store, user);

  const project = await createFirstProject(store, actor, workspaceId, draft);

  const now = new Date().toISOString();
  const updated = await store.update('users', user.id, {
    onboardingCompletedAt: now,
    onboardingStep: TOTAL_STEPS - 1,
    onboardingDraft: draft as unknown as Record<string, unknown>,
    activeWorkspaceId: workspaceId,
    activeProjectId: project?.id ?? user.activeProjectId ?? null,
    updatedAt: now,
  });

  const normalized = normalizeUser(updated);
  return {
    user: toPublicUser(normalized),
    state: stateFor(normalized),
    project,
    redirectTo: project ? `/studio/${project.id}` : '/dashboard',
  };
}

async function createFirstProject(
  store: Store,
  actor: Actor,
  workspaceId: Id,
  draft: OnboardingDraft,
): Promise<ProjectRow | null> {
  if (draft.startWith === 'empty') return null;

  if (draft.startWith === 'padelflow' || draft.startWith === 'starter') {
    const template = getTemplate(draft.startWith);
    if (!template) throw badRequest(`Unknown template "${draft.startWith}".`);
    const created = await createProject(
      store,
      actor,
      { workspaceId, name: template.name, templateId: template.id },
      { isDemo: draft.startWith === 'padelflow' },
    );
    return created.project;
  }

  const created = await createGeneratedProject(store, actor, {
    workspaceId,
    name: draft.appName.trim() || 'My app',
    brief: {
      category: draft.category,
      audience: draft.audience.trim(),
      summary: draft.summary.trim(),
      roles: draft.roles,
    },
  });
  return created.project;
}

async function resolveWorkspaceId(store: Store, user: UserRow): Promise<Id> {
  if (user.activeWorkspaceId) {
    const workspace = await store.find('workspaces', { match: { id: user.activeWorkspaceId } });
    if (workspace) return workspace.id;
  }
  const membership = await store.find('workspaceMembers', { match: { userId: user.id } });
  if (membership) return membership.workspaceId;

  // Every account gets a workspace at sign-up; this covers rows created before
  // that was true, and keeps onboarding from dead-ending on a missing workspace.
  const now = new Date().toISOString();
  const workspace = {
    id: newId('wsp'),
    name: `${user.name.split(' ')[0] ?? user.name}'s workspace`,
    slug: slugify(`${user.name}-workspace`, 'workspace'),
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
  };
  await store.transaction(async (tx) => {
    await tx.insert('workspaces', workspace);
    await tx.insert('workspaceMembers', {
      id: newId('wsm'),
      workspaceId: workspace.id,
      userId: user.id,
      role: 'owner',
      createdAt: now,
    });
  });
  return workspace.id;
}

/* -------------------------------------------------------------------------- */
/* Skip and reset                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Marks onboarding done without creating anything.
 *
 * Someone who wants to look around first should not be blocked, and should not be
 * asked again on every page load. The dashboard's empty state carries the same
 * choices, and "Revisit onboarding" is in the profile menu.
 */
export async function skipOnboarding(store: Store, userId: Id): Promise<OnboardingState> {
  const row = await store.find('users', { match: { id: userId } });
  if (!row) throw notFound('Account not found.');
  const user = normalizeUser(row);

  const now = new Date().toISOString();
  const updated = await store.update('users', userId, {
    onboardingCompletedAt: now,
    onboardingDraft: {
      ...parseDraft(user.onboardingDraft),
      skipped: true,
    } as unknown as Record<string, unknown>,
    updatedAt: now,
  });
  return stateFor(normalizeUser(updated));
}

/**
 * Reopens onboarding. Projects, files, versions and devices are untouched — this
 * only clears the "seen it" flag and the step pointer.
 */
export async function resetOnboarding(store: Store, userId: Id): Promise<OnboardingState> {
  const updated = await store.update('users', userId, {
    onboardingCompletedAt: null,
    onboardingStep: 0,
    updatedAt: new Date().toISOString(),
  });
  return stateFor(normalizeUser(updated));
}

/* -------------------------------------------------------------------------- */
/* Routing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where a signed-in person should land.
 *
 * One function, used by `/`, `/app` and the onboarding page itself, so the three
 * cannot disagree and bounce someone between them.
 *
 * Note that a finished onboarding lands on the dashboard, never straight into the
 * last project. Opening the product should show you your work, not drop you into
 * whichever file you happened to close last.
 */
export function landingPathFor(user: PublicUser): string {
  if (!user.onboardingCompletedAt) return '/onboarding';
  return '/dashboard';
}

export { PROJECT_CATEGORIES };

/** Convenience for server components that only need the state. */
export async function readOnboardingState(userId: Id): Promise<OnboardingState> {
  return getOnboardingState(getStore(), userId);
}
