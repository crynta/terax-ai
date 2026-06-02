import type { UIMessage, UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import {
  filterReasoningForIssuer,
  responsesIssuerForProvider,
  tagReasoningChunkIssuer,
} from "./reasoningIssuer";

function assistantMessage(parts: UIMessage["parts"]): UIMessage {
  return {
    id: "m1",
    role: "assistant",
    parts,
  };
}

describe("responses reasoning issuer", () => {
  it("maps OpenAI API and ChatGPT Codex to separate issuers", () => {
    expect(responsesIssuerForProvider("openai")).toBe("openai_api");
    expect(responsesIssuerForProvider("openai-codex")).toBe("codex_backend");
    expect(responsesIssuerForProvider("anthropic")).toBeNull();
  });

  it("tags streamed reasoning chunks with a Terax issuer", () => {
    const chunk = tagReasoningChunkIssuer(
      {
        type: "reasoning-start",
        id: "rs_1",
        providerMetadata: {
          openai: {
            itemId: "rs_1",
            reasoningEncryptedContent: "encrypted",
          },
        },
      } satisfies UIMessageChunk,
      "codex_backend",
    );

    expect(chunk.providerMetadata).toEqual({
      openai: {
        itemId: "rs_1",
        reasoningEncryptedContent: "encrypted",
      },
      terax: {
        responsesIssuer: "codex_backend",
      },
    });
  });

  it("keeps only same-issuer Codex reasoning", () => {
    const [message] = filterReasoningForIssuer(
      [
        assistantMessage([
          {
            type: "reasoning",
            text: "codex",
            providerMetadata: {
              terax: { responsesIssuer: "codex_backend" },
            },
          },
          {
            type: "reasoning",
            text: "openai",
            providerMetadata: {
              terax: { responsesIssuer: "openai_api" },
            },
          },
          {
            type: "reasoning",
            text: "legacy",
          },
          {
            type: "text",
            text: "visible",
          },
        ]),
      ],
      "codex_backend",
    );

    expect(message.parts).toEqual([
      {
        type: "reasoning",
        text: "codex",
        providerMetadata: {
          terax: { responsesIssuer: "codex_backend" },
        },
      },
      {
        type: "text",
        text: "visible",
      },
    ]);
  });

  it("keeps legacy untagged OpenAI reasoning but drops Codex reasoning", () => {
    const [message] = filterReasoningForIssuer(
      [
        assistantMessage([
          {
            type: "reasoning",
            text: "legacy openai",
          },
          {
            type: "reasoning",
            text: "codex",
            providerMetadata: {
              terax: { responsesIssuer: "codex_backend" },
            },
          },
          {
            type: "reasoning",
            text: "openai",
            providerMetadata: {
              terax: { responsesIssuer: "openai_api" },
            },
          },
        ]),
      ],
      "openai_api",
    );

    expect(message.parts).toEqual([
      {
        type: "reasoning",
        text: "legacy openai",
      },
      {
        type: "reasoning",
        text: "openai",
        providerMetadata: {
          terax: { responsesIssuer: "openai_api" },
        },
      },
    ]);
  });
});
