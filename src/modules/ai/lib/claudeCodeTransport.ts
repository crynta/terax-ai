// Chat transport backed by locally installed agent CLIs (Claude Code, Codex).
//
// One turn = one non-interactive CLI run (`claude -p` / `codex exec`) in its
// JSON-stream mode, spawned by the Rust side (cli_agent_run); stdout lines
// arrive as Tauri events and are converted into the AI SDK's UIMessageChunk
// protocol. Multi-turn context lives in the CLI itself: the first run's
// session/thread id is remembered per Terax chat session and later turns
// resume it.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UIMessage, UIMessageChunk } from "ai";

export type CliAgentKind = "claude" | "codex";

const MODEL_TO_KIND: Record<string, CliAgentKind> = {
  "claude-code-local": "claude",
  "codex-local": "codex",
};

const KIND_LABEL: Record<CliAgentKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

export function cliAgentKind(modelId: string): CliAgentKind | null {
  return MODEL_TO_KIND[modelId] ?? null;
}

/** `${kind}:${terax session id}` → CLI session/thread id (per app run). */
const cliSessions = new Map<string, string>();

type RunEvent =
  | { kind: "line"; line: string }
  | { kind: "done"; code: number; stderr: string };

type ContentBlock = {
  type: string;
  text?: string;
  name?: string;
};

/** Last user message, flattened to plain text for the CLI prompt. */
export function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    return m.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export type CliAgentRunArgs = {
  kind: CliAgentKind;
  messages: UIMessage[];
  sessionKey: string;
  cwd: string | null;
  abortSignal?: AbortSignal;
  onStep?: (step: string | null) => void;
};

type LineSink = {
  pushText: (text: string) => void;
  step: (label: string) => void;
  captureSession: (id: unknown) => void;
  finish: (error?: string) => void;
};

/** `claude -p --output-format stream-json` events. */
function handleClaudeLine(evt: Record<string, unknown>, sink: LineSink): void {
  sink.captureSession(evt.session_id);
  const type = evt.type as string;
  if (type === "assistant") {
    const msg = evt.message as { content?: ContentBlock[] } | undefined;
    for (const block of msg?.content ?? []) {
      if (block.type === "text" && block.text) {
        sink.pushText(block.text);
      } else if (block.type === "tool_use") {
        sink.step(`Claude Code: ${block.name ?? "tool"}…`);
      }
    }
  } else if (type === "result") {
    sink.finish(
      evt.is_error === true
        ? String(evt.result ?? "Claude Code returned an error.")
        : undefined,
    );
  }
}

/** `codex exec --json` thread-item events. */
function handleCodexLine(evt: Record<string, unknown>, sink: LineSink): void {
  sink.captureSession(evt.thread_id ?? evt.session_id);
  const type = evt.type as string;
  const item = evt.item as
    | { type?: string; text?: string; command?: string }
    | undefined;

  if (type === "item.completed" && item?.type === "agent_message" && item.text) {
    sink.pushText(item.text);
  } else if (type === "item.started" || type === "item.updated") {
    if (item?.type === "command_execution" && item.command) {
      sink.step(`Codex: $ ${item.command}`);
    } else if (item?.type === "file_change") {
      sink.step("Codex: editing files…");
    } else if (item?.type === "reasoning") {
      sink.step("Codex: thinking…");
    } else if (item?.type === "web_search") {
      sink.step("Codex: searching the web…");
    }
  } else if (type === "turn.completed") {
    sink.finish();
  } else if (type === "turn.failed" || type === "error") {
    const err = evt.error as { message?: string } | undefined;
    sink.finish(
      err?.message ??
        (typeof evt.message === "string" ? evt.message : "Codex failed."),
    );
  }
}

export async function runCliAgentStream(
  args: CliAgentRunArgs,
): Promise<ReadableStream<UIMessageChunk>> {
  const prompt = lastUserText(args.messages);
  const label = KIND_LABEL[args.kind];
  if (!prompt.trim()) throw new Error(`Nothing to send to ${label}.`);

  const runId = crypto.randomUUID();
  const eventName = `terax-cc-${runId}`;
  const sessionKey = `${args.kind}:${args.sessionKey}`;
  let textSeq = 0;

  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      let finished = false;
      let sawText = false;

      const sink: LineSink = {
        pushText: (text) => {
          const id = `cli-${textSeq++}`;
          controller.enqueue({ type: "text-start", id });
          controller.enqueue({
            type: "text-delta",
            id,
            delta: sawText ? `\n\n${text}` : text,
          });
          controller.enqueue({ type: "text-end", id });
          sawText = true;
          args.onStep?.(null);
        },
        step: (label_) => args.onStep?.(label_),
        captureSession: (id) => {
          if (typeof id === "string" && id) cliSessions.set(sessionKey, id);
        },
        finish: (error) => {
          if (finished) return;
          finished = true;
          if (error) controller.enqueue({ type: "error", errorText: error });
          controller.enqueue({ type: "finish" });
          controller.close();
          args.onStep?.(null);
          void unlistenPromise.then((fn) => fn());
        },
      };

      const handleLine = (line: string) => {
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(line);
        } catch {
          return; // non-JSON noise on stdout
        }
        if (args.kind === "claude") handleClaudeLine(evt, sink);
        else handleCodexLine(evt, sink);
      };

      const unlistenPromise = listen<RunEvent>(eventName, (e) => {
        const payload = e.payload;
        if (payload.kind === "line") {
          handleLine(payload.line);
        } else if (payload.kind === "done") {
          if (payload.code !== 0 && !finished) {
            sink.finish(
              payload.stderr.trim() ||
                `${label} exited with code ${payload.code}.`,
            );
          } else {
            sink.finish();
          }
        }
      });
      await unlistenPromise;

      args.abortSignal?.addEventListener("abort", () => {
        void invoke("cli_agent_kill", { runId });
        sink.finish();
      });

      controller.enqueue({ type: "start" });
      args.onStep?.(`${label}: starting…`);

      try {
        await invoke("cli_agent_run", {
          agent: args.kind,
          runId,
          prompt,
          sessionId: cliSessions.get(sessionKey) ?? null,
          cwd: args.cwd,
        });
      } catch (e) {
        sink.finish(e instanceof Error ? e.message : String(e));
      }
    },
  });
}
