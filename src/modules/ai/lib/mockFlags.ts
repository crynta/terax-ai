/**
 * E2E mock-provider flags and predicates (Phase C, Stage 0).
 *
 * Kept separate from `mockProvider.ts` so these tiny helpers can be imported
 * statically (by the chat store and the model pickers) while the actual mock
 * model builder, which pulls in `ai/test`, stays a lazily `import()`-ed chunk.
 */

/** Sentinel model id. Registered (hidden) in the catalog so it resolves. */
export const E2E_MOCK_MODEL_ID = "mock-echo";

const E2E_FLAG_KEY = "terax.e2e";

/**
 * True only when the e2e flag is set in this WebView. Guarded for non-browser
 * (SSR/unit) contexts and storage-access exceptions.
 */
export function isE2eMockEnabled(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(E2E_FLAG_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function isMockModelId(id: string): boolean {
  return id === E2E_MOCK_MODEL_ID;
}

/**
 * Whether a model id should appear in user-facing pickers. The e2e mock is
 * hidden unless the flag is set, so production never shows it.
 */
export function isModelSelectable(id: string): boolean {
  return !isMockModelId(id) || isE2eMockEnabled();
}
