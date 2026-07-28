'use client';

import { useState } from 'react';
import type { McpScope } from '@/server/services/access';
import { Button } from '@/components/ui/primitives';

/**
 * Scope approval.
 *
 * A plain form POST to `/api/oauth/authorize`: the server mints the code and issues
 * the redirect, so the authorization code never passes through client JavaScript.
 * Scopes can be narrowed before approving — least privilege should be one click, not
 * a support request.
 */
export function ConsentForm({
  scopes,
  descriptions,
  params,
  clientName,
  redirectUri,
}: {
  scopes: McpScope[];
  descriptions: Record<string, { label: string; description: string }>;
  params: Record<string, string>;
  clientName: string;
  redirectUri: string;
}) {
  const [approved, setApproved] = useState<McpScope[]>(scopes);

  let host = redirectUri;
  try {
    host = new URL(redirectUri).host || redirectUri;
  } catch {
    // Custom scheme (e.g. a desktop client): show it verbatim.
  }

  return (
    <form method="POST" action="/api/oauth/authorize" className="p-5">
      {Object.entries(params).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {approved.map((scope) => (
        <input key={scope} type="hidden" name="scope" value={scope} />
      ))}

      <div className="space-y-2">
        {scopes.map((scope) => {
          const active = approved.includes(scope);
          const info = descriptions[scope];
          return (
            <label
              key={scope}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-paper-200 p-2.5 transition-colors hover:bg-paper-50"
            >
              <input
                type="checkbox"
                checked={active}
                onChange={(event) =>
                  setApproved((current) =>
                    event.target.checked
                      ? [...current, scope]
                      : current.filter((entry) => entry !== scope),
                  )
                }
                className="mt-[3px] size-3.5"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-paper-800">
                  {info?.label ?? scope}
                </span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-paper-500">
                  {info?.description}
                </span>
                <code className="mt-1 block font-mono text-[10.5px] text-paper-400">{scope}</code>
              </span>
            </label>
          );
        })}
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-paper-500">
        After approving, you will be returned to <span className="font-medium text-paper-700">{host}</span>.
        {approved.length === 0
          ? ' Select at least one permission to continue.'
          : ''}
      </p>

      <div className="mt-4 flex gap-2">
        <Button
          type="submit"
          name="decision"
          value="approve"
          variant="primary"
          size="md"
          className="flex-1"
          disabled={approved.length === 0}
        >
          Allow {clientName}
        </Button>
        <Button type="submit" name="decision" value="deny" size="md">
          Deny
        </Button>
      </div>
    </form>
  );
}
