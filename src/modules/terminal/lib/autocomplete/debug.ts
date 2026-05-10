/**
 * Opt-in debug for terminal line autocomplete.
 *
 * Enable: in DevTools console run
 *   localStorage.setItem('terax-debug-terminal-autocomplete', '1')
 * Disable:
 *   localStorage.removeItem('terax-debug-terminal-autocomplete')
 */

const STORAGE_KEY = "terax-debug-terminal-autocomplete";

export function isTerminalAutocompleteDebug(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function dbgTerminalAc(
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!isTerminalAutocompleteDebug()) return;
  if (data !== undefined) {
    console.debug(`[terax:terminal-ac] ${message}`, data);
  } else {
    console.debug(`[terax:terminal-ac] ${message}`);
  }
}
