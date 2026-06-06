import { describe, expect, it } from "vitest";
import { executeWorkflowStep, executeWorkflowStepAsync } from "./execution";
import { classifyWorkflowProviderError } from "./providerErrors";
import { createStarterWorkflowDocument } from "./schema";

describe("workflow provider error classification", () => {
  it("classifies common provider failures", () => {
    expect(
      classifyWorkflowProviderError(new Error("HTTP 429 quota exceeded")),
    ).toEqual({
      code: "quota",
      message: "Provider quota or rate limit exceeded",
      retryable: true,
    });
    expect(classifyWorkflowProviderError(new Error("Invalid API key"))).toEqual(
      {
        code: "auth",
        message: "Provider authentication failed",
        retryable: false,
      },
    );
    expect(
      classifyWorkflowProviderError(new Error("request timed out")),
    ).toEqual({
      code: "timeout",
      message: "Provider request timed out",
      retryable: true,
    });
    expect(
      classifyWorkflowProviderError(new Error("provider unavailable")),
    ).toEqual({
      code: "unknown",
      message: "provider unavailable",
      retryable: true,
    });
  });

  it("classifies aborts separately from provider failures", () => {
    const controller = new AbortController();
    controller.abort();

    expect(
      classifyWorkflowProviderError(
        new Error("provider cancelled"),
        controller.signal,
      ),
    ).toEqual({
      code: "cancelled",
      message: "Execution cancelled",
      retryable: false,
    });
  });

  it("stores classified provider failure metadata on failed runtime state", async () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({
        id: "wf_provider_error",
        title: "Errors",
      }),
    );

    const finished = await executeWorkflowStepAsync(document, {
      now: () => "2026-06-05T00:00:00.000Z",
      createProviderArtifact: async () => {
        throw new Error("HTTP 429 quota exceeded");
      },
    });

    expect(
      finished.nodes.find((node) => node.id === "node_image"),
    ).toMatchObject({
      runtimeState: {
        status: "failed",
        message: "Provider quota or rate limit exceeded",
        errorCode: "quota",
        logs: expect.arrayContaining([
          {
            event: "failed",
            at: "2026-06-05T00:00:00.000Z",
            message: "Provider quota or rate limit exceeded",
          },
        ]),
      },
    });
  });
});
