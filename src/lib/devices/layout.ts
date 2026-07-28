/**
 * Device layout engine.
 *
 * Pure functions over rectangles — no React, no DOM, no store — so the rules that
 * decide where phones land can be tested exhaustively instead of eyeballed.
 *
 * Two things every function here guarantees:
 *
 *  - **Deterministic.** The same input always produces the same output, and no
 *    layout reads the clock, the viewport or a random seed. Arranging twice in a
 *    row is a no-op, because none of the presets look at where devices *are*
 *    (only `free` does, by refusing to move them at all).
 *  - **Non-mutating.** Inputs are `readonly` and are never sorted, written to or
 *    handed back; every result is a fresh array of fresh objects, rounded to
 *    integers so positions survive a round-trip through the database unchanged.
 *
 * Coordinates are world-space canvas pixels, matching `DeviceRow.x/y` and the
 * chassis size from `deviceGeometry()`. Every arrangement is centred on `origin`
 * (the world origin by default), which is what makes it idempotent: the layout is
 * a function of the device *sizes and roles*, never of their current positions.
 */

import { boundingBox, type Point, type Rect } from '@/components/studio/canvas/geometry';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type LayoutPreset =
  | 'side-by-side'
  | 'user-journey'
  | 'grid'
  | 'compare'
  | 'roles'
  | 'free';

export interface LayoutPresetInfo {
  id: LayoutPreset;
  label: string;
  /** One line for a menu row — what the layout is *for*, not how it works. */
  hint: string;
}

export const LAYOUT_PRESETS: readonly LayoutPresetInfo[] = [
  {
    id: 'side-by-side',
    label: 'Side by side',
    hint: 'One row, vertically aligned.',
  },
  {
    id: 'user-journey',
    label: 'User journey',
    hint: 'One row, ordered along the journey each role plays.',
  },
  {
    id: 'grid',
    label: 'Grid',
    hint: 'Even rows and columns, kept close to the shape of the canvas.',
  },
  {
    id: 'compare',
    label: 'Compare',
    hint: 'Two columns, for two versions of the same screen.',
  },
  {
    id: 'roles',
    label: 'By role',
    hint: 'One column per role, devices of a role stacked.',
  },
  {
    id: 'free',
    label: 'Free',
    hint: 'Leave every device where it is.',
  },
] as const;

/**
 * A device to place. `width`/`height` are the chassis footprint (see
 * `deviceGeometry`), `x`/`y` are the *current* position — only `needsArrange`
 * and the `free` preset care about them, so they are optional.
 */
export interface DeviceRect
  extends Pick<Rect, 'width' | 'height'>,
    Partial<Pick<Rect, 'x' | 'y'>> {
  id: string;
  /** Project role slug. Unknown and missing roles are handled, never rejected. */
  role?: string;
}

export interface DevicePosition {
  id: string;
  x: number;
  y: number;
}

export interface ArrangeInput {
  devices: readonly DeviceRect[];
  /**
   * Omit for the count-aware default arrangement — what a project gets when it
   * opens for the first time, and what "Auto arrange" applies.
   */
  preset?: LayoutPreset;
  /** Centre of the resulting bounding box. Defaults to the world origin. */
  origin?: Point;
  /** Overrides both gaps. Omit to derive them from the device sizes. */
  gap?: number;
  /** width ÷ height of the canvas the result should feel at home in. */
  canvasAspect?: number;
  /**
   * Role slugs in the order the project declares them (`app.json`). When given,
   * these rank first, in that order; anything else falls back to the built-in
   * journey sequence below.
   */
  roleOrder?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Tuning                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Gaps are proportional to the devices, never absolute: a fixed 120px gutter
 * reads as a pair between two phones and as a rounding error between two
 * tablets. Scaling with the chassis keeps the same relationship at any size and
 * any zoom.
 */
const COLUMN_GAP_RATIO = 0.28;
const ROW_GAP_RATIO = 0.14;
/** Floor, so a proportional gap never collapses to nothing on a tiny device. */
const MIN_GAP = 40;

/** Studio canvas is a wide pane; 16:10 is the shape a layout should aim for. */
const DEFAULT_CANVAS_ASPECT = 16 / 10;

/**
 * Cost of a hole in the last row of a grid, in the same units as the aspect
 * score below. High enough that six devices choose 3×2 over a row of five plus
 * an orphan, low enough that four devices still take a single clean row.
 */
const EMPTY_CELL_PENALTY = 0.2;

/**
 * Three devices stay in one row while the row is no wider than this multiple of
 * the canvas aspect. Portrait phones (≈1.7:1 for three) sail under it; three
 * landscape phones (≈7.5:1) do not, and get the triangle instead.
 */
const ROW_OF_THREE_ASPECT_FACTOR = 1.6;

/** How far the primary device leads the pair behind it, as a share of the row gap. */
const PRIMARY_LEAD_RATIO = 0.25;

/** `needsArrange` only calls a spread degenerate past this multiple of the tidy size. */
const SPREAD_FACTOR = 5;

/** Overlap this small (share of the smaller device) is a deliberate stack, not a mess. */
const OVERLAP_AREA_TOLERANCE = 0.05;

const UNKNOWN_ROLE_RANK = Number.MAX_SAFE_INTEGER;

const ORIGIN: Point = { x: 0, y: 0 };

/* -------------------------------------------------------------------------- */
/* Role sequence                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A *general* ranking of roles along a journey, in four stages: whoever asks,
 * whoever fulfils, whoever administers, whoever watches. The keywords are
 * synonyms used to recognise a slug, not an allow-list — no project is required
 * to use any of them.
 *
 * Fallbacks, in order:
 *   1. `ArrangeInput.roleOrder` (the project's own declared roles) wins outright.
 *   2. Otherwise a slug is matched against these keywords: exact match first,
 *      then the *longest* keyword contained in the slug, so `super-admin` reads
 *      as admin and `admin-user` reads as admin rather than as a user.
 *   3. Anything still unrecognised is ranked last and keeps its original order,
 *      so a project with entirely custom role names gets its own ordering back
 *      rather than an alphabetical shuffle.
 *
 * Keywords are written normalised (lower case, no separators) because slugs are
 * normalised the same way before matching.
 */
export const ROLE_JOURNEY_SEQUENCE: readonly (readonly string[])[] = [
  // 1 — the request starts here.
  [
    'requester',
    'customer',
    'client',
    'buyer',
    'shopper',
    'consumer',
    'passenger',
    'patient',
    'student',
    'player',
    'member',
    'resident',
    'tenant',
    'attendee',
    'user',
  ],
  // 2 — whoever receives and fulfils it.
  [
    'fulfiller',
    'provider',
    'vendor',
    'merchant',
    'seller',
    'supplier',
    'host',
    'restaurant',
    'organizer',
    'organiser',
    'courier',
    'driver',
    'rider',
    'coach',
    'teacher',
    'doctor',
    'staff',
    'employee',
    'worker',
    'partner',
  ],
  // 3 — whoever runs the business behind it.
  ['administrator', 'admin', 'owner', 'manager', 'supervisor', 'backoffice', 'ops'],
  // 4 — whoever watches, helps or drops in.
  [
    'support',
    'helpdesk',
    'concierge',
    'moderator',
    'agent',
    'auditor',
    'reviewer',
    'observer',
    'viewer',
    'spectator',
    'visitor',
    'guest',
    'anonymous',
    'friend',
    'invitee',
  ],
] as const;

const EXACT_STAGE = new Map<string, number>();
ROLE_JOURNEY_SEQUENCE.forEach((words, stage) => {
  for (const word of words) if (!EXACT_STAGE.has(word)) EXACT_STAGE.set(word, stage);
});

/** Longest keyword first, so the most specific match wins; ties go to the earlier stage. */
const KEYWORDS_BY_SPECIFICITY = ROLE_JOURNEY_SEQUENCE.flatMap((words, stage) =>
  words.map((word) => ({ word, stage })),
).sort((a, b) => b.word.length - a.word.length || a.stage - b.stage);

function normaliseRole(role: string | undefined): string {
  return (role ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function journeyStage(normalised: string): number | null {
  if (!normalised) return null;
  const exact = EXACT_STAGE.get(normalised);
  if (exact !== undefined) return exact;
  for (const entry of KEYWORDS_BY_SPECIFICITY) {
    if (normalised.includes(entry.word)) return entry.stage;
  }
  return null;
}

type RankFn = (role: string | undefined) => number;

function rankResolver(roleOrder: readonly string[] | undefined): RankFn {
  const declared = new Map<string, number>();
  roleOrder?.forEach((slug, index) => {
    const key = normaliseRole(slug);
    if (key && !declared.has(key)) declared.set(key, index);
  });
  const offset = roleOrder?.length ?? 0;

  return (role) => {
    const key = normaliseRole(role);
    if (!key) return UNKNOWN_ROLE_RANK;
    const explicit = declared.get(key);
    if (explicit !== undefined) return explicit;
    const stage = journeyStage(key);
    return stage === null ? UNKNOWN_ROLE_RANK : offset + stage;
  };
}

/**
 * Journey order. `Array.prototype.sort` is stable, so unknown roles — all sharing
 * the same rank — come out in their original order, appended after the rest.
 */
function sortByJourney(devices: readonly DeviceRect[], rank: RankFn): DeviceRect[] {
  return devices
    .map((device, index) => ({ device, index, rank: rank(device.role) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.device);
}

/** Index of the device whose role leads the journey; ties and no-roles give the first. */
function primaryIndex(devices: readonly DeviceRect[], rank: RankFn): number {
  let best = 0;
  let bestRank = Number.POSITIVE_INFINITY;
  devices.forEach((device, index) => {
    const value = rank(device.role);
    if (value < bestRank) {
      bestRank = value;
      best = index;
    }
  });
  return best;
}

/* -------------------------------------------------------------------------- */
/* Placement primitives                                                        */
/* -------------------------------------------------------------------------- */

type Placed = Rect & { id: string };

interface Metrics {
  columnGap: number;
  rowGap: number;
  /** Grid cell = the largest device, so mixed sizes never collide. */
  cellWidth: number;
  cellHeight: number;
}

function metricsFor(devices: readonly DeviceRect[], gap: number | undefined): Metrics {
  let cellWidth = 0;
  let cellHeight = 0;
  for (const device of devices) {
    cellWidth = Math.max(cellWidth, device.width);
    cellHeight = Math.max(cellHeight, device.height);
  }
  const override = typeof gap === 'number' && Number.isFinite(gap) && gap >= 0 ? gap : null;
  return {
    columnGap: override ?? Math.max(MIN_GAP, Math.round(cellWidth * COLUMN_GAP_RATIO)),
    rowGap: override ?? Math.max(MIN_GAP, Math.round(cellHeight * ROW_GAP_RATIO)),
    cellWidth,
    cellHeight,
  };
}

/** One row, vertical centres aligned so mixed device heights still read as a row. */
function rowPlacement(devices: readonly DeviceRect[], metrics: Metrics): Placed[] {
  let cursor = 0;
  return devices.map((device) => {
    const placed: Placed = {
      id: device.id,
      x: cursor,
      y: -device.height / 2,
      width: device.width,
      height: device.height,
    };
    cursor += device.width + metrics.columnGap;
    return placed;
  });
}

/** Row-major grid on constant-size cells; each device centred in its cell. */
function gridPlacement(
  devices: readonly DeviceRect[],
  columns: number,
  metrics: Metrics,
): Placed[] {
  const perRow = Math.max(1, Math.min(columns, devices.length));
  const stepX = metrics.cellWidth + metrics.columnGap;
  const stepY = metrics.cellHeight + metrics.rowGap;

  return devices.map((device, index) => ({
    id: device.id,
    x: (index % perRow) * stepX + (metrics.cellWidth - device.width) / 2,
    y: Math.floor(index / perRow) * stepY + (metrics.cellHeight - device.height) / 2,
    width: device.width,
    height: device.height,
  }));
}

/**
 * Picks the column count whose bounding box is closest in shape to the canvas.
 *
 * Scored in log space so "twice as wide as it should be" and "twice as tall"
 * cost the same, plus a penalty per empty cell in the last row — without it,
 * six phones end up as a row of five and a straggler, which is technically the
 * best aspect and obviously the wrong picture. Ties keep the fewest columns,
 * which makes the choice deterministic.
 */
function chooseColumns(count: number, metrics: Metrics, canvasAspect: number): number {
  let best = 1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const width = columns * metrics.cellWidth + (columns - 1) * metrics.columnGap;
    const height = rows * metrics.cellHeight + (rows - 1) * metrics.rowGap;
    if (width <= 0 || height <= 0) continue;
    const shape = Math.abs(Math.log(width / height / canvasAspect));
    const score = shape + (columns * rows - count) * EMPTY_CELL_PENALTY;
    if (score < bestScore) {
      bestScore = score;
      best = columns;
    }
  }
  return best;
}

/**
 * Three devices as a wedge: two behind, the primary in front.
 *
 * "Slightly forward" is concrete here: the primary takes the lower, centred slot
 * and is lifted back toward the pair by `PRIMARY_LEAD_RATIO` (25%) of the row
 * gap. Lower on the canvas reads as nearer the viewer, and closing a quarter of
 * the gap turns "a row plus a stray phone" into one group with a lead. A quarter
 * is deliberate: three quarters of the gap remain, so the lead can never cause an
 * overlap whatever the device sizes.
 *
 * The flat row of three gets no such nudge — with all three on one line there is
 * no depth to borrow, and offsetting one would read as a broken alignment rather
 * than as hierarchy.
 */
function trianglePlacement(
  devices: readonly DeviceRect[],
  metrics: Metrics,
  primary: number,
): Placed[] {
  const front = devices[primary];
  const back = devices.filter((_, index) => index !== primary);
  const left = back[0];
  const right = back[1];
  if (!front || !left || !right) return rowPlacement(devices, metrics);

  const backHeight = Math.max(left.height, right.height);
  const backWidth = left.width + metrics.columnGap + right.width;
  const lead = Math.round(metrics.rowGap * PRIMARY_LEAD_RATIO);

  return [
    { id: left.id, x: 0, y: 0, width: left.width, height: left.height },
    {
      id: right.id,
      x: left.width + metrics.columnGap,
      y: 0,
      width: right.width,
      height: right.height,
    },
    {
      id: front.id,
      x: (backWidth - front.width) / 2,
      y: backHeight + metrics.rowGap - lead,
      width: front.width,
      height: front.height,
    },
  ];
}

/** One column per group, each column stacked from a shared top edge. */
function columnsPlacement(groups: readonly (readonly DeviceRect[])[], metrics: Metrics): Placed[] {
  const stepX = metrics.cellWidth + metrics.columnGap;
  const placed: Placed[] = [];

  groups.forEach((group, columnIndex) => {
    let cursorY = 0;
    for (const device of group) {
      placed.push({
        id: device.id,
        x: columnIndex * stepX + (metrics.cellWidth - device.width) / 2,
        y: cursorY,
        width: device.width,
        height: device.height,
      });
      cursorY += device.height + metrics.rowGap;
    }
  });
  return placed;
}

/** Groups by role, columns ordered by journey rank, devices keeping their order. */
function groupByRole(devices: readonly DeviceRect[], rank: RankFn): DeviceRect[][] {
  const groups = new Map<string, DeviceRect[]>();
  for (const device of devices) {
    const key = normaliseRole(device.role);
    const existing = groups.get(key);
    if (existing) existing.push(device);
    else groups.set(key, [device]);
  }
  // Map iteration is insertion-ordered and sort is stable, so roles that share a
  // rank (and every unknown role) stay in the order they first appeared.
  return [...groups.values()].sort((a, b) => rank(a[0]?.role) - rank(b[0]?.role));
}

/** Moves a finished layout so its bounding box is centred on `origin`, and rounds. */
function centreOn(placed: readonly Placed[], origin: Point): DevicePosition[] {
  if (placed.length === 0) return [];
  const bounds = boundingBox(placed);
  const dx = origin.x - (bounds.x + bounds.width / 2);
  const dy = origin.y - (bounds.y + bounds.height / 2);
  return placed.map((rect) => ({
    id: rect.id,
    x: Math.round(rect.x + dx),
    y: Math.round(rect.y + dy),
  }));
}

/* -------------------------------------------------------------------------- */
/* Default arrangement                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The count-aware default. What matters at each count is different, so the rules
 * are different:
 *
 *  - 1 — nothing to balance against, so it simply sits on the origin.
 *  - 2 — a pair, side by side, centres aligned.
 *  - 3 — a row while the row is not absurdly wide, otherwise a wedge.
 *  - 4+ — a grid shaped like the canvas.
 */
function defaultPlacement(
  devices: readonly DeviceRect[],
  metrics: Metrics,
  canvasAspect: number,
  rank: RankFn,
): Placed[] {
  if (devices.length <= 2) return rowPlacement(devices, metrics);

  if (devices.length === 3) {
    const rowWidth =
      devices.reduce((total, device) => total + device.width, 0) + metrics.columnGap * 2;
    const rowHeight = metrics.cellHeight;
    const tooWide = rowHeight > 0 && rowWidth / rowHeight > canvasAspect * ROW_OF_THREE_ASPECT_FACTOR;
    return tooWide
      ? trianglePlacement(devices, metrics, primaryIndex(devices, rank))
      : rowPlacement(devices, metrics);
  }

  return gridPlacement(devices, chooseColumns(devices.length, metrics, canvasAspect), metrics);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Arranges devices and returns their new positions, in layout order (left to
 * right, top to bottom). Callers apply them by id.
 *
 * An empty result means "move nothing" — that is how `free` is expressed, and it
 * is also what an empty canvas returns, so callers can treat both the same way.
 */
export function arrangeDevices(input: ArrangeInput): DevicePosition[] {
  const devices = input.devices;
  if (input.preset === 'free' || devices.length === 0) return [];

  const origin = input.origin ?? ORIGIN;
  const metrics = metricsFor(devices, input.gap);
  const canvasAspect =
    typeof input.canvasAspect === 'number' &&
    Number.isFinite(input.canvasAspect) &&
    input.canvasAspect > 0
      ? input.canvasAspect
      : DEFAULT_CANVAS_ASPECT;
  const rank = rankResolver(input.roleOrder);

  let placed: Placed[];
  switch (input.preset) {
    case 'side-by-side':
      placed = rowPlacement(devices, metrics);
      break;
    case 'user-journey':
      placed = rowPlacement(sortByJourney(devices, rank), metrics);
      break;
    case 'grid':
      placed = gridPlacement(
        devices,
        chooseColumns(devices.length, metrics, canvasAspect),
        metrics,
      );
      break;
    case 'compare':
      // Exactly two columns: one per version. Extras stack below, staying in
      // their column so a comparison reads down the page as well as across.
      placed = gridPlacement(devices, 2, metrics);
      break;
    case 'roles':
      placed = columnsPlacement(groupByRole(devices, rank), metrics);
      break;
    default:
      placed = defaultPlacement(devices, metrics, canvasAspect, rank);
  }

  return centreOn(placed, origin);
}

/* -------------------------------------------------------------------------- */
/* Degenerate-layout detection                                                 */
/* -------------------------------------------------------------------------- */

function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * True when the current positions are not a layout anyone chose: devices piled on
 * one point, devices sitting on top of each other, or a spread so wide the canvas
 * is mostly empty space. This is what decides whether a project that has never
 * been arranged gets arranged when it opens.
 *
 * Deliberately conservative — a person's layout must survive it. Touching edges,
 * a slight overlap, a generously spaced row and any layout of fewer than two
 * devices all count as intentional. Only a pile-up or a spread more than
 * `SPREAD_FACTOR`× wider (or taller) than the tidy version says otherwise.
 */
export function needsArrange(rects: readonly DeviceRect[]): boolean {
  if (rects.length < 2) return false;

  const current: Rect[] = rects.map((rect) => ({
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width,
    height: rect.height,
  }));

  // Positions that are not numbers cannot be a deliberate layout.
  if (current.some((rect) => !Number.isFinite(rect.x) || !Number.isFinite(rect.y))) return true;

  const first = current[0];
  if (first && current.every((rect) => rect.x === first.x && rect.y === first.y)) return true;

  for (let i = 0; i < current.length; i += 1) {
    for (let j = i + 1; j < current.length; j += 1) {
      const a = current[i];
      const b = current[j];
      if (!a || !b) continue;
      const smallest = Math.min(a.width * a.height, b.width * b.height);
      if (smallest <= 0) continue;
      if (overlapArea(a, b) > smallest * OVERLAP_AREA_TOLERANCE) return true;
    }
  }

  // Compare the spread against what the default arrangement would occupy, so the
  // threshold scales with the devices rather than with a magic pixel count.
  const tidy = arrangeDevices({ devices: rects });
  const sizes = new Map(rects.map((rect) => [rect.id, rect]));
  const tidyRectsForBounds: Rect[] = tidy.map((position) => {
    const size = sizes.get(position.id);
    return {
      x: position.x,
      y: position.y,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
    };
  });
  if (tidyRectsForBounds.length === 0) return false;

  const bounds = boundingBox(current);
  const natural = boundingBox(tidyRectsForBounds);
  if (natural.width <= 0 || natural.height <= 0) return false;

  return (
    bounds.width > natural.width * SPREAD_FACTOR || bounds.height > natural.height * SPREAD_FACTOR
  );
}
