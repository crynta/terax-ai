/**
 * Tests for the interactive-question registry + answer formatting.
 *
 * The webview Pi agent can ask the user a structured multiple-choice question
 * via the `ask_question` tool, which blocks until the user answers. This
 * registry holds the pending question's resolver (mirroring the approval
 * registry); tearing the session down cancels it.
 */
import { describe, expect, it, vi } from "vitest";
import {
  formatQuestionAnswers,
  PendingQuestionRegistry,
} from "./question-registry";

describe("PendingQuestionRegistry", () => {
  it("resolves a registered question with the user's answers", () => {
    const registry = new PendingQuestionRegistry();
    const resolve = vi.fn();
    registry.add("s1", "q1", resolve);

    const handled = registry.respond("s1", "q1", [{ label: "Yes" }]);

    expect(handled).toBe(true);
    expect(resolve).toHaveBeenCalledWith([{ label: "Yes" }]);
    expect(registry.respond("s1", "q1", [{ label: "No" }])).toBe(false);
  });

  it("cancels a session's pending questions with empty answers", () => {
    const registry = new PendingQuestionRegistry();
    const a = vi.fn();
    const other = vi.fn();
    registry.add("s1", "q1", a);
    registry.add("s2", "q2", other);

    registry.clearForSession("s1");

    expect(a).toHaveBeenCalledWith([]);
    expect(other).not.toHaveBeenCalled();
    expect(registry.respond("s1", "q1", [{ label: "x" }])).toBe(false);
    expect(registry.respond("s2", "q2", [{ label: "x" }])).toBe(true);
  });
});

describe("formatQuestionAnswers", () => {
  it("renders a single label", () => {
    expect(formatQuestionAnswers([{ label: "Yes" }])).toBe("Yes");
  });

  it("includes custom text for free-form answers", () => {
    expect(
      formatQuestionAnswers([{ label: "Other", customText: "use Postgres" }]),
    ).toBe("Other: use Postgres");
  });

  it("joins multiple selections", () => {
    expect(formatQuestionAnswers([{ label: "A" }, { label: "B" }])).toBe(
      "A, B",
    );
  });

  it("describes an empty/cancelled answer", () => {
    expect(formatQuestionAnswers([])).toBe(
      "The user did not answer the question.",
    );
  });
});
