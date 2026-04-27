import { createOpenAI } from "@ai-sdk/openai";
import {
  Experimental_Agent as Agent,
  DirectChatTransport,
  stepCountIs,
} from "ai";
import { buildTools, type ToolContext } from "./tools";

export const DEFAULT_MODEL_ID = "gpt-5-mini";
const MAX_STEPS = 24;

const SYSTEM_PROMPT = `You are Terax, an AI assistant embedded in a developer terminal emulator.

You help the user understand command output, fix errors, navigate the codebase, and run shell commands. You have access to tools that read files, list directories, capture the active terminal's recent output, write files, create directories, and run shell commands.

Rules:
- Prefer reading the terminal context first when the user asks about something they just ran.
- Use absolute paths or paths relative to the active terminal's working directory.
- Tools that mutate the system (write_file, create_directory, run_command) require user approval. Briefly explain *why* you want to run each one before invoking it.
- Never invent file contents — read first, then act.
- If a read tool returns a "Refused" error for a sensitive file (.env, keys, credentials), do not retry; tell the user it is blocked and ask them to share the relevant info another way.
- Keep responses concise. Use Markdown for code blocks and lists.`;

type AgentDeps = {
  apiKey: string;
  toolContext: ToolContext;
};

export function createTeraxAgent({ apiKey, toolContext }: AgentDeps) {
  const openai = createOpenAI({ apiKey });
  return new Agent({
    model: openai(DEFAULT_MODEL_ID),
    instructions: SYSTEM_PROMPT,
    tools: buildTools(toolContext),
    stopWhen: stepCountIs(MAX_STEPS),
  });
}

export type TeraxAgent = ReturnType<typeof createTeraxAgent>;

export function createTeraxTransport(agent: TeraxAgent) {
  return new DirectChatTransport({ agent });
}
