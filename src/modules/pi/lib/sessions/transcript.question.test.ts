/**
 * Transcript rendering for interactive questions (ask_question tool).
 */
import { describe, expect, it } from "vitest";
import { buildPiSessionTranscript } from "./transcript";
import { PI_SESSION_EVENT, type PiSessionEvent } from "./types";

function ev(
  id: string,
  type: string,
  payload: Record<string, unknown>,
  createdAt: string,
): PiSessionEvent {
  return { id, type, sessionId: "s", createdAt, payload };
}

describe("buildPiSessionTranscript — questions", () => {
  it("renders an asked question as a pending question item", () => {
    const transcript = buildPiSessionTranscript([
      ev(
        "q1",
        PI_SESSION_EVENT.QuestionAsked,
        {
          questionId: "qid",
          question: "Which database?",
          options: [{ label: "Postgres" }, { label: "SQLite" }],
          allowMultiple: false,
        },
        "2026-01-01T00:00:01.000Z",
      ),
    ]);

    const item = transcript.find((i) => i.kind === "question");
    expect(item?.text).toBe("Which database?");
    expect(item?.questionId).toBe("qid");
    expect(item?.questionOptions).toEqual([
      { label: "Postgres" },
      { label: "SQLite" },
    ]);
    expect(item?.questionState).toBe("pending");
  });

  it("marks the question answered when the user responds", () => {
    const transcript = buildPiSessionTranscript([
      ev(
        "q1",
        PI_SESSION_EVENT.QuestionAsked,
        {
          questionId: "qid",
          question: "Which database?",
          options: [{ label: "Postgres" }],
        },
        "2026-01-01T00:00:01.000Z",
      ),
      ev(
        "r1",
        PI_SESSION_EVENT.QuestionResponded,
        { questionId: "qid", answers: [{ label: "Postgres" }] },
        "2026-01-01T00:00:02.000Z",
      ),
    ]);

    const item = transcript.find((i) => i.kind === "question");
    expect(item?.questionState).toBe("answered");
    expect(item?.questionAnswers).toEqual([{ label: "Postgres" }]);
  });

  it("cancels a still-pending question when the session stops", () => {
    const transcript = buildPiSessionTranscript([
      ev(
        "q1",
        PI_SESSION_EVENT.QuestionAsked,
        {
          questionId: "qid",
          question: "Which database?",
          options: [{ label: "Postgres" }],
        },
        "2026-01-01T00:00:01.000Z",
      ),
      ev(
        "s1",
        PI_SESSION_EVENT.Status,
        { status: "stopped" },
        "2026-01-01T00:00:02.000Z",
      ),
    ]);

    const item = transcript.find((i) => i.kind === "question");
    expect(item?.questionState).toBe("answered");
    expect(item?.questionAnswers).toEqual([]);
  });
});
