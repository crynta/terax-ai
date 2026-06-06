import type {
  WorkflowAgentExecutor,
  WorkflowBrowserAutomationExecutor,
} from "./execution";
import { tauriWorkflowPiAgentExecutor } from "./nativeAgentExecution";

export function createWorkflowBrowserAutomationExecutor(
  executeAgent: WorkflowAgentExecutor,
): WorkflowBrowserAutomationExecutor {
  return async ({
    document,
    node,
    url,
    instructions,
    signal,
    reportOutput,
  }) => {
    const output = await executeAgent({
      document,
      node,
      prompt: browserAutomationPrompt({ url, instructions }),
      signal,
      reportOutput,
    });
    return {
      text: output.text,
      ...(output.sessionId !== undefined
        ? { sessionId: output.sessionId }
        : {}),
      ...(output.eventIds !== undefined ? { eventIds: output.eventIds } : {}),
    };
  };
}

export const tauriWorkflowBrowserAutomationExecutor =
  createWorkflowBrowserAutomationExecutor(tauriWorkflowPiAgentExecutor);

function browserAutomationPrompt(input: {
  url: string;
  instructions: string;
}): string {
  return [
    "Browser automation workflow node.",
    "Use available browser/navigation tools if this runtime exposes them.",
    "Do not perform destructive actions unless the instruction explicitly requires it.",
    input.url ? `Start URL: ${input.url}` : "Start URL: not specified",
    "Instructions:",
    input.instructions,
    "Return a concise result summary and any extracted data.",
  ].join("\n");
}
