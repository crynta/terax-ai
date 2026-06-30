/**
 * Deterministic offline pi runtime for end-to-end tests (Phase C, Stage 3 prep).
 *
 * The pi agent streams through `pi-ai`'s `Model<Api>` + API-provider registry.
 * pi-ai ships an official faux provider (`registerFauxProvider`) that streams a
 * scripted `AssistantMessage` with no network and no key, which is exactly what
 * the harness needs to drive a pi-backed surface. This module wraps it behind
 * the same `terax.e2e` flag the AI-SDK mock uses, so `resolveAgentModel` can
 * return a working offline model when (and only when) the flag is set.
 */
import {
  type Api,
  fauxAssistantMessage,
  type FauxProviderRegistration,
  type Model,
  registerFauxProvider,
} from "@earendil-works/pi-ai";

export const MOCK_PI_API = "terax-mock";
export const MOCK_PI_PROVIDER = "terax-mock";
export const MOCK_PI_MODEL_ID = "mock-echo";

/** Canned assistant reply; specs assert this text streamed into the transcript. */
export const MOCK_PI_REPLY =
  "Mock pi reply: hello from the offline e2e runtime.";

let registration: FauxProviderRegistration | null = null;

/**
 * Idempotently register the deterministic faux pi provider and return its model.
 * Re-arms the canned response on every call so each session (or model switch)
 * has a reply queued, and so a second turn after the queue drains still answers.
 */
export function ensureMockPiModel(): Model<Api> {
  if (!registration) {
    registration = registerFauxProvider({
      api: MOCK_PI_API,
      provider: MOCK_PI_PROVIDER,
      models: [{ id: MOCK_PI_MODEL_ID, name: "Mock (e2e)" }],
      // Stream fast so e2e is not paced by a simulated token rate.
      tokensPerSecond: 10_000,
    });
  }
  registration.setResponses([
    (_context, _options, _state, _model) => fauxAssistantMessage(MOCK_PI_REPLY),
  ]);
  return registration.getModel() as Model<Api>;
}

/** Tear down the faux provider (tests / teardown). */
export function resetMockPiModel(): void {
  registration?.unregister();
  registration = null;
}
