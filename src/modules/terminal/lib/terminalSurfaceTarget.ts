export const TERMINAL_SURFACE_SELECTOR =
  ".xterm, [data-terax-terminal-surface]";

export function isTerminalSurfaceTarget(target: EventTarget | null): boolean {
  const candidate = target as {
    readonly parentElement?: { closest?: (selector: string) => Element | null };
    readonly closest?: (selector: string) => Element | null;
  } | null;
  const closest = candidate?.closest ?? candidate?.parentElement?.closest;
  if (!closest) return false;
  return (
    closest.call(
      candidate?.closest ? candidate : candidate?.parentElement,
      TERMINAL_SURFACE_SELECTOR,
    ) !== null
  );
}
