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
  type Context,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type FauxProviderRegistration,
  type Model,
  registerFauxProvider,
} from "@earendil-works/pi-ai";

export const MOCK_PI_API = "terax-mock";
export const MOCK_PI_PROVIDER = "terax-mock";
export const MOCK_PI_MODEL_ID = "mock-echo";

const APPROVE_WRITE_PROMPT = "[terax-e2e-pi-approval-approved]";
const DENY_WRITE_PROMPT = "[terax-e2e-pi-approval-denied]";
const APPROVED_FIXTURE_PATH = "e2e/.tmp/pi-approval-approved.txt";
const DENIED_FIXTURE_PATH = "e2e/.tmp/pi-approval-denied.txt";
const APPROVED_FIXTURE_CONTENT =
  "approved through Rust pi_agent_tool_execute\n";
const DENIED_FIXTURE_CONTENT = "denied should not be written\n";

/** Canned assistant reply; specs assert this text streamed into the transcript. */
export const MOCK_PI_REPLY =
  "Mock pi reply: hello from the offline e2e runtime.";

function textFromContent(
  content: Context["messages"][number]["content"],
): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

function lastUserText(context: Context): string {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message?.role === "user") return textFromContent(message.content);
  }
  return "";
}

function lastToolResultText(context: Context): string {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message?.role === "toolResult") {
      const content = message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n");
      const details = JSON.stringify(message.details ?? {});
      return `${content}\n${details}`;
    }
  }
  return "";
}

function firstMockPiResponse(context: Context) {
  const prompt = lastUserText(context);
  if (prompt.includes(APPROVE_WRITE_PROMPT)) {
    return fauxAssistantMessage(
      [
        fauxText("I need approval to write the e2e fixture."),
        fauxToolCall(
          "write_file",
          {
            path: APPROVED_FIXTURE_PATH,
            content: APPROVED_FIXTURE_CONTENT,
          },
          { id: "e2e-pi-write-approved" },
        ),
      ],
      { stopReason: "toolUse" },
    );
  }

  if (prompt.includes(DENY_WRITE_PROMPT)) {
    return fauxAssistantMessage(
      [
        fauxText("I need approval to write the e2e fixture."),
        fauxToolCall(
          "write_file",
          {
            path: DENIED_FIXTURE_PATH,
            content: DENIED_FIXTURE_CONTENT,
          },
          { id: "e2e-pi-write-denied" },
        ),
      ],
      { stopReason: "toolUse" },
    );
  }

  return fauxAssistantMessage(MOCK_PI_REPLY);
}

function followUpMockPiResponse(context: Context) {
  const toolResult = lastToolResultText(context);
  if (toolResult.includes("Tool execution denied by user")) {
    return fauxAssistantMessage("Mock pi tool follow-up: write denied.");
  }
  if (toolResult.includes(APPROVED_FIXTURE_PATH)) {
    return fauxAssistantMessage("Mock pi tool follow-up: write completed.");
  }
  return fauxAssistantMessage(MOCK_PI_REPLY);
}

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
    (context) => firstMockPiResponse(context),
    (context) => followUpMockPiResponse(context),
  ]);
  return registration.getModel() as Model<Api>;
}

/** Tear down the faux provider (tests / teardown). */
export function resetMockPiModel(): void {
  registration?.unregister();
  registration = null;
}
