/**
 * Device roles.
 *
 * A role is what makes four phones on the canvas interesting rather than four
 * copies of the same screen: it selects which part of the app renders, which
 * simulated user is signed in, and which cross-device events the phone reacts to.
 *
 * Projects declare the roles they support in `app.json`; this catalogue provides
 * sensible defaults plus the colour used to tag devices in the UI.
 */

export interface RoleDefinition {
  slug: string;
  label: string;
  description: string;
  /** CSS custom property from globals.css. */
  colorVar: string;
  /** Default simulated user shown on a fresh device with this role. */
  defaultUser: string | null;
}

export const ROLE_CATALOG: readonly RoleDefinition[] = [
  {
    slug: 'customer',
    label: 'Customer',
    description: 'The end user booking, buying or ordering.',
    colorVar: '--color-role-customer',
    defaultUser: 'Léa Martin',
  },
  {
    slug: 'provider',
    label: 'Provider',
    description: 'The business receiving and fulfilling the request.',
    colorVar: '--color-role-provider',
    defaultUser: 'Padel Central',
  },
  {
    slug: 'courier',
    label: 'Courier',
    description: 'Delivery or on-the-road operator.',
    colorVar: '--color-role-courier',
    defaultUser: 'Sam Okoro',
  },
  {
    slug: 'admin',
    label: 'Admin',
    description: 'Back-office operator with full visibility.',
    colorVar: '--color-role-admin',
    defaultUser: 'Ops team',
  },
  {
    slug: 'support',
    label: 'Support',
    description: 'Agent handling incidents and refunds.',
    colorVar: '--color-role-support',
    defaultUser: 'Nadia B.',
  },
  {
    slug: 'friend',
    label: 'Friend',
    description: 'Invited participant with limited access.',
    colorVar: '--color-role-customer',
    defaultUser: 'Tom Rivière',
  },
  {
    slug: 'guest',
    label: 'Visitor',
    description: 'Not signed in. Sees only public screens.',
    colorVar: '--color-role-guest',
    defaultUser: null,
  },
] as const;

const BY_SLUG = new Map(ROLE_CATALOG.map((role) => [role.slug, role]));

export function getRole(slug: string): RoleDefinition {
  return (
    BY_SLUG.get(slug) ?? {
      slug,
      label: slug.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      description: 'Custom role defined by this project.',
      colorVar: '--color-role-guest',
      defaultUser: null,
    }
  );
}

export function roleColor(slug: string): string {
  return `var(${getRole(slug).colorVar})`;
}
