import { createUIMessageStream, type UIMessage } from "ai";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { allocateSpawnId, killCliAgent, runCliAgent } from "./bridge";
import { ChunkEmitter } from "./parsers/emitter";
import { CLI_AGENTS } from "./registry";
import type { CliAgentId, CliPermissionMode } from "./types";

export type RunCliAgentOptions = {
  cliId: CliAgentId;
  uiMessages: UIMessage[];
  cwd: string | null;
  model?: string;
  permission?: CliPermissionMode;
  abortSignal?: AbortSignal;
  onStep?: (step: string | null) => void;
};

/**
 * Drive a wrapped CLI agent and expose it as the same `{ toUIMessageStream }`
 * shape `runAgentStream` returns, so the chat transport is agnostic to whether
 * the turn was served by an API model or a local CLI. The CLI runs its own
 * tool loop end-to-end; we only relay its event stream into the chat UI.
 */
export function runCliAgentStream(opts: RunCliAgentOptions) {
  const def = CLI_AGENTS[opts.cliId];
  const prompt = messagesToPrompt(opts.uiMessages);

  return {
    toUIMessageStream: (_o?: { originalMessages?: UIMessage[] }) =>
      createUIMessageStream({
        execute: async ({ writer }) => {
          const emitter = new ChunkEmitter(writer);
          const parser = def.createParser(emitter);
          const id = allocateSpawnId();
          const onAbort = () => void killCliAgent(id);
          opts.abortSignal?.addEventListener("abort", onAbort, { once: true });
          opts.onStep?.(`Running ${def.label}`);
          try {
            const permission =
              opts.permission ??
              usePreferencesStore.getState().cliAgentPermission;
            const argv = def.buildArgv(prompt, { model: opts.model, permission });
            await runCliAgent(
              { id, argv, cwd: opts.cwd },
              {
                onStdout: (line) => parser.onLine(line),
                onStderr: (line) => parser.onStderr?.(line),
              },
            );
          } catch (e) {
            emitter.error(e instanceof Error ? e.message : String(e));
          } finally {
            opts.abortSignal?.removeEventListener("abort", onAbort);
            parser.onExit?.(null);
            emitter.finish();
            opts.onStep?.(null);
          }
        },
        onError: (e) => (e instanceof Error ? e.message : String(e)),
      }),
  };
}

/** Flatten the chat history into a single prompt. CLIs take one prompt per
 *  run and manage their own context, so we hand them a readable transcript. */
function messagesToPrompt(messages: UIMessage[]): string {
  const turns = messages
    .map((m) => ({
      role: m.role,
      text: (m.parts ?? [])
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("")
        .trim(),
    }))
    .filter((t) => t.text);

  if (turns.length === 0) return "";
  if (turns.length === 1) return turns[0].text;

  const last = turns[turns.length - 1];
  const history = turns
    .slice(0, -1)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
    .join("\n\n");
  return `Conversation so far:\n${history}\n\nCurrent request:\n${last.text}`;
}
