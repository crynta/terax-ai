export type SessionInitializationState = {
  generation: number;
  disposed: boolean;
  initializing: Promise<void> | null;
};

export function initializeSessionGeneration(
  state: SessionInitializationState,
  initialize: (generation: number) => Promise<void>,
  onFailure: (error: unknown) => void,
): Promise<void> {
  if (state.initializing) return state.initializing;
  const generation = ++state.generation;
  state.initializing = initialize(generation).catch((error: unknown) => {
    if (!state.disposed && generation === state.generation) onFailure(error);
  });
  return state.initializing;
}
