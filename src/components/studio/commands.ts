'use client';

import type { StoreApi } from 'zustand';
import { api, errorText } from '@/lib/api-client';
import { DEVICE_PRESETS } from '@/lib/devices/presets';
import { LAYOUT_PRESETS } from '@/lib/devices/layout';
import { ROLE_CATALOG } from '@/lib/devices/roles';
import type { DeviceRow } from '@/server/db';
import { canvasApi } from './canvas/canvas-api';
import { viewModeCommands } from './view-modes';
import { resolveTheme } from './theme';
import type { StudioStore } from './store';
import type { LeftTab } from './types';

/**
 * Everything the studio can be asked to do, as data.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * A command palette and a keyboard layer are the same list read two ways. Kept
 * apart they drift immediately: a shortcut gets added to the key handler and
 * never appears in the palette, or the palette advertises a key that nothing
 * binds. So there is one list — `studioCommands()` — and both the palette and
 * `useCommandShortcuts` read it. A shortcut hint shown in the palette is, by
 * construction, the shortcut that is bound.
 *
 * ---------------------------------------------------------------------------
 * What may be in here
 * ---------------------------------------------------------------------------
 * Only things the studio can actually do. Every `run` below is a call into
 * `StudioActions` (see store.ts) or into the canvas's imperative handle
 * (canvas-api.ts) — there is no command whose effect is a message saying
 * something happened. Two consequences worth stating, because both were
 * tempting to paper over:
 *
 *  - `canvasApi.center` is literally the same function as `canvasApi.fit`
 *    (canvas.tsx builds the handle with `center: fit`), so there is no separate
 *    "Recentre" command. Two rows that do the same thing is a lie about the
 *    surface, not a convenience.
 *  - The `free` layout preset means "leave every device where it is", i.e. it
 *    moves nothing. It is not offered: a command that provably does nothing has
 *    no business in a list of things you can do.
 *
 * ---------------------------------------------------------------------------
 * Shape
 * ---------------------------------------------------------------------------
 * `studioCommands(state, host)` is a function of state: state in, data out. It
 * writes nothing, mutates nothing and renders nothing, so it can be called on
 * every keystroke and tested without a DOM. One read does reach outside it —
 * resolving a `system` theme preference asks `matchMedia` which way the OS is
 * set, because that is the only way to know which way the toggle points; the
 * media-query object is cached in theme.tsx and the read cannot force a layout.
 *
 * It is a function rather than a constant array for two honest reasons:
 *
 *  1. Some commands only exist for this project — one "add a device" per role
 *    the project declares, one "run" per journey that has been recorded.
 *  2. A title can then say what will actually happen ("Hide the timeline",
 *    "Rotate Customer to landscape") instead of a vague "Toggle…".
 *
 * Availability is a separate, live question, so it stays a predicate:
 * `enabled(state)` is re-checked at the moment a command fires, not at the
 * moment the list was built. It returns `true`, or the *reason* it cannot run —
 * the palette shows that reason rather than hiding the row, because "Put the
 * last version that compiled back on screen · Nothing to recover — every preview
 * compiled" tells you something a missing row cannot.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type StudioStoreApi = StoreApi<StudioStore>;

/**
 * The order below is the order `studioCommands` emits, and therefore the order
 * the palette shows with an empty query. One sequence, not two.
 */
export type CommandGroup =
  | 'Canvas'
  | 'Arrange'
  | 'Devices'
  | 'Preview'
  | 'Files'
  | 'Versions'
  | 'Journeys'
  | 'Panels'
  | 'Project';

/** `true` when the command can run now, otherwise the reason it cannot. */
export type CommandAvailability = true | string;

export interface Command {
  /** Stable across renders; used as the React key and the a11y option id. */
  id: string;
  title: string;
  /** One line of detail. Also searched. */
  subtitle?: string;
  group: CommandGroup;
  /** Extra search terms that are not worth showing (family names, synonyms). */
  keywords?: string;
  /** See `parseShortcut` for the grammar. Omitted = palette only. */
  shortcut?: string;
  /**
   * Re-checked when the command fires, so a list built one frame ago cannot run
   * something that has since become impossible.
   */
  enabled?: (state: StudioStore) => CommandAvailability;
  run: (store: StudioStoreApi) => void | Promise<void>;
}

/**
 * Things the studio owns that are not in the store, handed in by whoever mounts
 * the palette.
 *
 * The share dialog's open/closed state lives in `StudioShell`, not in the store,
 * so a "Share" command can only be real if the studio passes the opener down.
 * When it does not, the command is *absent* rather than present-and-dead: a row
 * that cannot possibly work is worse than no row.
 */
export interface CommandHost {
  /** Opens the share dialog. */
  openShare?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Shortcut grammar                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `'mod+shift+s'`, `'mod+='`, `'f'`.
 *
 * `mod` is ⌘ on macOS and Ctrl everywhere else, and matching accepts either, so
 * an external keyboard on a Mac and a Mac keyboard on Linux both work.
 *
 * Deliberately not bound anywhere in this file: ⌘W, ⌘T, ⌘R and ⌘L. Taking those
 * from the browser costs someone their tab, their window or their address bar,
 * and no in-app action is worth that.
 */
export interface ParsedShortcut {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Lower-case `KeyboardEvent.key`, after the aliases below. */
  key: string;
}

/**
 * Same physical key, two names depending on the modifiers: shift+`=` reports `+`,
 * and Escape is spelled both ways in the wild. Normalising here means a shortcut
 * declared as `mod+=` also answers to ⌘⇧+.
 */
const KEY_ALIASES: Record<string, string> = {
  '+': '=',
  esc: 'escape',
  del: 'delete',
  return: 'enter',
  spacebar: ' ',
  space: ' ',
};

function normaliseKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

const PARSE_CACHE = new Map<string, ParsedShortcut>();

export function parseShortcut(shortcut: string): ParsedShortcut {
  const cached = PARSE_CACHE.get(shortcut);
  if (cached) return cached;

  const parsed: ParsedShortcut = { mod: false, shift: false, alt: false, key: '' };
  for (const raw of shortcut.split('+')) {
    const part = raw.trim().toLowerCase();
    // An empty segment is the '+' character itself ('mod++'), which is the same
    // physical key as '='.
    if (part === '') {
      parsed.key = '=';
      continue;
    }
    if (part === 'mod' || part === 'cmd' || part === 'ctrl' || part === 'meta') parsed.mod = true;
    else if (part === 'shift') parsed.shift = true;
    else if (part === 'alt' || part === 'option') parsed.alt = true;
    else parsed.key = normaliseKey(part);
  }

  PARSE_CACHE.set(shortcut, parsed);
  return parsed;
}

/**
 * Exact match, including the modifiers that were *not* asked for: `f` must not
 * fire on ⌘F (the browser's find), and `mod+s` must not fire on ⌘⇧S.
 *
 * One exception, and only one: a key whose *name* changed because Shift was
 * held. On a US layout the key labelled `+` is Shift and `=`, and the browser
 * reports `event.key === '+'` — so a strict shift comparison made `mod+=` refuse
 * the exact keystroke the palette draws as `⌘ +`. A cap that names a chord which
 * does nothing is a lie about the surface, so when the alias table is what
 * matched, shift is considered already accounted for. Nothing else relaxes:
 * `f` still must not fire on ⇧F, because `F` normalises to `f` with no alias.
 */
function shiftIsPartOfTheKeyName(event: KeyboardEvent): boolean {
  const raw = event.key.toLowerCase();
  return event.shiftKey && raw !== normaliseKey(event.key) && KEY_ALIASES[raw] !== undefined;
}

export function shortcutMatches(shortcut: string, event: KeyboardEvent): boolean {
  const parsed = parseShortcut(shortcut);
  const mod = event.metaKey || event.ctrlKey;
  if (parsed.mod !== mod) return false;
  if (parsed.alt !== event.altKey) return false;
  if (normaliseKey(event.key) !== parsed.key) return false;
  if (parsed.shift !== event.shiftKey) return shiftIsPartOfTheKeyName(event) && !parsed.shift;
  return true;
}

const MAC_MODIFIERS: Record<'mod' | 'shift' | 'alt', string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
};
const PC_MODIFIERS: Record<'mod' | 'shift' | 'alt', string> = {
  mod: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
};

const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  enter: '↵',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space',
  '=': '+',
};

/** One string per key cap, ready for a row of `<Kbd>`. */
export function formatShortcut(shortcut: string, mac: boolean): string[] {
  const parsed = parseShortcut(shortcut);
  const modifiers = mac ? MAC_MODIFIERS : PC_MODIFIERS;
  const caps: string[] = [];
  if (parsed.mod) caps.push(modifiers.mod);
  if (parsed.alt) caps.push(modifiers.alt);
  if (parsed.shift) caps.push(modifiers.shift);
  const label = KEY_LABELS[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
  caps.push(label);
  return caps;
}

/** The palette's own key. Owned by the palette component, shown by it too. */
export const PALETTE_SHORTCUT = 'mod+k';

/* -------------------------------------------------------------------------- */
/* Availability helpers                                                        */
/* -------------------------------------------------------------------------- */

export function commandAvailability(command: Command, state: StudioStore): CommandAvailability {
  return command.enabled ? command.enabled(state) : true;
}

export function isCommandEnabled(command: Command, state: StudioStore): boolean {
  return commandAvailability(command, state) === true;
}

/**
 * Runs a command if it is still allowed to run, and reports a thrown error
 * through the studio's own toast rather than the console.
 *
 * Returns whether it ran, so a caller can tell "did nothing because it is
 * disabled" from "did something".
 */
export function runCommand(command: Command, store: StudioStoreApi): boolean {
  if (!isCommandEnabled(command, store.getState())) return false;
  void (async () => {
    try {
      await command.run(store);
    } catch (error) {
      // Store actions already catch and notify; this is for the ones that
      // cannot (a rejected clipboard write, a preference PATCH), so a failure is
      // never silent.
      store.getState().notify('error', errorText(error));
    }
  })();
  return true;
}

/* -------------------------------------------------------------------------- */
/* Small state readers                                                         */
/* -------------------------------------------------------------------------- */

/** The one selected device, or null when zero or several are selected. */
function soleDevice(state: StudioStore): DeviceRow | null {
  if (state.selectedDeviceIds.length !== 1) return null;
  const id = state.selectedDeviceIds[0];
  if (id === undefined) return null;
  return state.devices.find((device) => device.id === id) ?? null;
}

/**
 * Commands that act on "the selected device" need exactly one, and the three
 * ways of not having one are three different pieces of information.
 */
function needsOneDevice(state: StudioStore): CommandAvailability {
  if (state.devices.length === 0) return 'There are no devices on the canvas.';
  if (state.selectedDeviceIds.length === 0) return 'Select a device first.';
  if (soleDevice(state) === null) return 'Several devices are selected — select just one.';
  return true;
}

function needsDevices(state: StudioStore): CommandAvailability {
  return state.devices.length > 0 ? true : 'There are no devices on the canvas.';
}

/** The bundle key of the first preview whose build failed, if any. */
function failedBundleKey(state: StudioStore): string | null {
  for (const [key, bundle] of Object.entries(state.bundles)) {
    if (bundle.status === 'error') return key;
  }
  return null;
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The declared order of `CommandGroup`, as data.
 *
 * The palette starts a new section every time the group changes as it walks the
 * list, so a group that appears twice in this array draws its heading twice.
 * That used to happen: `viewModeCommands` contributes one `Canvas` command and
 * one `Project` command, and splicing it in after `panelCommands` put a second
 * `Canvas` heading below `Panels` on every open. Sorting by this makes the
 * comment above — one sequence, not two — true by construction rather than by
 * everyone remembering to append in the right place.
 */
const GROUP_ORDER: readonly CommandGroup[] = [
  'Canvas',
  'Arrange',
  'Devices',
  'Preview',
  'Files',
  'Versions',
  'Journeys',
  'Panels',
  'Project',
];

export function studioCommands(state: StudioStore, host: CommandHost = {}): Command[] {
  const commands = [
    ...canvasCommands(state),
    ...arrangeCommands(),
    ...deviceCommands(state),
    ...previewCommands(state),
    ...fileCommands(state),
    ...versionCommands(state),
    ...journeyCommands(state),
    ...panelCommands(state),
    // Focus and Presentation. They live in view-modes.ts because entering and
    // leaving is a pure reducer over a mode plus a camera snapshot; this is the
    // one line that puts them in front of a person.
    ...viewModeCommands(state),
    ...projectCommands(state, host),
  ];

  // Stable, so the order *within* a group is still the order it was written in.
  return commands
    .map((command, index) => ({ command, index }))
    .sort(
      (a, b) =>
        GROUP_ORDER.indexOf(a.command.group) - GROUP_ORDER.indexOf(b.command.group) ||
        a.index - b.index,
    )
    .map((entry) => entry.command);
}

/* ------------------------------------------------------------------ canvas - */

function canvasCommands(state: StudioStore): Command[] {
  const device = soleDevice(state);

  return [
    {
      id: 'canvas.fit',
      title: 'Fit every device on screen',
      group: 'Canvas',
      shortcut: 'f',
      keywords: 'zoom to fit recentre center',
      enabled: needsDevices,
      run: () => canvasApi.get()?.fit(),
    },
    {
      id: 'canvas.zoom-in',
      title: 'Zoom in',
      group: 'Canvas',
      shortcut: 'mod+=',
      run: () => canvasApi.get()?.zoomBy(1.25),
    },
    {
      id: 'canvas.zoom-out',
      title: 'Zoom out',
      group: 'Canvas',
      shortcut: 'mod+-',
      run: () => canvasApi.get()?.zoomBy(1 / 1.25),
    },
    {
      id: 'canvas.zoom-reset',
      title: 'Zoom to 100%',
      subtitle: 'One canvas pixel per screen pixel.',
      group: 'Canvas',
      shortcut: 'mod+0',
      run: () => canvasApi.get()?.zoomTo(1),
    },
    {
      id: 'canvas.focus-device',
      title: device ? `Zoom to ${device.name}` : 'Zoom to the selected device',
      group: 'Canvas',
      keywords: 'focus isolate',
      enabled: needsOneDevice,
      run: (store) => {
        const target = soleDevice(store.getState());
        if (target) canvasApi.get()?.focusDevice(target.id);
      },
    },
    {
      id: 'canvas.inspect',
      title: state.inspectMode ? 'Cancel inspect mode' : 'Inspect a component',
      subtitle: state.inspectMode
        ? undefined
        : 'Click anything in a preview to open the file that renders it.',
      group: 'Canvas',
      shortcut: 'i',
      run: (store) => {
        const current = store.getState();
        current.setInspectMode(!current.inspectMode);
      },
    },
  ];
}

/* ----------------------------------------------------------------- arrange - */

function arrangeCommands(): Command[] {
  const commands: Command[] = [
    {
      id: 'arrange.auto',
      title: 'Arrange the canvas',
      subtitle: 'Picks a layout from the number of devices, then fits them on screen.',
      group: 'Arrange',
      shortcut: 'a',
      keywords: 'tidy layout auto',
      enabled: needsDevices,
      run: (store) => store.getState().arrangeDevices(),
    },
  ];

  // `free` is excluded on purpose: it returns no positions, i.e. it moves
  // nothing. See the note at the top of this file.
  for (const preset of LAYOUT_PRESETS) {
    if (preset.id === 'free') continue;
    commands.push({
      id: `arrange.${preset.id}`,
      title: `Arrange: ${preset.label.toLowerCase()}`,
      subtitle: preset.hint,
      group: 'Arrange',
      keywords: 'layout',
      enabled: needsDevices,
      run: (store) => store.getState().arrangeDevices(preset.id),
    });
  }

  return commands;
}

/* ----------------------------------------------------------------- devices - */

function deviceCommands(state: StudioStore): Command[] {
  const commands: Command[] = [];

  // The project's own roles when it declares any, the built-in catalogue
  // otherwise — the same fallback the toolbar's Add-device menu uses, so the two
  // never offer different sets.
  const roles =
    state.roles.length > 0
      ? state.roles
      : ROLE_CATALOG.map((role) => ({
          slug: role.slug,
          label: role.label,
          defaultUser: role.defaultUser,
        }));

  for (const role of roles) {
    commands.push({
      id: `device.add.${role.slug}`,
      title: `Add a device: ${role.label}`,
      // The format is deliberately not claimed here: this sends no `presetId`,
      // so the server picks the default and only it knows what that is today.
      subtitle: role.defaultUser ? `Signed in as ${role.defaultUser}.` : 'No signed-in user.',
      group: 'Devices',
      keywords: 'new phone create',
      run: (store) =>
        store.getState().addDevice({
          role: role.slug,
          name: role.label,
          userLabel: role.defaultUser,
        }),
    });
  }

  const device = soleDevice(state);

  commands.push({
    id: 'device.duplicate',
    title: device ? `Duplicate ${device.name}` : 'Duplicate the selected device',
    subtitle: 'Same role, format, pinned version and edge cases.',
    group: 'Devices',
    shortcut: 'mod+d',
    enabled: needsOneDevice,
    run: (store) => {
      const target = soleDevice(store.getState());
      return target ? store.getState().duplicateDevice(target.id) : undefined;
    },
  });

  const rotateTo = device?.orientation === 'landscape' ? 'portrait' : 'landscape';
  commands.push({
    id: 'device.rotate',
    title: device ? `Rotate ${device.name} to ${rotateTo}` : 'Rotate the selected device',
    group: 'Devices',
    shortcut: 'o',
    keywords: 'orientation landscape portrait',
    enabled: needsOneDevice,
    run: (store) => {
      const target = soleDevice(store.getState());
      if (!target) return undefined;
      return store.getState().patchDevice(target.id, {
        orientation: target.orientation === 'landscape' ? 'portrait' : 'landscape',
      });
    },
  });

  const deviceTheme = device?.theme === 'dark' ? 'light' : 'dark';
  commands.push({
    id: 'device.theme',
    title: device
      ? `Show ${device.name} in ${deviceTheme}`
      : 'Switch the selected device to dark or light',
    subtitle: 'The simulated device appearance your app sees, not the studio’s.',
    group: 'Devices',
    keywords: 'dark light appearance colour scheme',
    enabled: needsOneDevice,
    run: (store) => {
      const target = soleDevice(store.getState());
      if (!target) return undefined;
      return store
        .getState()
        .patchDevice(target.id, { theme: target.theme === 'dark' ? 'light' : 'dark' });
    },
  });

  commands.push({
    id: 'device.reload',
    title: device ? `Reload ${device.name}` : 'Reload the selected device',
    subtitle: 'Re-sends the compiled bundle to that preview.',
    group: 'Devices',
    enabled: needsOneDevice,
    run: (store) => {
      const target = soleDevice(store.getState());
      if (target) store.getState().reloadDevice(target.id);
    },
  });

  for (const preset of DEVICE_PRESETS) {
    commands.push({
      id: `device.format.${preset.id}`,
      title: device
        ? `Change ${device.name} to ${preset.name}`
        : `Change the selected device to ${preset.name}`,
      subtitle: `${preset.viewport.width}×${preset.viewport.height}`,
      group: 'Devices',
      keywords: `format preset ${preset.family}`,
      enabled: (current) => {
        const availability = needsOneDevice(current);
        if (availability !== true) return availability;
        const target = soleDevice(current);
        return target?.presetId === preset.id ? 'Already this format.' : true;
      },
      run: (store) => {
        const target = soleDevice(store.getState());
        return target
          ? store.getState().patchDevice(target.id, { presetId: preset.id })
          : undefined;
      },
    });
  }

  return commands;
}

/* ----------------------------------------------------------------- preview - */

function previewCommands(state: StudioStore): Command[] {
  return [
    {
      id: 'preview.rebuild',
      title: 'Rebuild the preview',
      subtitle: 'Recompiles every version the canvas is showing.',
      group: 'Preview',
      shortcut: 'r',
      keywords: 'compile build refresh',
      run: (store) => store.getState().rebuildAll(true),
    },
    {
      id: 'preview.reset',
      title: 'Reset every device',
      subtitle: 'Reloads each preview and clears the state shared between them.',
      group: 'Preview',
      keywords: 'restart clear shared',
      enabled: needsDevices,
      run: (store) => {
        store.getState().resetDevices(true);
      },
    },
    {
      id: 'preview.recover',
      title: 'Put the last version that compiled back on screen',
      subtitle: 'Your files are not touched — only what the phones are running.',
      group: 'Preview',
      keywords: 'restore recover broken build failed',
      enabled: (current) => {
        // Only "no bundle is in the `error` state" is observed here. That is not
        // the same as "every preview compiled": a bundle that is still
        // `building`, or that has never been built at all (the studio's first
        // seconds, before `rebuildAll` resolves), is also not failing. Saying
        // the stronger thing would be claiming a build result nothing reported.
        if (failedBundleKey(current) === null) return 'Nothing to recover — no preview is failing.';
        if (current.versions.length === 0) return 'There is no snapshot to fall back on.';
        return true;
      },
      run: async (store) => {
        const key = failedBundleKey(store.getState());
        if (key === null) return;
        const before = store.getState().bundles[key]?.recoveredFrom ?? null;
        await store.getState().recoverLastWorking(key);

        /*
         * `recoverLastWorking` is silent by design — it runs *because* something
         * already failed, and its own failure must not bury that error. Asked
         * for deliberately, though, silence is indistinguishable from a dead
         * menu item, so this reports what actually happened by reading the
         * bundle back: `recoveredFrom` is written only when a snapshot really
         * was put on screen.
         *
         * Four outcomes, each read off the bundle rather than assumed. The last
         * two are why this is not a single if/else: `recoverLastWorking` leaves
         * `status` at 'error', so the row stays enabled and a second press finds
         * the same snapshot again. Comparing only `before`/`after` reported that
         * successful re-run as "no recent snapshot compiles", which was the
         * opposite of what had just happened.
         */
        const after = store.getState().bundles[key];
        const recovered = after?.recoveredFrom ?? null;
        if (after?.status === 'ready') {
          store.getState().notify('success', 'That preview compiles again — nothing needed restoring.');
        } else if (recovered === null) {
          store
            .getState()
            .notify('error', 'No recent snapshot compiles either — there is nothing to put back on screen.');
        } else if (recovered !== before) {
          store
            .getState()
            .notify('success', `Showing “${recovered}” — the newest snapshot that compiles.`);
        } else {
          // Same snapshot as before this ran. It is on screen — that much the
          // bundle says — and nothing here knows whether this attempt or the
          // previous one put it there, so it does not claim either.
          store.getState().notify('info', `Still showing “${recovered}”.`);
        }
      },
    },
    {
      id: 'preview.edge-cases',
      title: state.edgeCasesOpen ? 'Close the Edge Case Studio' : 'Open the Edge Case Studio',
      group: 'Preview',
      shortcut: 'e',
      keywords: 'flags offline empty error states',
      run: (store) => store.getState().toggleEdgeCases(),
    },
  ];
}

/* ------------------------------------------------------------------- files - */

function fileCommands(state: StudioStore): Command[] {
  const activePath = state.activeFilePath;

  return [
    {
      id: 'file.new',
      // The same prompt the Files panel uses, so "new file" means one thing.
      title: 'New file…',
      group: 'Files',
      keywords: 'create add',
      run: (store) => {
        const path = window.prompt('New file path', 'src/components/NewScreen.tsx');
        if (path) return store.getState().createFile(path, '');
        return undefined;
      },
    },
    {
      id: 'file.save',
      title: activePath ? `Save ${fileName(activePath)}` : 'Save the open file',
      group: 'Files',
      shortcut: 'mod+s',
      keywords: 'write',
      enabled: (current) => {
        const path = current.activeFilePath;
        if (path === null) return 'No file is open.';
        const file = current.openFiles.find((entry) => entry.path === path);
        if (!file || file.draft === null) return 'No unsaved changes.';
        return true;
      },
      run: (store) => {
        const path = store.getState().activeFilePath;
        return path === null ? undefined : store.getState().saveFile(path);
      },
    },
  ];
}

/* ---------------------------------------------------------------- versions - */

function versionCommands(state: StudioStore): Command[] {
  return [
    {
      id: 'version.snapshot',
      // The ellipsis is a promise: these three ask for a name before they act.
      title: 'Create a snapshot…',
      subtitle: 'Saves every file as a version you can restore, share or compare.',
      group: 'Versions',
      shortcut: 'mod+shift+s',
      keywords: 'save version checkpoint',
      enabled: (current) =>
        current.files.length > 0 ? true : 'There are no files to snapshot yet.',
      run: (store) => {
        const suggestion = `V${store.getState().versions.length + 1}`;
        const label = window.prompt('Name this snapshot', suggestion);
        if (label === null) return undefined;
        return store.getState().createSnapshot(label.trim() || suggestion, '');
      },
    },
    {
      id: 'version.compare',
      title: state.compare.active ? 'Stop comparing versions' : 'Compare two versions',
      group: 'Versions',
      shortcut: 'c',
      keywords: 'diff side by side',
      // Stopping is always possible; only starting needs something to compare to.
      enabled: (current) =>
        current.compare.active || current.versions.length > 0
          ? true
          : 'There are no snapshots to compare against yet.',
      run: (store) => {
        // Deliberately identical to the toolbar's Compare button, down to the
        // panel it opens: two controls for one feature must not behave differently.
        const current = store.getState();
        const latest = current.versions[0];
        const previous = current.versions[1];
        const wasActive = current.compare.active;
        current.setCompare({
          active: !wasActive,
          baseRef: previous?.id ?? latest?.id ?? 'working',
          targetRef: 'working',
          path: null,
        });
        if (!wasActive) current.setLeftTab('versions');
      },
    },
  ];
}

/* ---------------------------------------------------------------- journeys - */

function journeyCommands(state: StudioStore): Command[] {
  const recording = state.recording;
  const commands: Command[] = [];

  if (recording?.active) {
    commands.push(
      {
        id: 'journey.save',
        title: 'Save the recording as a journey…',
        subtitle: `${recording.steps.length} step(s) captured so far.`,
        group: 'Journeys',
        enabled: (current) =>
          (current.recording?.steps.length ?? 0) > 0 ? true : 'Nothing has been recorded yet.',
        run: (store) => {
          const name = window.prompt('Journey name', 'New customer books a court');
          if (!name) return undefined;
          return store.getState().saveRecording(name, '');
        },
      },
      {
        id: 'journey.discard',
        title: 'Discard the recording',
        group: 'Journeys',
        run: (store) => store.getState().cancelRecording(),
      },
    );
  } else {
    commands.push({
      id: 'journey.record',
      title: 'Record a journey',
      subtitle: 'Resets every device, then captures taps, entries and cross-device events.',
      group: 'Journeys',
      enabled: needsDevices,
      run: (store) => store.getState().startRecording(),
    });
  }

  if (state.replay) {
    commands.push({
      id: 'journey.stop',
      title: `Stop the replay (step ${state.replay.step + 1} of ${state.replay.total})`,
      group: 'Journeys',
      run: (store) => store.getState().stopReplay(),
    });
  }

  for (const journey of state.journeys) {
    commands.push({
      id: `journey.run.${journey.id}`,
      title: `Run journey: ${journey.name}`,
      subtitle: `${journey.stepCount} step${journey.stepCount === 1 ? '' : 's'}${
        journey.description ? ` · ${journey.description}` : ''
      }`,
      group: 'Journeys',
      keywords: 'replay play',
      enabled: (current) => {
        if (current.replay) return 'A replay is already running.';
        if (current.recording?.active) return 'A recording is in progress.';
        if (current.devices.length === 0) return 'There are no devices on the canvas.';
        return true;
      },
      run: (store) => store.getState().runJourney(journey.id),
    });
  }

  return commands;
}

/* ------------------------------------------------------------------ panels - */

const LEFT_TABS: { id: LeftTab; label: string; subtitle: string }[] = [
  { id: 'files', label: 'Files', subtitle: 'The project tree.' },
  { id: 'code', label: 'Code', subtitle: 'The open editors.' },
  { id: 'logs', label: 'Logs', subtitle: 'Build diagnostics and runtime errors.' },
  { id: 'versions', label: 'Versions', subtitle: 'Snapshots, restore and diff.' },
  { id: 'claude', label: 'Claude', subtitle: 'What Claude did over MCP.' },
  { id: 'comments', label: 'Comments', subtitle: 'Reviewer threads.' },
];

function panelCommands(state: StudioStore): Command[] {
  const commands: Command[] = LEFT_TABS.map((tab) => ({
    id: `panel.${tab.id}`,
    title: `Open the ${tab.label} panel`,
    subtitle: tab.subtitle,
    group: 'Panels',
    keywords: 'panel tab left',
    enabled: (current) =>
      current.leftTab === tab.id ? `The ${tab.label} panel is already open.` : true,
    run: (store) => store.getState().setLeftTab(tab.id),
  }));

  commands.push({
    id: 'panel.timeline',
    title: state.timelineOpen ? 'Hide the timeline' : 'Show the timeline',
    subtitle: 'Everything the devices reported, in order.',
    group: 'Panels',
    shortcut: 't',
    keywords: 'events history',
    run: (store) => store.getState().toggleTimeline(),
  });

  return commands;
}

/* ----------------------------------------------------------------- project - */

function projectCommands(state: StudioStore, host: CommandHost): Command[] {
  const commands: Command[] = [];

  if (host.openShare) {
    const openShare = host.openShare;
    commands.push({
      id: 'project.share',
      title: 'Share for review',
      subtitle: 'A link that runs the app — no code, no project metadata.',
      group: 'Project',
      keywords: 'link reviewer invite',
      run: () => openShare(),
    });
  }

  const currentTheme = resolveTheme(state.preferences.theme);
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
  commands.push({
    id: 'project.theme',
    title: `Switch to the ${nextTheme} theme`,
    subtitle: 'The studio chrome only — a device always renders your app in its own theme.',
    group: 'Project',
    keywords: 'dark light appearance',
    run: async (store) => {
      const current = store.getState();
      const target = resolveTheme(current.preferences.theme) === 'dark' ? 'light' : 'dark';
      // There is no `setTheme` action — the theme is an account preference that
      // `useStudioTheme` reads straight off the store — so this writes the
      // preference and lets the same subscription apply it, exactly as the
      // Settings page would.
      store.setState({ preferences: { ...current.preferences, theme: target } });
      try {
        await api('/api/me', { method: 'PATCH', body: { preferences: { theme: target } } });
      } catch {
        // The theme did change; only saving it failed. Say precisely that
        // rather than leaving someone to discover it on their next visit.
        store
          .getState()
          .notify('error', 'Theme changed for now — it could not be saved to your account.');
      }
    },
  });

  return commands;
}
