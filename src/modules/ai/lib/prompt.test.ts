import { streamText, type ModelMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { prepareAgentPrompt } from "./prompt";

const history: ModelMessage[] = [
  { role: "user", content: "Fix the issue" },
  { role: "assistant", content: "I will inspect it." },
];

describe("prepareAgentPrompt", () => {
  it("keeps trusted instructions outside conversation messages", () => {
    const prompt = prepareAgentPrompt(
      "Stable instructions",
      "Plan instructions",
      history,
      "openai",
    );

    expect(prompt.system).toEqual([
      { role: "system", content: "Stable instructions" },
      { role: "system", content: "Plan instructions" },
    ]);
    expect(prompt.messages).toEqual(history);
    expect(prompt.messages.every((message) => message.role !== "system")).toBe(
      true,
    );
  });

  it("keeps Anthropic cache markers on the stable prefix and rotating tail", () => {
    const prompt = prepareAgentPrompt(
      "Stable instructions",
      "Plan instructions",
      history,
      "anthropic",
    );

    expect(prompt.system[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    expect(prompt.system[1].providerOptions).toBeUndefined();
    expect(prompt.messages[0].providerOptions).toBeUndefined();
    expect(prompt.messages[1].providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    expect(history.every((message) => message.providerOptions == null)).toBe(
      true,
    );
  });

  it("does not trigger the SDK system-message warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = new MockLanguageModelV3({
      doStream: {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.close();
          },
        }),
      },
    });
    const prompt = prepareAgentPrompt(
      "Stable instructions",
      "Plan instructions",
      history,
      "openai",
    );

    try {
      const result = streamText({
        model,
        system: prompt.system,
        messages: prompt.messages,
        allowSystemInMessages: false,
        onError: () => {},
      });
      await result.consumeStream();
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining("System messages in the prompt"),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
