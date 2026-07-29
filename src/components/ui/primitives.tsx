import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * PhoneLab UI primitives.
 *
 * Hand-rolled rather than pulled from a component library: the studio needs dense,
 * quiet chrome that never competes with the phones, and that is easier to get right
 * with a small set of exact components than by overriding someone else's defaults.
 *
 * Conventions: hairline borders, 10px panel radius, one accent, hover states that
 * change surface rather than colour, and transitions capped at 160ms.
 *
 * Interaction contract, applied uniformly below so the same gesture means the same
 * thing everywhere:
 *   hover  — the surface lightens or darkens one step. "This is live."
 *   active — the surface moves one *further* step and the control drops 1px.
 *            "The press landed." Distinct from hover, never a bounce.
 *   focus  — a 2px azure outline, offset so it never sits on the control's own
 *            fill. Keyboard only (:focus-visible), never traded away.
 */

/* ---------------------------------------------------------------- Button --- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'xs' | 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap ' +
  'select-none ' +
  // Tailwind v4's preflight no longer sets `cursor: pointer` on <button>, so every
  // button in the studio was showing the text/arrow cursor. Buttons must read as
  // clickable before they are clicked.
  'cursor-pointer ' +
  // box-shadow left out of the transition list: shadows are now static per variant
  // (hover and active move the *surface*, not the elevation), so interpolating a
  // blur on every hover was pure cost.
  'transition-[background-color,border-color,color,translate] duration-[140ms] ' +
  '[transition-timing-function:var(--ease-out-quint)] ' +
  // Press feedback. The old `active:scale-[0.985]` was 0.45px of travel on a 30px
  // button — invisible — and scaling a label resamples its glyphs. A 1px whole-pixel
  // drop is legible, physical and stays crisp. `active:duration-*` makes the press
  // land immediately and the release ease back, so it feels damped rather than laggy.
  'active:translate-y-px active:duration-[70ms] ' +
  // The global :focus-visible rule uses outline-offset:1px, which on a filled azure
  // primary put an azure-400 ring one pixel from an azure-500 fill — effectively
  // invisible. 2px of offset lets the page background separate ring from button.
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-azure-400 ' +
  'disabled:opacity-45 disabled:pointer-events-none';

/**
 * The variant ladder. The recurring complaint was that these all landed at the same
 * visual weight, so a screen full of buttons had no obvious primary action. They are
 * now separated by *kind* of emphasis, not just by hue:
 *
 *   primary    filled accent + defined edge + elevation   (one per surface)
 *   danger     filled semantic, edge sharpens on hover    (destructive, off-ladder)
 *   secondary  filled neutral, hairline edge              (the default)
 *   outline    unfilled, the darkest edge in the set      (edge *is* the affordance)
 *   ghost      no fill, no edge until hover               (dense toolbars)
 *
 * Every variant gets its own :active step so the press reads as a third state and
 * not as "hover again".
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // Loudest. At size xs/sm a fill alone was not enough separation from `secondary`;
  // the azure-600 edge and a slightly deeper shadow give it a silhouette so it is
  // findable at a glance in a toolbar.
  primary:
    'bg-azure-500 text-white border border-azure-600 shadow-[0_1px_2px_rgb(16_20_26/0.16)] ' +
    'hover:bg-azure-600 hover:border-azure-700 active:bg-azure-700',
  // Destructive. Previously identical in weight to `secondary`, so "Delete" looked
  // like "Cancel". The edge sharpening to danger-500 on hover is the warning — it
  // costs no extra chrome at rest and is unmistakable once you are on the target.
  // Three distinct surfaces, and the edge sharpens on hover — the warning costs
  // no chrome at rest. (`danger-100` was referenced here before it existed in the
  // ramp, which meant Tailwind emitted nothing and the button had no hover state
  // at all; the token is defined now, so this is the real step.)
  danger:
    'bg-danger-50 text-danger-700 border border-danger-200 ' +
    'hover:bg-danger-100 hover:border-danger-500 active:bg-danger-200',
  // The default. Filled: that is what distinguishes it from `outline`, which was
  // previously near-indistinguishable (both read as "light surface, hairline edge").
  secondary:
    'bg-paper-100 text-paper-900 border border-paper-200 shadow-[0_1px_1px_rgb(16_20_26/0.03)] ' +
    'hover:bg-paper-150 hover:border-paper-300 active:bg-paper-200',
  // Unfilled. Its identity is the edge, so hover darkens the *edge* first and only
  // tints the surface — that is what makes it legibly a different control to
  // `secondary` rather than a slightly paler copy of it.
  outline:
    'bg-paper-0 text-paper-800 border border-paper-300 ' +
    'hover:bg-paper-50 hover:border-paper-400 active:bg-paper-100',
  // Quietest. Hover previously changed only the surface, so a ghost button in a
  // dense bar could read as a static label until you noticed the tint; darkening the
  // label as well makes "interactive" unambiguous.
  ghost:
    'text-paper-700 hover:bg-paper-100 hover:text-paper-900 ' +
    'active:bg-paper-150 active:text-paper-900',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  // gap-1 at xs: the base gap-1.5 (6px) is wider than the 11.5px cap height, which
  // made an icon and its label read as two separate objects instead of one control.
  xs: 'h-6 gap-1 px-2 text-[11.5px]',
  sm: 'h-7.5 px-2.5 text-[12.5px]',
  md: 'h-9 px-3.5 text-[13.5px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = 'secondary',
  size = 'sm',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

/** Square icon button. `label` becomes the accessible name and the tooltip. */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'sm',
  className,
  children,
  ...props
}: ButtonProps & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        size === 'xs' ? 'size-6' : size === 'sm' ? 'size-7.5' : 'size-9',
        'relative p-0',
        // A 24px xs button around a 13px glyph is a small target, and these sit in
        // rows where a miss selects nothing. A transparent ::after extends the hit
        // area past the painted box without touching layout (so nothing in a
        // toolbar shifts) and without growing the hover surface.
        //
        // The horizontal bleed is capped at 2px on purpose: the dense rows that use
        // these are gap-0.5 (2px), so at 2px two neighbours can only overlap inside
        // the gap itself — a click can never be stolen from a sibling's *visible*
        // pixels. Vertical has no neighbours, so it takes 3px.
        "after:absolute after:content-[''] after:[inset:-3px_-2px]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Input -- */

/**
 * Shared control skin.
 *
 * Focus was `border-azure-400` + a 2px `ring-azure-100` halo: three pixels of very
 * pale blue that neither drew the eye nor read as crisp. It is now a 1px azure-500
 * border with a 1px azure-300 ring — one pixel *thinner* overall, far higher
 * contrast, and it reads as a sharpened edge rather than a glow.
 *
 * Disabled previously changed only the fill, leaving a full-strength paper-300
 * border that still looked live; it now recedes to a hairline and takes the
 * not-allowed cursor.
 *
 * Invalid had no visual treatment at all — `Field` rendered a red message above a
 * perfectly neutral, azure-focusing control. It now reacts both to an explicit
 * `aria-invalid` and to the `data-invalid` that `Field` sets from its `error` prop,
 * so existing call sites get the error state without changing.
 */
const CONTROL_BASE =
  'w-full rounded-lg border border-paper-300 bg-paper-0 text-paper-900 placeholder:text-paper-400 ' +
  'transition-[border-color,box-shadow,background-color,color] duration-[140ms] ' +
  '[transition-timing-function:var(--ease-out-quint)] ' +
  'hover:border-paper-400 ' +
  'focus:border-azure-500 focus:outline-none focus:ring-1 focus:ring-azure-300 ' +
  'disabled:cursor-not-allowed disabled:border-paper-200 disabled:bg-paper-50 ' +
  'disabled:text-paper-500 disabled:placeholder:text-paper-300 disabled:hover:border-paper-200 ' +
  'aria-[invalid=true]:border-danger-500 aria-[invalid=true]:hover:border-danger-500 ' +
  'aria-[invalid=true]:focus:border-danger-500 aria-[invalid=true]:focus:ring-danger-200 ' +
  'group-data-[invalid=true]/field:border-danger-500 group-data-[invalid=true]/field:hover:border-danger-500 ' +
  'group-data-[invalid=true]/field:focus:border-danger-500 group-data-[invalid=true]/field:focus:ring-danger-200';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL_BASE, 'h-9 px-2.5 text-[13.5px]', className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        CONTROL_BASE,
        // Textarea previously carried no disabled styling whatsoever, so a disabled
        // one was indistinguishable from an editable one. It now shares CONTROL_BASE.
        'px-2.5 py-2 text-[13.5px] leading-[1.5] resize-none',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn('group/field block', className)}
      // Lets the control inside pick up the error state. `error` is the only place
      // that knows a field is invalid, and Field takes its control as opaque
      // children, so the state has to travel down through the DOM rather than props.
      data-invalid={error ? 'true' : undefined}
    >
      {/* mb-1 put a 12px label 4px above a 36px control — close enough that the two
          read as one blob and the label stopped acting as a heading. 6px separates
          them without breaking the pair; the hint below matches it so the control
          sits optically centred in its own group rather than shunted upward. */}
      <span className="mb-1.5 block text-[12px] font-medium leading-[1.35] text-paper-700">
        {label}
      </span>
      {children}
      {/* Explicit leading: a two-line hint inheriting the body's line-height opened a
          gap wide enough to look like a separate paragraph. text-pretty stops the
          last line falling to a single orphaned word. */}
      {error ? (
        <span className="mt-1.5 block text-pretty text-[11.5px] leading-[1.4] text-danger-700">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-pretty text-[11.5px] leading-[1.4] text-paper-500">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/* ------------------------------------------------------------------- Card -- */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 shadow-panel',
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ Badge -- */

type BadgeTone = 'neutral' | 'accent' | 'positive' | 'caution' | 'danger' | 'claude';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-paper-100 text-paper-600 border-paper-200',
  accent: 'bg-azure-50 text-azure-700 border-azure-100',
  positive: 'bg-positive-50 text-positive-700 border-positive-200',
  caution: 'bg-caution-50 text-caution-700 border-caution-200',
  danger: 'bg-danger-50 text-danger-700 border-danger-200',
  claude: 'bg-[#f7f2ec] text-[#8a5a2b] border-[#ecdfd0]',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-[1px] text-[11px] font-medium',
        // Height came from the inherited line-height, so a badge holding a 9.5px icon
        // was a different height to the plain-text badge sitting next to it and the
        // row of chips came out ragged. A fixed 16px line box pins every badge to 20px.
        'leading-4',
        // Baseline-aligned inline-flex sat low against adjacent text (it aligns its
        // bottom margin edge to the baseline). No-op inside flex/grid parents, which
        // is where most of these live; a fix in the inline case.
        'align-middle',
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** Small coloured dot, used for build status and connection state. */
export function StatusDot({
  tone,
  pulse,
  className,
}: {
  tone: 'positive' | 'caution' | 'danger' | 'neutral' | 'accent';
  pulse?: boolean;
  className?: string;
}) {
  const colors = {
    positive: 'bg-positive-500',
    caution: 'bg-caution-500',
    danger: 'bg-danger-500',
    neutral: 'bg-paper-400',
    accent: 'bg-azure-500',
  } as const;
  return (
    // shrink-0: as a flex child next to a long label the 7px dot was compressed into
    // an ellipse. align-middle centres it on the text it annotates instead of
    // dropping it onto the baseline.
    <span className={cn('relative inline-block size-[7px] shrink-0 align-middle', className)}>
      <span className={cn('block size-full rounded-full', colors[tone])} />
      {pulse ? (
        // pointer-events-none: animate-ping scales this to 2x — 14px — which reached
        // over neighbouring controls and swallowed clicks aimed at them.
        // transform + opacity only, so the pulse stays on the compositor.
        <span
          className={cn(
            'pointer-events-none absolute inset-0 animate-ping rounded-full opacity-60 [animation-duration:1.8s]',
            colors[tone],
          )}
        />
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------- Empty state - */

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto max-w-[280px] px-4 py-10 text-center', className)}>
      {icon ? (
        // A paper-100 tile on a paper-0 card is a 3% value step: the icon read as
        // floating loose in the column rather than sitting in a container. The
        // hairline gives it an edge without adding weight.
        <div className="mx-auto mb-3 grid size-9 place-items-center rounded-lg border border-paper-200 bg-paper-100 text-paper-500">
          {icon}
        </div>
      ) : null}
      {/* text-balance: these titles are centred and often wrap, and an uneven
          4-words-then-1 break is the thing that makes an empty state look unfinished. */}
      <div className="text-balance text-[13px] font-semibold leading-[1.35] text-paper-800">
        {title}
      </div>
      {/* mt-1 was too tight under a semibold title for the pair to breathe, and
          leading-relaxed (1.625) at 12.5px in a 280px column spread two lines far
          enough apart that they stopped reading as one sentence. */}
      {body ? (
        <p className="mt-1.5 text-pretty text-[12.5px] leading-[1.5] text-paper-500">{body}</p>
      ) : null}
      {/* The action is a separate act from the message. A 16px gap against the body's
          6px is what groups title+body together and sets the button apart. */}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Layout -- */

export function PanelHeader({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // pr-1.5 rather than px-2.5: the trailing slot holds IconButtons, whose glyph
        // is inset ~5px inside its own box. With symmetric padding the header looked
        // right-heavy — the title started at 10px from the edge while the icons
        // started at 15px. Trimming the box padding lines the two optical edges up.
        'flex h-9 shrink-0 items-center justify-between gap-2 border-b border-paper-200 pl-2.5 pr-1.5',
        className,
      )}
    >
      {/* paper-500 on paper-0 is 3.9:1 — below AA for 11px text, and these are
          uppercase and letter-spaced, which is the hardest case to read. paper-600
          takes it to 6.2:1 and is still the quietest label in the panel. */}
      <div className="truncate text-[11px] font-semibold uppercase tracking-[0.055em] text-paper-600">
        {title}
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  // shrink-0: as a flex child in a column a 1px rule has no minimum size and was
  // collapsed to nothing the moment the container ran short.
  return <div className={cn('h-px w-full shrink-0 bg-paper-200', className)} />;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        // Was an inline box with no min width and no line box of its own: single
        // characters produced narrower keys than symbols, and the height varied with
        // whatever line-height it inherited. Centring the glyph in a fixed 18px-tall,
        // 17px-minimum cap makes a row of keys uniform. align-middle sits it on the
        // text's centre rather than its baseline.
        'inline-flex min-w-[17px] shrink-0 items-center justify-center rounded border border-paper-300',
        'bg-paper-50 px-1 py-[1px] align-middle font-mono text-[10px] leading-[14px] text-paper-600',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Avatar derived from a name + hue, so identities are recognisable without images. */
export function Avatar({
  name,
  hue,
  size = 26,
  className,
}: {
  name: string;
  hue: number;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className={cn(
        // leading-none: the initials were laid out in an inherited ~1.5 line box, so
        // the glyphs sat off-centre in the circle (and could overflow it at small
        // sizes). select-none: dragging across a member list should not select the
        // initials. title: two letters are often ambiguous — the full name should be
        // one hover away.
        'inline-grid shrink-0 select-none place-items-center rounded-full font-semibold leading-none',
        className,
      )}
      style={{
        width: size,
        height: size,
        // Math.round: size * 0.4 produced fractional sizes (10.4px at the default 26)
        // which the renderer resolves to blurry, inconsistently-hinted glyphs.
        fontSize: Math.round(size * 0.4),
        background: `hsl(${hue} 52% 92%)`,
        color: `hsl(${hue} 45% 32%)`,
      }}
      title={name}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
