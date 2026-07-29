'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, MessageSquarePlus, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { api, errorText } from '@/lib/api-client';
import { deviceGeometry, getPreset } from '@/lib/devices/presets';
import { isPreviewMessage, type PreviewMessage } from '@/lib/preview/protocol';
import { Badge, Button, Card, Field, Input, Textarea } from '@/components/ui/primitives';
import { Wordmark } from '@/components/brand/logo';
import { DeviceChassis } from '@/components/studio/canvas/device-chassis';
import { IDLE_ISLAND, type IslandContent } from '@/components/studio/canvas/dynamic-island';
import { DEFAULT_STATUS } from '@/components/studio/canvas/status-bar';
import type { PreviewNotification } from '@/lib/preview/protocol';

/**
 * The reviewer surface.
 *
 * What an associate or beta tester gets from a share link: the app running on a real
 * phone, the roles the owner allowed, and — if enabled — the previous version beside
 * it. They can tap anywhere and leave a comment; the pin records the screen, the
 * role and, when the click landed on a component, its exact source location.
 *
 * There is no code, no file tree, and no project API access here.
 */

interface OpenPayload {
  state: 'ok' | 'password-required' | 'email-required';
  share?: { access: 'read' | 'comment'; allowVersionCompare: boolean; label: string };
  project?: { id: string; name: string; description: string };
  version?: { id: string | null; label: string; description: string };
  roles?: { slug: string; label: string; defaultUser: string | null }[];
  presetId?: string;
  bundle?: { code: string | null; hash: string | null; error?: string };
  comparison?: { versionId: string; label: string; code: string; hash: string } | null;
  threads?: {
    id: string;
    anchorX: number;
    anchorY: number;
    screen: string | null;
    role: string | null;
    author: string;
    body: string;
    createdAt: string;
  }[];
  link?: { label: string; access: string };
}

interface Pin {
  x: number;
  y: number;
  sourceRef: string | null;
  elementLabel: string | null;
}

export function Reviewer({ token }: { token: string }) {
  const [payload, setPayload] = useState<OpenPayload | null>(null);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * The gate is re-attempted by bumping this, with the credentials to try. The
   * fetch itself lives in an effect and only writes state from its callbacks, so
   * nothing is set synchronously while rendering.
   */
  const [attempt, setAttempt] = useState<{ n: number; password?: string; email?: string }>({ n: 0 });

  useEffect(() => {
    let cancelled = false;
    api<OpenPayload>(`/api/share/${token}/open`, {
      body: {
        ...(attempt.password ? { password: attempt.password } : {}),
        ...(attempt.email ? { email: attempt.email } : {}),
      },
    })
      .then((result) => {
        if (cancelled) return;
        setPayload(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorText(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const retry = useCallback((credentials: { password?: string; email?: string }) => {
    setLoading(true);
    setAttempt((current) => ({ n: current.n + 1, ...credentials }));
  }, []);

  if (loading && !payload) {
    return (
      <Gate>
        <p className="text-[13px] text-paper-500">Opening the shared version…</p>
      </Gate>
    );
  }

  if (error && !payload) {
    return (
      <Gate>
        <h1 className="text-[15px] font-semibold text-paper-900">This link cannot be opened</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-paper-600">{error}</p>
      </Gate>
    );
  }

  if (payload?.state === 'password-required') {
    return (
      <Gate>
        <span className="grid size-8 place-items-center rounded-lg bg-paper-100 text-paper-600">
          <Lock size={15} strokeWidth={1.8} />
        </span>
        <h1 className="mt-2.5 text-[15px] font-semibold text-paper-900">This review is protected</h1>
        <p className="mt-1 text-[13px] text-paper-600">
          Enter the password the owner shared with you.
        </p>
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            retry({ password });
          }}
        >
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoFocus
          />
          {error ? <p className="text-[12.5px] text-danger-700">{error}</p> : null}
          <Button type="submit" variant="primary" size="md" className="w-full">
            Open review
          </Button>
        </form>
      </Gate>
    );
  }

  if (payload?.state === 'email-required') {
    return (
      <Gate>
        <h1 className="text-[15px] font-semibold text-paper-900">Invite-only review</h1>
        <p className="mt-1 text-[13px] text-paper-600">
          Enter the email address the owner invited.
        </p>
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            retry({ email });
          }}
        >
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoFocus
          />
          {error ? <p className="text-[12.5px] text-danger-700">{error}</p> : null}
          <Button type="submit" variant="primary" size="md" className="w-full">
            Open review
          </Button>
        </form>
      </Gate>
    );
  }

  if (!payload || payload.state !== 'ok') {
    return (
      <Gate>
        <p className="text-[13px] text-paper-600">This link is not available.</p>
      </Gate>
    );
  }

  return (
    <ReviewerStage
      token={token}
      payload={payload}
      credentials={{ ...(password ? { password } : {}), ...(email ? { email } : {}) }}
    />
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper-50 px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-4 flex justify-center">
          <Wordmark />
        </div>
        <Card className="p-5">{children}</Card>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function ReviewerStage({
  token,
  payload,
  credentials,
}: {
  token: string;
  payload: OpenPayload;
  credentials: { password?: string; email?: string };
}) {
  const roles = payload.roles ?? [];
  const [role, setRole] = useState(roles[0]?.slug ?? 'customer');
  const [commentMode, setCommentMode] = useState(false);
  const [pin, setPin] = useState<Pin | null>(null);
  const [threads, setThreads] = useState(payload.threads ?? []);
  const [route, setRoute] = useState('/');
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);

  const preset = getPreset(payload.presetId ?? 'iphone-17-pro');
  const canComment = payload.share?.access === 'comment';

  return (
    <div className="min-h-dvh bg-paper-100">
      <header className="border-b border-paper-200 bg-paper-0">
        <div className="mx-auto flex min-h-13 max-w-[1180px] flex-wrap items-center gap-2.5 px-5 py-2">
          <Wordmark />
          <span className="h-4 w-px bg-paper-200" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-paper-900">
              {payload.project?.name}
            </div>
            <div className="truncate text-[11.5px] text-paper-500">
              {payload.version?.label}
              {payload.share?.label ? ` · ${payload.share.label}` : ''}
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {roles.length > 1 ? (
              <div className="flex items-center gap-1 rounded-lg border border-paper-200 bg-paper-50 p-0.5">
                {roles.map((entry) => (
                  <button
                    key={entry.slug}
                    onClick={() => setRole(entry.slug)}
                    className={cn(
                      'rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
                      role === entry.slug
                        ? 'bg-paper-0 text-paper-900 shadow-hairline'
                        : 'text-paper-500 hover:text-paper-700',
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            ) : null}

            {payload.comparison ? (
              <Button
                size="sm"
                onClick={() => setShowCompare((current) => !current)}
                className={cn(showCompare && 'border-azure-200 bg-azure-50 text-azure-700')}
              >
                Compare with {payload.comparison.label}
              </Button>
            ) : null}

            {canComment ? (
              <Button
                size="sm"
                variant={commentMode ? 'primary' : 'secondary'}
                onClick={() => {
                  setCommentMode((current) => !current);
                  setPin(null);
                }}
              >
                <MessageSquarePlus size={13} strokeWidth={1.9} />
                {commentMode ? 'Click a spot on the screen' : 'Leave a comment'}
              </Button>
            ) : (
              <Badge tone="neutral">Read-only link</Badge>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1180px] flex-wrap items-start justify-center gap-10 px-5 py-9">
        <ReviewPhone
          label={payload.version?.label ?? 'Shared version'}
          code={payload.bundle?.code ?? null}
          error={payload.bundle?.error ?? null}
          role={role}
          roleLabel={roles.find((entry) => entry.slug === role)?.label ?? role}
          userLabel={roles.find((entry) => entry.slug === role)?.defaultUser ?? null}
          preset={preset}
          commentMode={commentMode}
          threads={threads}
          pin={pin}
          onPin={(next) => {
            setPin(next);
            setCommentMode(false);
          }}
          onRoute={setRoute}
          onAction={setLastAction}
        />

        {showCompare && payload.comparison ? (
          <ReviewPhone
            label={payload.comparison.label}
            code={payload.comparison.code}
            error={null}
            role={role}
            roleLabel={roles.find((entry) => entry.slug === role)?.label ?? role}
            userLabel={roles.find((entry) => entry.slug === role)?.defaultUser ?? null}
            preset={preset}
            commentMode={false}
            threads={[]}
            pin={null}
            onPin={() => {}}
            onRoute={() => {}}
            onAction={() => {}}
          />
        ) : null}

        <aside className="w-full max-w-[320px] shrink-0">
          {pin ? (
            <CommentComposer
              token={token}
              credentials={credentials}
              pin={pin}
              route={route}
              role={role}
              lastAction={lastAction}
              onCancel={() => setPin(null)}
              onCreated={(thread) => {
                setThreads((current) => [...current, thread]);
                setPin(null);
              }}
            />
          ) : (
            <Card className="p-4">
              <h2 className="text-[13px] font-semibold text-paper-900">
                {canComment ? 'How to give feedback' : 'About this link'}
              </h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-600">
                {canComment
                  ? 'Use the app exactly as you would on your phone. When something is off, click “Leave a comment”, then click the exact spot — your note is attached to that screen and element.'
                  : 'You can use the app, but the owner has not enabled comments on this link.'}
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-paper-500">
                You are looking at <span className="font-medium text-paper-700">{payload.version?.label}</span>
                {payload.version?.description ? ` — ${payload.version.description}` : ''}.
              </p>
              <div className="mt-3 flex items-center gap-1.5">
                <Badge tone="neutral">{route}</Badge>
                <Badge tone="neutral">{roles.find((entry) => entry.slug === role)?.label ?? role}</Badge>
              </div>
            </Card>
          )}

          {threads.length > 0 ? (
            <Card className="mt-3 p-3.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-paper-500">
                Comments on this version
              </h3>
              <div className="mt-2 space-y-2.5">
                {threads.map((thread) => (
                  <div key={thread.id} className="text-[12.5px] leading-relaxed">
                    <span className="font-semibold text-paper-800">{thread.author}</span>{' '}
                    <span className="text-paper-600">{thread.body}</span>
                    <div className="mt-0.5 text-[10.5px] text-paper-400">
                      {thread.screen ?? '/'} · {new Date(thread.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </aside>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ReviewPhone({
  label,
  code,
  error,
  role,
  roleLabel,
  userLabel,
  preset,
  commentMode,
  threads,
  pin,
  onPin,
  onRoute,
  onAction,
}: {
  label: string;
  code: string | null;
  error: string | null;
  role: string;
  roleLabel: string;
  userLabel: string | null;
  preset: ReturnType<typeof getPreset>;
  commentMode: boolean;
  threads: { id: string; anchorX: number; anchorY: number }[];
  pin: Pin | null;
  onPin: (pin: Pin) => void;
  onRoute: (route: string) => void;
  onAction: (action: string) => void;
}) {
  const geometry = deviceGeometry(preset, 'portrait');
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const nonce = useMemo(() => crypto.randomUUID().replace(/-/g, ''), []);
  const [notifications, setNotifications] = useState<PreviewNotification[]>([]);
  const [island, setIsland] = useState<IslandContent>(IDLE_ISLAND);
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const post = useCallback(
    (message: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ ...message, nonce }, '*');
    },
    [nonce],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!isPreviewMessage(data) || data.nonce !== nonce) return;
      handle(data);
    };

    const handle = (message: PreviewMessage) => {
      switch (message.type) {
        case 'preview:ready':
          setReady(true);
          post({
            type: 'host:init',
            context: {
              deviceId: 'review',
              deviceName: 'Review device',
              role,
              userLabel,
              theme: 'light',
              locale: 'en',
              network: 'fast',
              flags: [],
              versionLabel: label,
              viewport: geometry.screen,
              safeArea: geometry.safeArea,
            },
            shared: {},
          });
          if (code) post({ type: 'host:load', code, hash: 'review' });
          break;
        case 'preview:navigate':
          onRoute(message.route);
          break;
        case 'preview:interaction':
          onAction(`${message.action} ${message.label ?? message.target ?? ''}`.trim());
          break;
        case 'preview:notify': {
          const notification = message.notification;
          setNotifications((current) => [...current, notification].slice(-2));
          setIsland({
            state: notification.island,
            label: notification.islandLabel ?? notification.title,
            detail: notification.body,
            progress: notification.island === 'activity' ? 0.4 : null,
            tone:
              notification.kind === 'success'
                ? 'success'
                : notification.kind === 'error'
                  ? 'error'
                  : notification.kind === 'warning'
                    ? 'warning'
                    : 'default',
          });
          window.setTimeout(
            () => setNotifications((current) => current.filter((entry) => entry.id !== notification.id)),
            notification.duration,
          );
          window.setTimeout(() => setIsland(IDLE_ISLAND), notification.duration + 800);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [code, geometry.safeArea, geometry.screen, label, nonce, onAction, onRoute, post, role, userLabel]);

  // Role changes are context updates, not reloads: the app re-renders as the new role.
  useEffect(() => {
    if (!ready) return;
    post({
      type: 'host:context',
      context: {
        deviceId: 'review',
        deviceName: 'Review device',
        role,
        userLabel,
        theme: 'light',
        locale: 'en',
        network: 'fast',
        flags: [],
        versionLabel: label,
        viewport: geometry.screen,
        safeArea: geometry.safeArea,
      },
    });
  }, [geometry.safeArea, geometry.screen, label, post, ready, role, userLabel]);

  const onScreenClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!commentMode) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPin({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      sourceRef: null,
      elementLabel: null,
    });
  };

  return (
    <div className="shrink-0">
      <div className="mb-2 flex items-center gap-2 pl-1" style={{ width: geometry.chassis.width }}>
        <span className="text-[12.5px] font-semibold text-paper-800">{label}</span>
        <Badge tone="neutral">{roleLabel}</Badge>
        <button
          onClick={() => {
            setReloadKey((current) => current + 1);
            setReady(false);
          }}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-paper-500 hover:bg-paper-200"
          title="Restart the app"
        >
          <RotateCcw size={11.5} strokeWidth={1.9} />
          Restart
        </button>
      </div>

      <div className="relative">
        {/* Always upright: `orientation` is not part of a share payload, and
            `deviceGeometry` ignores it on the families that do not turn. */}
        <DeviceChassis
          preset={preset}
          orientation="portrait"
          theme="light"
          selected={false}
          chrome={{
            status: { ...DEFAULT_STATUS },
            island,
            notifications,
            sheet: null,
            keyboardOpen: false,
          }}
          onDismissNotification={(id) =>
            setNotifications((current) => current.filter((entry) => entry.id !== id))
          }
          onResolveSheet={() => {}}
        >
          <iframe
            key={reloadKey}
            ref={iframeRef}
            src={`/preview/host?n=${nonce}`}
            title={`${label} preview`}
            sandbox="allow-scripts"
            style={{ width: geometry.screen.width, height: geometry.screen.height, border: 0, display: 'block' }}
          />

          {error ? (
            <div className="absolute inset-0 z-[55] grid place-items-center bg-paper-0 p-5 text-center">
              <p className="text-[12.5px] leading-relaxed text-danger-700">
                This version does not currently build, so it cannot be previewed. {error}
              </p>
            </div>
          ) : null}

          {/* Comment layer sits above the app only while placing a pin. */}
          {commentMode ? (
            <div
              className="absolute inset-0 z-[58] cursor-crosshair"
              style={{ background: 'rgba(37,112,232,0.06)' }}
              onClick={onScreenClick}
            />
          ) : null}

          {threads.map((thread) => (
            <span
              key={thread.id}
              className="pointer-events-none absolute z-[57] grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-azure-500 text-[10px] font-semibold text-white shadow-float"
              style={{ left: `${thread.anchorX * 100}%`, top: `${thread.anchorY * 100}%` }}
            >
              ●
            </span>
          ))}

          {pin ? (
            <span
              className="pointer-events-none absolute z-[59] size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper-0 bg-caution-500 shadow-float"
              style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
            />
          ) : null}
        </DeviceChassis>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CommentComposer({
  token,
  credentials,
  pin,
  route,
  role,
  lastAction,
  onCancel,
  onCreated,
}: {
  token: string;
  credentials: { password?: string; email?: string };
  pin: Pin;
  route: string;
  role: string;
  lastAction: string | null;
  onCancel: () => void;
  onCreated: (thread: {
    id: string;
    anchorX: number;
    anchorY: number;
    screen: string | null;
    role: string | null;
    author: string;
    body: string;
    createdAt: string;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{
        thread: {
          id: string;
          anchorX: number;
          anchorY: number;
          screen: string | null;
          role: string | null;
          author: string;
          body: string;
          createdAt: string;
        };
      }>(`/api/share/${token}/comment`, {
        body: {
          ...credentials,
          authorName: name.trim() || 'Reviewer',
          body: body.trim(),
          anchorX: pin.x,
          anchorY: pin.y,
          screen: route,
          role,
          sourceRef: pin.sourceRef,
          elementLabel: pin.elementLabel,
          precedingAction: lastAction,
        },
      });
      onCreated(result.thread);
      setBody('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between">
        <h2 className="text-[13px] font-semibold text-paper-900">Add your comment</h2>
        <button onClick={onCancel} aria-label="Cancel" className="text-paper-400 hover:text-paper-600">
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-paper-500">
        Anchored at {Math.round(pin.x * 100)}% × {Math.round(pin.y * 100)}% on{' '}
        <span className="font-medium text-paper-700">{route}</span>
        {lastAction ? ` · after “${lastAction}”` : ''}.
      </p>

      <div className="mt-2.5 space-y-2">
        <Field label="Your name">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex" />
        </Field>
        <Field label="What did you notice?">
          <Textarea
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="The confirm button is easy to miss on this screen."
          />
        </Field>
      </div>

      {error ? <p className="mt-2 text-[12px] text-danger-700">{error}</p> : null}

      <Button
        variant="primary"
        size="md"
        className="mt-3 w-full"
        disabled={busy || body.trim() === ''}
        onClick={() => void submit()}
      >
        {busy ? 'Sending…' : 'Send comment'}
      </Button>
    </Card>
  );
}
