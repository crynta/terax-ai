import type { LazyTerminalLinksOptions } from "./LazyTerminalLinks";

export interface DeferredTerminalLinks {
  invalidate(): void;
  dispose(): void;
}

/**
 * Brings in the link trigger (`LazyTerminalLinks`) once the surface exists:
 * hovering a link is not needed to draw or stream the first terminal, so none
 * of its code belongs to the chunk that does.
 */
export function deferTerminalLinks(
  options: LazyTerminalLinksOptions,
): DeferredTerminalLinks {
  let links: DeferredTerminalLinks | null = null;
  const loaded = import("./LazyTerminalLinks").then(
    ({ LazyTerminalLinks }) => (links = new LazyTerminalLinks(options)),
  );
  loaded.catch(console.error);
  return {
    invalidate: () => links?.invalidate(),
    // Disposing before the module arrived lets it build, then undoes it.
    dispose: () =>
      void loaded.then(
        (trigger) => trigger.dispose(),
        () => {},
      ),
  };
}
