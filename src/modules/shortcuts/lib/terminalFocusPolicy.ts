import { IS_MAC } from "@/lib/platform";
import { type KeyBinding, SHORTCUTS } from "../shortcuts";

/**
 * Who owns a chord while a terminal has focus.
 *
 * On Windows and Linux the application's primary modifier is Ctrl, which is
 * also the modifier of every readline and TUI binding (Ctrl+P/N history, R
 * search, E/A line ends, W/U/K/Y kill and yank, D end of input, ...). A plain
 * Ctrl+letter therefore belongs to the terminal whenever it has focus, and the
 * application's own default for that chord is reached through Ctrl+Shift
 * instead (Alt+Shift+D for splitting, as in Windows Terminal). On macOS the
 * primary modifier is Command, which the terminal never uses, so nothing moves.
 *
 * Bindings the user set themselves are never touched: an explicit choice wins
 * everywhere.
 */

const isTerminalControlChord = (binding: KeyBinding): boolean =>
  !!binding.ctrl &&
  !binding.shift &&
  !binding.alt &&
  !binding.meta &&
  /^[a-z]$/i.test(binding.key);

/**
 * Ctrl+Shift homes of the shortcuts whose plain Ctrl chord moved to the
 * terminal. A shortcut without an entry stays reachable from every other
 * focus and from the command palette. An alias takes the chord from a
 * shortcut that already used it, but only while a terminal has focus.
 * Keys are shortcut ids; ids this build does not know are ignored.
 */
const TERMINAL_FOCUS_ALIASES: Readonly<Record<string, readonly KeyBinding[]>> =
  {
    "commandPalette.open": [{ ctrl: true, shift: true, key: "p" }],
    "tab.new": [{ ctrl: true, shift: true, key: "t" }],
    "tab.close": [{ ctrl: true, shift: true, key: "w" }],
    "tab.newPrivate": [{ ctrl: true, shift: true, key: "r" }],
    "pane.splitRight": [{ alt: true, shift: true, key: "d" }],
    "pane.source": [{ ctrl: true, shift: true, key: "g" }],
    "search.focus": [{ ctrl: true, shift: true, key: "f" }],
    "ai.toggle": [{ ctrl: true, shift: true, key: "i" }],
    "ai.toggleMini": [{ alt: true, shift: true, key: "i" }],
  };

const signature = (binding: KeyBinding): string =>
  [
    !!binding.ctrl,
    !!binding.shift,
    !!binding.alt,
    !!binding.meta,
    binding.key.toLowerCase(),
  ].join("|");

type ShortcutLike = {
  readonly id: string;
  readonly defaultBindings: readonly KeyBinding[];
};

/**
 * Default bindings per shortcut while a terminal has focus. Identity on macOS.
 */
export function buildTerminalFocusBindings(
  shortcuts: readonly ShortcutLike[],
  isMac: boolean,
): ReadonlyMap<string, readonly KeyBinding[]> {
  const result = new Map<string, readonly KeyBinding[]>();
  if (isMac) {
    for (const shortcut of shortcuts)
      result.set(shortcut.id, shortcut.defaultBindings);
    return result;
  }
  const aliasOwner = new Map<string, string>();
  for (const shortcut of shortcuts)
    for (const alias of TERMINAL_FOCUS_ALIASES[shortcut.id] ?? [])
      aliasOwner.set(signature(alias), shortcut.id);
  for (const shortcut of shortcuts) {
    const own = TERMINAL_FOCUS_ALIASES[shortcut.id] ?? [];
    const bindings: KeyBinding[] = [];
    const seen = new Set<string>();
    for (const binding of [
      ...shortcut.defaultBindings.filter((b) => !isTerminalControlChord(b)),
      ...own,
    ]) {
      const sig = signature(binding);
      const owner = aliasOwner.get(sig);
      if (seen.has(sig) || (owner !== undefined && owner !== shortcut.id))
        continue;
      seen.add(sig);
      bindings.push(binding);
    }
    result.set(shortcut.id, bindings);
  }
  return result;
}

const TERMINAL_FOCUS_BINDINGS = buildTerminalFocusBindings(SHORTCUTS, IS_MAC);

/** The bindings to match for `id` right now. */
export function effectiveBindings(
  id: string,
  defaults: readonly KeyBinding[],
  userBindings: readonly KeyBinding[] | undefined,
  inTerminal: boolean,
): readonly KeyBinding[] {
  if (userBindings) return userBindings;
  if (!inTerminal) return defaults;
  return TERMINAL_FOCUS_BINDINGS.get(id) ?? defaults;
}
