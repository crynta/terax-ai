import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

type CapturedRequest = {
  url: string;
  body: Record<string, unknown>;
};

describe("Codex Responses model wiring", () => {
  it("uses the Responses endpoint and preserves tool schemas", async () => {
    const captured: { current?: CapturedRequest } = {};

    const fetchMock: typeof fetch = async (input, init) => {
      captured.current = {
        url: input instanceof URL ? input.toString() : String(input),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      };
      return new Response(
        JSON.stringify({ error: { message: "captured request" } }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const openai = createOpenAI({
      apiKey: "test",
      baseURL: "https://chatgpt.com/backend-api/codex",
      fetch: fetchMock,
    });
    const result = streamText({
      model: openai.responses("gpt-5.3-codex-spark"),
      messages: [{ role: "user", content: "read the file" }],
      providerOptions: {
        openai: {
          store: false,
          reasoningEffort: "medium",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
          instructions: "You are concise.",
        },
      },
      tools: {
        read_file: tool({
          description: "Read a file",
          inputSchema: z.object({ path: z.string() }),
        }),
      },
      onError: () => undefined,
    });

    await Promise.resolve(result.consumeStream()).catch(() => undefined);

    expect(captured.current).toBeDefined();
    const request = captured.current as CapturedRequest;
    expect(request.url).toBe(
      "https://chatgpt.com/backend-api/codex/responses",
    );
    expect(request.body.stream).toBe(true);
    expect(request.body.store).toBe(false);
    expect(request.body.instructions).toBe("You are concise.");
    expect(request.body.include).toEqual(["reasoning.encrypted_content"]);
    expect(request.body.reasoning).toEqual({
      effort: "medium",
      summary: "auto",
    });
    expect(JSON.stringify(request.body)).not.toContain("chat/completions");
    expect(request.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function",
          name: "read_file",
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              path: expect.objectContaining({ type: "string" }),
            }),
          }),
        }),
      ]),
    );
  });
});
