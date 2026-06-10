/**
 * Registry of in-flight interactive questions for the webview Pi agent.
 *
 * The agent asks a structured multiple-choice question via the `ask_question`
 * tool, whose execution blocks on the user's answer. This registry holds the
 * pending resolver (mirroring {@link PendingApprovalRegistry}); the user's
 * response resolves it, and session teardown cancels it with empty answers.
 */
import type { PiQuestionAnswer } from "./sessions";

export type QuestionResolver = (answers: PiQuestionAnswer[]) => void;

export class PendingQuestionRegistry {
  private readonly pending = new Map<string, QuestionResolver>();

  private key(sessionId: string, questionId: string): string {
    return `${sessionId}:${questionId}`;
  }

  add(sessionId: string, questionId: string, resolve: QuestionResolver): void {
    this.pending.set(this.key(sessionId, questionId), resolve);
  }

  /** Resolve a pending question. Returns false if none was pending. */
  respond(
    sessionId: string,
    questionId: string,
    answers: PiQuestionAnswer[],
  ): boolean {
    const key = this.key(sessionId, questionId);
    const resolve = this.pending.get(key);
    if (!resolve) return false;
    this.pending.delete(key);
    resolve(answers);
    return true;
  }

  /** Cancel every pending question for a session (empty answers). */
  clearForSession(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const [key, resolve] of this.pending) {
      if (key.startsWith(prefix)) {
        this.pending.delete(key);
        resolve([]);
      }
    }
  }
}

/** Render the user's answer(s) as the text the model receives. */
export function formatQuestionAnswers(answers: PiQuestionAnswer[]): string {
  if (answers.length === 0) {
    return "The user did not answer the question.";
  }
  return answers
    .map((answer) =>
      answer.customText
        ? `${answer.label}: ${answer.customText}`
        : answer.label,
    )
    .join(", ");
}
