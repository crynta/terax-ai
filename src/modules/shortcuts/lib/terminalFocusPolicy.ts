import { IS_MAC } from "@/lib/platform";
import { type KeyBinding, SHORTCUTS } from "../shortcuts";

/**
 * Who owns a chord while a terminal has focus.
 *
 * On Windows and Linux the application's primary modifier is Ctrl, which is
 * also the modifier of every readline and TUI binding (Ctrl+P/N history, R
 * search, E/A line ends, W/U/K/Y kill and yank, D end of input, Ctrl+[ for
 * Escape, Ctrl+] tag jump, Ctrl+- undo ...). A plain Ctrl chord that produces
 * a control byte therefore belongs to the terminal whenever it has focus. The
 * application command that used it keeps working through Ctrl+Shift+<same
 * key>; a command that already owned that chord moves to Alt+Shift+<same key>
 * instead, so every command stays reachable. On macOS the primary modifier is
 * Command, which the terminal never uses, so nothing moves.
 *
 * Bindings the user set themselves are never touched: an explicit choice wins
 * everywhere. Editor shortcuts are not managed: they only act in editor tabs,
 * which never hold a terminal.
 */

/** Keys whose Ctrl chord is a C0 control byte (letters, `@ [ \ ] ^ _`, `/`, `-`, Space). */
const CONTROL_KEY = /^[a-z@[\\\]^_/\- ]$/i;

const isTerminalControlChord = (binding: KeyBinding): boolean =>
  !!binding.ctrl &&
  !binding.shift &&
  !binding.alt &&
  !binding.meta &&
  CONTROL_KEY.test(binding.key);

/** Shortcuts that keep Ctrl+Shift+<key> when a displaced command wants it. */
const KEEPS_OWN_CHORD: ReadonlySet<string> = new Set(["commandPalette.open"]);

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
  readonly group?: string;
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

  const managed = shortcuts.filter((shortcut) => shortcut.group !== "Editor");
  const defaultOwner = new Map<string, string>();
  for (const shortcut of managed)
    for (const binding of shortcut.defaultBindings)
      if (!defaultOwner.has(signature(binding)))
        defaultOwner.set(signature(binding), shortcut.id);

  const added = new Map<string, KeyBinding[]>();
  const moved = new Map<string, Set<string>>();
  const give = (id: string, binding: KeyBinding) => {
    const list = added.get(id) ?? [];
    list.push(binding);
    added.set(id, list);
  };
  for (const shortcut of managed)
    for (const chord of shortcut.defaultBindings) {
      if (!isTerminalControlChord(chord)) continue;
      const natural: KeyBinding = {
        ctrl: true,
        shift: true,
        key: chord.key.toLowerCase(),
      };
      const alternative: KeyBinding = {
        alt: true,
        shift: true,
        key: chord.key.toLowerCase(),
      };
      const owner = defaultOwner.get(signature(natural));
      if (owner === undefined || owner === shortcut.id) {
        give(shortcut.id, natural);
      } else if (KEEPS_OWN_CHORD.has(owner)) {
        give(shortcut.id, alternative);
      } else {
        give(shortcut.id, natural);
        give(owner, alternative);
        const away = moved.get(owner) ?? new Set<string>();
        away.add(signature(natural));
        moved.set(owner, away);
      }
    }

  for (const shortcut of shortcuts) {
    if (shortcut.group === "Editor") {
      result.set(shortcut.id, shortcut.defaultBindings);
      continue;
    }
    const away = moved.get(shortcut.id);
    const bindings: KeyBinding[] = [];
    const seen = new Set<string>();
    for (const binding of [
      ...shortcut.defaultBindings.filter(
        (b) => !isTerminalControlChord(b) && !away?.has(signature(b)),
      ),
      ...(added.get(shortcut.id) ?? []),
    ]) {
      const sig = signature(binding);
      if (seen.has(sig)) continue;
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

/**
 * The bindings a terminal gives this shortcut when they differ from what the
 * rest of the app uses, for display; null when they are the same or the user
 * chose the binding.
 */
export function terminalFocusDifference(
  id: string,
  defaults: readonly KeyBinding[],
  userBindings: readonly KeyBinding[] | undefined,
): readonly KeyBinding[] | null {
  if (userBindings) return null;
  const inTerminal = TERMINAL_FOCUS_BINDINGS.get(id);
  if (!inTerminal) return null;
  const same =
    inTerminal.length === defaults.length &&
    inTerminal.every(
      (binding, index) => signature(binding) === signature(defaults[index]),
    );
  return same ? null : inTerminal;
}
