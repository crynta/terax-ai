import type { GhosttySearchSnapshot } from "@/modules/terminal/ghostty/search/GhosttySearchController";

type Disposable = { dispose(): void };
type RecoverableSurface = Disposable & {
  searchController(): {
    snapshot(): GhosttySearchSnapshot;
    restore(snapshot: GhosttySearchSnapshot): void;
    suspend(): void;
    resume(): void;
  };
};

export function replaceSessionSurface<
  Surface extends RecoverableSurface,
  Input extends Disposable,
>(
  state: { surface: Surface | null; input: Input | null },
  create: () => Surface,
  attach: (surface: Surface) => void,
  createInput: (surface: Surface) => Input,
): Surface {
  const previous = state.surface;
  const previousInput = state.input;
  const search = previous?.searchController().snapshot();
  const replacement = create();
  previous?.searchController().suspend();
  let input: Input | null = null;
  try {
    input = createInput(replacement);
    attach(replacement);
    if (search) replacement.searchController().restore(search);
  } catch (error) {
    try {
      input?.dispose();
    } finally {
      replacement.dispose();
      previous?.searchController().resume();
    }
    throw error;
  }
  state.surface = replacement;
  state.input = input;
  try {
    previousInput?.dispose();
  } finally {
    previous?.dispose();
  }
  return replacement;
}
