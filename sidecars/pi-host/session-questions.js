import {
  publishEvent,
  pushEvent,
  SESSION_EVENT,
} from "./session-events.js";

const QUESTION_LIMIT = 5;
const MAX_OPTIONS = 8;
const MAX_QUESTION_CHARS = 500;
const MAX_OPTION_LABEL_CHARS = 200;
const MAX_CUSTOM_ANSWER_CHARS = 1000;

export { QUESTION_LIMIT, MAX_OPTIONS, MAX_QUESTION_CHARS, MAX_OPTION_LABEL_CHARS, MAX_CUSTOM_ANSWER_CHARS };

function validateQuestion(question, index) {
  if (!question || typeof question !== "object") {
    return `questions[${index}] must be an object`;
  }
  if (
    typeof question.question !== "string" ||
    question.question.trim().length === 0
  ) {
    return `questions[${index}].question must be a non-empty string`;
  }
  if (question.question.length > MAX_QUESTION_CHARS) {
    return `questions[${index}].question must be at most ${MAX_QUESTION_CHARS} characters`;
  }
  if (!Array.isArray(question.options)) {
    return `questions[${index}].options must be an array`;
  }
  if (question.options.length === 0 || question.options.length > MAX_OPTIONS) {
    return `questions[${index}].options must have 1-${MAX_OPTIONS} items`;
  }
  for (let i = 0; i < question.options.length; i++) {
    const option = question.options[i];
    if (!option || typeof option !== "object") {
      return `questions[${index}].options[${i}] must be an object`;
    }
    if (
      typeof option.label !== "string" ||
      option.label.trim().length === 0
    ) {
      return `questions[${index}].options[${i}].label must be a non-empty string`;
    }
    if (option.label.length > MAX_OPTION_LABEL_CHARS) {
      return `questions[${index}].options[${i}].label must be at most ${MAX_OPTION_LABEL_CHARS} characters`;
    }
  }
  return null;
}

export function validateAskQuestionsParams(questions) {
  if (!Array.isArray(questions)) {
    return "questions must be an array";
  }
  if (questions.length === 0 || questions.length > QUESTION_LIMIT) {
    return `questions must have 1-${QUESTION_LIMIT} items`;
  }
  for (let i = 0; i < questions.length; i++) {
    const error = validateQuestion(questions[i], i);
    if (error !== null) {
      return error;
    }
  }
  return null;
}

export function expirePendingQuestion(session, createdAt) {
  if (!session.pendingQuestion) return [];
  const pending = session.pendingQuestion;
  session.pendingQuestion = null;
  pending.cleanup?.();
  pending.resolve(null);
  return [
    pushEvent(
      SESSION_EVENT.QuestionCancelled,
      session.id,
      { questionId: pending.id },
      createdAt,
    ),
  ];
}

export async function handleAskQuestionsTool(session, args, signal) {
  const validationError = validateAskQuestionsParams(args);
  if (validationError !== null) {
    return {
      content: [{ type: "text", text: `Validation error: ${validationError}` }],
      details: null,
      isError: true,
    };
  }

  if (session.pendingQuestion) {
    return {
      content: [
        {
          type: "text",
          text: "A question is already pending. Wait for the current answer.",
        },
      ],
      details: null,
      isError: true,
    };
  }

  const questionId = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const pending = {
    id: questionId,
    questions: args,
    runId: session.activeRunId,
    cleanup: undefined,
    resolve: undefined,
  };

  const promise = new Promise((resolve) => {
    pending.resolve = resolve;
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    const abort = () => {
      if (session.pendingQuestion === pending) {
        session.pendingQuestion = null;
      }
      resolve(null);
    };
    signal?.addEventListener("abort", abort, { once: true });
    pending.cleanup = () => signal?.removeEventListener("abort", abort);
    session.pendingQuestion = pending;
    publishEvent(SESSION_EVENT.QuestionRequested, session.id, {
      questionId,
      questions: args.map((q) => ({
        question: q.question,
        options: q.options.map((o) => ({ label: o.label })),
      })),
    });
  });

  const answers = await promise;

  if (answers === null) {
    return {
      content: [{ type: "text", text: "Question was cancelled or expired." }],
      details: null,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ questionId, answers }, null, 2),
      },
    ],
    details: null,
  };
}

export function resolvePendingQuestion(session, questionId, answers) {
  if (
    !session.pendingQuestion ||
    session.pendingQuestion.id !== questionId
  ) {
    return null;
  }
  const pending = session.pendingQuestion;
  session.pendingQuestion = null;
  pending.cleanup?.();
  pending.resolve(answers);
  return pushEvent(
    SESSION_EVENT.QuestionResponded,
    session.id,
    { questionId, answers },
  );
}
