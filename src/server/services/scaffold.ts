import type { ProjectBrief } from '../db/schema';

/**
 * Turning an onboarding brief into a real project.
 *
 * The generated project is not a mock: the blueprint template under
 * `templates/blueprint/` is a complete, compiling, role-aware app, and everything
 * category-specific lives in one generated file — `src/lib/config.ts` — plus
 * `app.json`. So the same well-tested code runs for every category, and the user
 * gets vocabulary and demo data that match what they described.
 *
 * The mapping below is a lookup table, not a language model. It is deterministic,
 * inspectable, and honest about being a starting point the user then edits.
 */

export interface CatalogSeed {
  id: string;
  title: string;
  subtitle: string;
  tags: string[];
  priceCents: number;
  rating: number;
  available: boolean;
}

export interface CategoryVocabulary {
  id: string;
  label: string;
  /** One line shown on the onboarding card. */
  hint: string;
  itemNoun: string;
  itemPlural: string;
  unitNoun: string;
  browseTitle: string;
  actionVerb: string;
  confirmLabel: string;
  acceptLabel: string;
  requestNoun: string;
  requestPlural: string;
  inboxTitle: string;
  waitingLabel: string;
  completionLabel: string;
  unavailableLabel: string;
  quantityLabel: string;
  notePlaceholder: string;
  emptyStateBody: string;
  serviceName: string;
  declineReason: string;
  longTitleSuffix: string;
  eventPrefix: string;
  /** Suggested role slugs, most important first. */
  suggestedRoles: string[];
  items: CatalogSeed[];
}

const CATEGORIES: CategoryVocabulary[] = [
  {
    id: 'booking',
    label: 'Booking',
    hint: 'Slots, appointments, reservations',
    itemNoun: 'Slot',
    itemPlural: 'Availability',
    unitNoun: 'place',
    browseTitle: 'Book a slot',
    actionVerb: 'Book',
    confirmLabel: 'Confirm booking',
    acceptLabel: 'Accept booking',
    requestNoun: 'Booking',
    requestPlural: 'Bookings',
    inboxTitle: 'Requests',
    waitingLabel: 'Awaiting confirmation',
    completionLabel: 'Reserved',
    unavailableLabel: 'Fully booked',
    quantityLabel: 'People',
    notePlaceholder: 'Anything the host should know',
    emptyStateBody: 'Nothing is bookable right now. Try another day or another place.',
    serviceName: 'booking service',
    declineReason: 'That slot was taken by someone else.',
    longTitleSuffix: 'Centre Sportif Municipal Jean-Baptiste de la Vallée Verte (north entrance)',
    eventPrefix: 'booking',
    suggestedRoles: ['customer', 'provider', 'admin'],
    items: [
      { id: 'i1', title: 'Studio A · 18:00', subtitle: 'Indoor · 90 minutes', tags: ['Indoor', '90 min'], priceCents: 3200, rating: 4.8, available: true },
      { id: 'i2', title: 'Studio B · 19:30', subtitle: 'Indoor · 60 minutes', tags: ['Indoor', '60 min'], priceCents: 2400, rating: 4.6, available: true },
      { id: 'i3', title: 'Terrace · 20:00', subtitle: 'Outdoor · 90 minutes', tags: ['Outdoor', '90 min'], priceCents: 2000, rating: 4.3, available: false },
    ],
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    hint: 'Buyers and sellers, listings and offers',
    itemNoun: 'Listing',
    itemPlural: 'Listings',
    unitNoun: 'item',
    browseTitle: 'Browse listings',
    actionVerb: 'Request',
    confirmLabel: 'Send request',
    acceptLabel: 'Accept request',
    requestNoun: 'Request',
    requestPlural: 'Requests',
    inboxTitle: 'Requests',
    waitingLabel: 'Awaiting the seller',
    completionLabel: 'Reserved for you',
    unavailableLabel: 'Sold',
    quantityLabel: 'Quantity',
    notePlaceholder: 'A message for the seller',
    emptyStateBody: 'No listings match yet. New ones appear here as sellers publish them.',
    serviceName: 'marketplace service',
    declineReason: 'The seller withdrew this listing.',
    longTitleSuffix: 'limited edition, original packaging, collected from the north depot only',
    eventPrefix: 'listing',
    suggestedRoles: ['customer', 'provider', 'admin'],
    items: [
      { id: 'i1', title: 'Vintage desk lamp', subtitle: 'Brass · very good condition', tags: ['Home', 'Used'], priceCents: 4500, rating: 4.7, available: true },
      { id: 'i2', title: 'Road bike · 54cm', subtitle: 'Aluminium frame · serviced', tags: ['Sport', 'Used'], priceCents: 32000, rating: 4.9, available: true },
      { id: 'i3', title: 'Espresso machine', subtitle: 'Two-group · commercial', tags: ['Kitchen'], priceCents: 89000, rating: 4.4, available: false },
    ],
  },
  {
    id: 'delivery',
    label: 'Delivery',
    hint: 'Orders, kitchens and couriers',
    itemNoun: 'Dish',
    itemPlural: 'Menu',
    unitNoun: 'portion',
    browseTitle: 'Order food',
    actionVerb: 'Order',
    confirmLabel: 'Place order',
    acceptLabel: 'Accept order',
    requestNoun: 'Order',
    requestPlural: 'Orders',
    inboxTitle: 'Kitchen',
    waitingLabel: 'Awaiting the kitchen',
    completionLabel: 'Out for delivery',
    unavailableLabel: 'Sold out',
    quantityLabel: 'Portions',
    notePlaceholder: 'Allergies or delivery instructions',
    emptyStateBody: 'Nothing is available for delivery right now.',
    serviceName: 'ordering service',
    declineReason: 'The kitchen is at capacity right now.',
    longTitleSuffix: 'slow-cooked with seasonal vegetables from the northern cooperative farm',
    eventPrefix: 'order',
    suggestedRoles: ['customer', 'provider', 'courier'],
    items: [
      { id: 'i1', title: 'Roast chicken bowl', subtitle: 'Rice, herbs, pickles', tags: ['Popular'], priceCents: 1350, rating: 4.8, available: true },
      { id: 'i2', title: 'Aubergine curry', subtitle: 'Vegan · medium spice', tags: ['Vegan'], priceCents: 1200, rating: 4.6, available: true },
      { id: 'i3', title: 'Grilled sea bass', subtitle: 'Lemon, fennel', tags: ['Fish'], priceCents: 1850, rating: 4.5, available: false },
    ],
  },
  {
    id: 'ecommerce',
    label: 'E-commerce',
    hint: 'Products, carts and fulfilment',
    itemNoun: 'Product',
    itemPlural: 'Products',
    unitNoun: 'unit',
    browseTitle: 'Shop',
    actionVerb: 'Buy',
    confirmLabel: 'Place order',
    acceptLabel: 'Confirm order',
    requestNoun: 'Order',
    requestPlural: 'Orders',
    inboxTitle: 'Orders',
    waitingLabel: 'Awaiting confirmation',
    completionLabel: 'Shipped',
    unavailableLabel: 'Out of stock',
    quantityLabel: 'Quantity',
    notePlaceholder: 'Delivery instructions',
    emptyStateBody: 'The catalogue is empty. Products you publish appear here.',
    serviceName: 'store service',
    declineReason: 'That product went out of stock.',
    longTitleSuffix: 'organic cotton, made in Portugal, ships in recyclable packaging only',
    eventPrefix: 'order',
    suggestedRoles: ['customer', 'provider', 'support'],
    items: [
      { id: 'i1', title: 'Everyday tote', subtitle: 'Canvas · natural', tags: ['Bags'], priceCents: 4900, rating: 4.7, available: true },
      { id: 'i2', title: 'Merino beanie', subtitle: 'One size · charcoal', tags: ['Knitwear'], priceCents: 3200, rating: 4.5, available: true },
      { id: 'i3', title: 'Leather card holder', subtitle: 'Vegetable tanned', tags: ['Accessories'], priceCents: 5900, rating: 4.8, available: false },
    ],
  },
  {
    id: 'social',
    label: 'Social network',
    hint: 'Posts, feeds and moderation',
    itemNoun: 'Post',
    itemPlural: 'Feed',
    unitNoun: 'post',
    browseTitle: 'Your feed',
    actionVerb: 'Share',
    confirmLabel: 'Publish',
    acceptLabel: 'Approve',
    requestNoun: 'Post',
    requestPlural: 'Posts',
    inboxTitle: 'Moderation',
    waitingLabel: 'Awaiting review',
    completionLabel: 'Published',
    unavailableLabel: 'Unavailable',
    quantityLabel: 'Audience',
    notePlaceholder: 'Say something',
    emptyStateBody: 'Nothing in the feed yet. Posts appear here as people publish.',
    serviceName: 'feed service',
    declineReason: 'A moderator rejected this post.',
    longTitleSuffix: 'a considerably longer headline than anyone would sensibly write in practice',
    eventPrefix: 'post',
    suggestedRoles: ['customer', 'admin', 'support'],
    items: [
      { id: 'i1', title: 'Morning run, 8km', subtitle: 'Léa · 2 min ago', tags: ['Running'], priceCents: 0, rating: 4.9, available: true },
      { id: 'i2', title: 'New studio setup', subtitle: 'Tom · 14 min ago', tags: ['Photo'], priceCents: 0, rating: 4.6, available: true },
      { id: 'i3', title: 'Recipe: winter soup', subtitle: 'Inès · 1 h ago', tags: ['Food'], priceCents: 0, rating: 4.4, available: true },
    ],
  },
  {
    id: 'health',
    label: 'Health & fitness',
    hint: 'Sessions, coaches and progress',
    itemNoun: 'Session',
    itemPlural: 'Sessions',
    unitNoun: 'place',
    browseTitle: 'Find a session',
    actionVerb: 'Join',
    confirmLabel: 'Confirm place',
    acceptLabel: 'Accept',
    requestNoun: 'Session',
    requestPlural: 'Sessions',
    inboxTitle: 'Requests',
    waitingLabel: 'Awaiting the coach',
    completionLabel: 'Confirmed',
    unavailableLabel: 'Full',
    quantityLabel: 'Places',
    notePlaceholder: 'Injuries or goals the coach should know',
    emptyStateBody: 'No sessions scheduled. New ones appear as coaches publish them.',
    serviceName: 'scheduling service',
    declineReason: 'The coach is fully booked.',
    longTitleSuffix: 'progressive strength and mobility for returning athletes, level two',
    eventPrefix: 'session',
    suggestedRoles: ['customer', 'provider', 'admin'],
    items: [
      { id: 'i1', title: 'Strength · 07:00', subtitle: 'Coach Nadia · 45 min', tags: ['Strength'], priceCents: 1800, rating: 4.9, available: true },
      { id: 'i2', title: 'Mobility · 12:30', subtitle: 'Coach Marc · 30 min', tags: ['Mobility'], priceCents: 1200, rating: 4.7, available: true },
      { id: 'i3', title: 'Intervals · 18:00', subtitle: 'Coach Sam · 60 min', tags: ['Cardio'], priceCents: 2000, rating: 4.6, available: false },
    ],
  },
  {
    id: 'community',
    label: 'Community',
    hint: 'Events, members and organisers',
    itemNoun: 'Event',
    itemPlural: 'Events',
    unitNoun: 'ticket',
    browseTitle: "What's on",
    actionVerb: 'Join',
    confirmLabel: 'Reserve a place',
    acceptLabel: 'Approve',
    requestNoun: 'Registration',
    requestPlural: 'Registrations',
    inboxTitle: 'Registrations',
    waitingLabel: 'Awaiting the organiser',
    completionLabel: "You're on the list",
    unavailableLabel: 'Full',
    quantityLabel: 'Tickets',
    notePlaceholder: 'Anything the organiser should know',
    emptyStateBody: 'No events yet. Organisers publish them here.',
    serviceName: 'events service',
    declineReason: 'The event reached capacity.',
    longTitleSuffix: 'an unusually descriptive event title that keeps going well past the fold',
    eventPrefix: 'registration',
    suggestedRoles: ['customer', 'provider', 'admin'],
    items: [
      { id: 'i1', title: 'Repair café', subtitle: 'Saturday · 14:00', tags: ['Free'], priceCents: 0, rating: 4.8, available: true },
      { id: 'i2', title: 'Neighbourhood dinner', subtitle: 'Friday · 19:30', tags: ['Food'], priceCents: 1500, rating: 4.7, available: true },
      { id: 'i3', title: 'Bike workshop', subtitle: 'Sunday · 10:00', tags: ['Workshop'], priceCents: 800, rating: 4.5, available: false },
    ],
  },
  {
    id: 'saas',
    label: 'Mobile SaaS',
    hint: 'Work items, approvals and teams',
    itemNoun: 'Item',
    itemPlural: 'Work items',
    unitNoun: 'item',
    browseTitle: 'Your work',
    actionVerb: 'Submit',
    confirmLabel: 'Submit for approval',
    acceptLabel: 'Approve',
    requestNoun: 'Submission',
    requestPlural: 'Submissions',
    inboxTitle: 'Approvals',
    waitingLabel: 'Awaiting approval',
    completionLabel: 'Approved',
    unavailableLabel: 'Closed',
    quantityLabel: 'Priority',
    notePlaceholder: 'Context for the approver',
    emptyStateBody: 'Nothing assigned. New work appears here.',
    serviceName: 'workflow service',
    declineReason: 'The approver sent this back for changes.',
    longTitleSuffix: 'quarterly compliance review for the northern region distribution partners',
    eventPrefix: 'submission',
    suggestedRoles: ['customer', 'admin', 'support'],
    items: [
      { id: 'i1', title: 'Expense · Client dinner', subtitle: 'Submitted today', tags: ['Expenses'], priceCents: 8400, rating: 4.5, available: true },
      { id: 'i2', title: 'Time off · 3 days', subtitle: 'Next month', tags: ['Leave'], priceCents: 0, rating: 4.5, available: true },
      { id: 'i3', title: 'Purchase · Monitors', subtitle: 'Two units', tags: ['Procurement'], priceCents: 62000, rating: 4.5, available: false },
    ],
  },
  {
    id: 'other',
    label: 'Something else',
    hint: 'A generic two-sided starting point',
    itemNoun: 'Item',
    itemPlural: 'Items',
    unitNoun: 'unit',
    browseTitle: 'Browse',
    actionVerb: 'Request',
    confirmLabel: 'Send request',
    acceptLabel: 'Accept',
    requestNoun: 'Request',
    requestPlural: 'Requests',
    inboxTitle: 'Requests',
    waitingLabel: 'Awaiting a response',
    completionLabel: 'Confirmed',
    unavailableLabel: 'Unavailable',
    quantityLabel: 'Quantity',
    notePlaceholder: 'Anything else to add',
    emptyStateBody: 'Nothing here yet.',
    serviceName: 'service',
    declineReason: 'This request was declined.',
    longTitleSuffix: 'with a deliberately long name to check how the layout copes with overflow',
    eventPrefix: 'request',
    suggestedRoles: ['customer', 'provider', 'admin'],
    items: [
      { id: 'i1', title: 'First item', subtitle: 'A short description', tags: ['Example'], priceCents: 1500, rating: 4.5, available: true },
      { id: 'i2', title: 'Second item', subtitle: 'Another description', tags: ['Example'], priceCents: 2500, rating: 4.6, available: true },
      { id: 'i3', title: 'Third item', subtitle: 'Currently unavailable', tags: ['Example'], priceCents: 3500, rating: 4.2, available: false },
    ],
  },
];

const BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

export const PROJECT_CATEGORIES = CATEGORIES.map((category) => ({
  id: category.id,
  label: category.label,
  hint: category.hint,
  suggestedRoles: category.suggestedRoles,
}));

export function getCategory(id: string): CategoryVocabulary {
  return BY_ID.get(id) ?? (BY_ID.get('other') as CategoryVocabulary);
}

/* -------------------------------------------------------------------------- */

export interface ScaffoldInput {
  appName: string;
  brief: ProjectBrief;
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

/**
 * Files that differ per project. Everything else comes from the blueprint template
 * unchanged, which is why the generated app is as well-tested as a hand-written one.
 */
export function generateScaffoldFiles(input: ScaffoldInput): ScaffoldFile[] {
  const category = getCategory(input.brief.category);
  const roles = input.brief.roles.length > 0 ? input.brief.roles : category.suggestedRoles;

  // The first role asks, the second answers; the rest observe.
  const requesterRole = roles[0] ?? 'customer';
  const fulfillerRole = roles.find((role) => role !== requesterRole) ?? 'provider';
  const adminRoles = roles.filter((role) => role !== requesterRole && role !== fulfillerRole);

  const config = {
    appName: input.appName,
    tagline: input.brief.summary || category.hint,
    audience: input.brief.audience,
    category: category.id,
    requesterRole,
    fulfillerRole,
    adminRoles: adminRoles.length > 0 ? adminRoles : ['admin'],
    fulfillerLabel: titleCase(fulfillerRole),
    sharedStateKey: `${slug(input.appName)}:records`,
    events: {
      requested: `${category.eventPrefix}.requested`,
      accepted: `${category.eventPrefix}.accepted`,
      declined: `${category.eventPrefix}.declined`,
    },
    itemNoun: category.itemNoun,
    itemPlural: category.itemPlural,
    unitNoun: category.unitNoun,
    browseTitle: category.browseTitle,
    actionVerb: category.actionVerb,
    confirmLabel: category.confirmLabel,
    acceptLabel: category.acceptLabel,
    requestNoun: category.requestNoun,
    requestPlural: category.requestPlural,
    inboxTitle: category.inboxTitle,
    waitingLabel: category.waitingLabel,
    completionLabel: category.completionLabel,
    unavailableLabel: category.unavailableLabel,
    quantityLabel: category.quantityLabel,
    notePlaceholder: category.notePlaceholder,
    emptyStateBody: category.emptyStateBody,
    serviceName: category.serviceName,
    declineReason: category.declineReason,
    longTitleSuffix: category.longTitleSuffix,
    items: category.items,
  };

  const configFile = `import type { CatalogItem } from './types';

/**
 * ${input.appName} — generated from your onboarding brief.
 *
 * ${input.brief.summary || category.hint}
 * Built for: ${input.brief.audience || 'your users'}
 *
 * This is the only generated file in the project. Everything that makes the app
 * *yours* — what things are called, which roles talk to which, the demo data —
 * lives here, so the screens stay generic and you can change any of it without
 * touching them. Rename it, restructure it, or delete it and hard-code your own:
 * it is your code now.
 */

export interface AppConfig {
  appName: string;
  tagline: string;
  audience: string;
  category: string;
  requesterRole: string;
  fulfillerRole: string;
  adminRoles: string[];
  fulfillerLabel: string;
  sharedStateKey: string;
  events: { requested: string; accepted: string; declined: string };
  itemNoun: string;
  itemPlural: string;
  unitNoun: string;
  browseTitle: string;
  actionVerb: string;
  confirmLabel: string;
  acceptLabel: string;
  requestNoun: string;
  requestPlural: string;
  inboxTitle: string;
  waitingLabel: string;
  completionLabel: string;
  unavailableLabel: string;
  quantityLabel: string;
  notePlaceholder: string;
  emptyStateBody: string;
  serviceName: string;
  declineReason: string;
  longTitleSuffix: string;
  items: CatalogItem[];
}

export const config: AppConfig = ${JSON.stringify(config, null, 2)};
`;

  const manifest = {
    name: input.appName,
    description: input.brief.summary || category.hint,
    entry: 'src/App.tsx',
    roles: roles.map((role) => ({
      slug: role,
      label: titleCase(role),
      user: defaultUserFor(role),
    })),
    screens: [
      { route: '/', title: category.browseTitle, role: requesterRole },
      { route: '/detail', title: category.itemNoun, role: requesterRole },
      { route: '/review', title: 'Review', role: requesterRole },
      { route: '/status', title: category.requestNoun, role: requesterRole },
      { route: '/', title: category.inboxTitle, role: fulfillerRole },
    ],
    sharedStateKeys: [config.sharedStateKey],
    events: [
      { name: config.events.requested, from: requesterRole, to: fulfillerRole },
      { name: config.events.accepted, from: fulfillerRole, to: requesterRole },
      { name: config.events.declined, from: fulfillerRole, to: requesterRole },
    ],
  };

  return [
    { path: 'src/lib/config.ts', content: configFile },
    { path: 'app.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
  ];
}

/** The journey PhoneLab records for a generated project, so replay works day one. */
export function generateScaffoldJourney(input: ScaffoldInput): {
  name: string;
  description: string;
  steps: {
    kind: 'navigate' | 'tap' | 'assert';
    label: string;
    deviceRole: string | null;
    payload: Record<string, unknown>;
    waitMs: number;
  }[];
} {
  const category = getCategory(input.brief.category);
  const roles = input.brief.roles.length > 0 ? input.brief.roles : category.suggestedRoles;
  const requesterRole = roles[0] ?? 'customer';
  const fulfillerRole = roles.find((role) => role !== requesterRole) ?? 'provider';

  return {
    name: `${category.actionVerb} and confirm`,
    description: `The ${requesterRole} ${category.actionVerb.toLowerCase()}s the first ${category.itemNoun.toLowerCase()}, and the ${fulfillerRole} accepts it.`,
    steps: [
      { kind: 'navigate', label: 'Open the list', deviceRole: requesterRole, payload: { route: '/' }, waitMs: 300 },
      { kind: 'tap', label: `Open the first ${category.itemNoun.toLowerCase()}`, deviceRole: requesterRole, payload: { target: 'item-i1' }, waitMs: 700 },
      { kind: 'tap', label: 'Continue', deviceRole: requesterRole, payload: { target: 'continue' }, waitMs: 600 },
      { kind: 'tap', label: category.confirmLabel, deviceRole: requesterRole, payload: { target: 'confirm' }, waitMs: 900 },
      { kind: 'tap', label: 'Open the incoming request', deviceRole: fulfillerRole, payload: { label: defaultUserFor(requesterRole) ?? 'Guest' }, waitMs: 1400 },
      { kind: 'tap', label: category.acceptLabel, deviceRole: fulfillerRole, payload: { target: 'accept' }, waitMs: 800 },
      { kind: 'assert', label: 'Confirmed', deviceRole: requesterRole, payload: {}, waitMs: 900 },
    ],
  };
}

const DEFAULT_USERS: Record<string, string> = {
  customer: 'Léa Martin',
  provider: 'Nord Studio',
  admin: 'Ops team',
  support: 'Nadia B.',
  courier: 'Sam Okoro',
  friend: 'Tom Rivière',
};

export function defaultUserFor(role: string): string | null {
  if (role === 'guest') return null;
  return DEFAULT_USERS[role] ?? titleCase(role);
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'app'
  );
}
