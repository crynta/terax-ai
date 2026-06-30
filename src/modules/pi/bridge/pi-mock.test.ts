import { getApiProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureMockPiModel,
  MOCK_PI_API,
  MOCK_PI_MODEL_ID,
  MOCK_PI_REPLY,
  resetMockPiModel,
} from "./pi-mock";

afterEach(() => {
  resetMockPiModel();
});

describe("pi runtime mock", () => {
  it("registers a faux provider and returns the mock model", () => {
    const model = ensureMockPiModel();
    expect(model.api).toBe(MOCK_PI_API);
    expect(model.id).toBe(MOCK_PI_MODEL_ID);
    expect(getApiProvider(MOCK_PI_API)).toBeDefined();
  });

  it("streams the canned reply through the pi-ai event protocol", async () => {
    const model = ensureMockPiModel();
    const provider = getApiProvider(MOCK_PI_API);
    expect(provider).toBeDefined();

    const stream = provider?.stream(model, {
      messages: [{ role: "user", content: "hi", timestamp: 0 }],
    });
    if (!stream) throw new Error("no stream");

    let streamed = "";
    let sawStart = false;
    let sawDone = false;
    for await (const event of stream) {
      if (event.type === "start") sawStart = true;
      if (event.type === "text_delta") streamed += event.delta;
      if (event.type === "done") sawDone = true;
    }

    expect(sawStart).toBe(true);
    expect(sawDone).toBe(true);
    expect(streamed).toBe(MOCK_PI_REPLY);

    const result = await stream.result();
    const text = result.content
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join("");
    expect(text).toBe(MOCK_PI_REPLY);
    expect(result.stopReason).toBe("stop");
  });

  it("is idempotent across calls", () => {
    const first = ensureMockPiModel();
    const second = ensureMockPiModel();
    expect(second.api).toBe(first.api);
    expect(second.id).toBe(first.id);
  });
});
