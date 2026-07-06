import {
  type AutocompleteProviderId,
  DEFAULT_AUTOCOMPLETE_MODEL,
  LMSTUDIO_DEFAULT_BASE_URL,
} from "@/modules/ai/config";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { generateText } from "ai";
import {
  buildUserPrompt,
  COMPLETION_SYSTEM_PROMPT,
  type CompletionRequest,
} from "./prompt";

export type CompletionDeps = {
  provider: AutocompleteProviderId;
  modelId: string;
  apiKey: string | null;
  lmstudioBaseURL: string;
  mlxBaseURL?: string;
  ollamaBaseURL?: string;
  openaiCompatibleBaseURL?: string;
};

const MAX_OUTPUT_TOKENS_DEFAULT = 128;
// Reasoning models burn output tokens on internal thought before producing
// any visible content; with a tight cap they finish_reason="length" with
// empty text. The trim step still caps visible output at MAX_LINES.
const MAX_OUTPUT_TOKENS_REASONING = 1024;

/** Resolves the configured autocomplete model, shared by every request kind. */
async function buildAutocompleteModel(deps: CompletionDeps) {
  const modelId =
    deps.modelId.trim() || DEFAULT_AUTOCOMPLETE_MODEL[deps.provider] || "";
  if (!modelId) {
    throw new Error(`No autocomplete model id set for ${deps.provider}.`);
  }
  const keys = { ...EMPTY_PROVIDER_KEYS, [deps.provider]: deps.apiKey };
  const model = await buildLanguageModel(deps.provider, keys, modelId, {
    lmstudioBaseURL: deps.lmstudioBaseURL || LMSTUDIO_DEFAULT_BASE_URL,
    mlxBaseURL: deps.mlxBaseURL,
    ollamaBaseURL: deps.ollamaBaseURL,
    openaiCompatibleBaseURL: deps.openaiCompatibleBaseURL,
  });
  return { model, modelId };
}

export async function requestCompletion(
  req: CompletionRequest,
  deps: CompletionDeps,
  signal: AbortSignal,
): Promise<string> {
  const { model, modelId } = await buildAutocompleteModel(deps);

  const isReasoning = /\bgpt-oss\b/i.test(modelId);
  const providerOptions = isReasoning
    ? {
        cerebras: { reasoningEffort: "low" },
        groq: { reasoningEffort: "low" },
        openai: { reasoningEffort: "low" },
      }
    : undefined;

  const { text } = await generateText({
    model,
    system: COMPLETION_SYSTEM_PROMPT,
    prompt: buildUserPrompt(req),
    maxOutputTokens: isReasoning
      ? MAX_OUTPUT_TOKENS_REASONING
      : MAX_OUTPUT_TOKENS_DEFAULT,
    maxRetries: 0,
    abortSignal: signal,
    temperature: 0.2,
    ...(providerOptions ? { providerOptions } : {}),
  });

  return cleanCompletion(text);
}

function cleanCompletion(raw: string): string {
  let t = raw;
  const fence = t.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```\s*$/);
  if (fence) t = fence[1];
  t = t.replace(/^<\|cursor\|>/, "");
  return t;
}

// ── Terminal (blocks prompt) requests ──────────────────────────────────────

const SHELL_SUGGEST_SYSTEM = `You complete or correct a shell command line.

You get the partially typed COMMAND plus context (cwd, recent commands). Output 1-3 candidate FULL command lines the user likely intends, one per line, most likely first.

Hard rules:
1. Valid start → extend it: candidates must begin with the typed text verbatim.
2. Obvious typo or wrong flag → corrected full commands instead.
3. Each candidate is one runnable line — a command, not a script.
4. Prefer patterns from RECENT commands and paths plausible for CWD.
5. Output nothing when no confident prediction exists.
6. Raw text only: no numbering, no quotes, no commentary, no markdown.

Examples:
COMMAND: "git chec"
git checkout main
git checkout -b

COMMAND: "sudo atp install ffmpeg"
sudo apt install ffmpeg

COMMAND: "ffmpeg"
ffmpeg -i input.mp4 output.mp4
ffmpeg -i input.mp4 -vn -acodec copy audio.aac`;

const NL_COMMAND_SYSTEM = `You translate a natural-language task into shell commands.

The user typed a comment line in their terminal: "# <task>". Output 1-3 candidate commands that accomplish the task, one per line, best first.

Hard rules:
1. Each candidate is one directly runnable line. Prefer widely available tools; match RECENT commands and CWD when relevant.
2. Raw text only: no numbering, no comments, no markdown, no explanations, no leading "$".
3. If the task is unclear or needs multiple steps, output nothing.

Examples:
TASK: "скачай видео с ютуба в mp3"  → "yt-dlp -x --audio-format mp3 <url>"
TASK: "find biggest files here"     → "du -ah . | sort -rh | head -20"
TASK: "kill whatever is on port 3000" → "lsof -ti:3000 | xargs kill -9"`;

export type ShellSuggestRequest = {
  line: string;
  cwd: string | null;
  recent: readonly string[];
};

/** Up to 3 predicted full command lines — extensions of the typed text or
 *  corrected versions of it (empty when the model passes). */
export async function requestShellSuggestion(
  req: ShellSuggestRequest,
  deps: CompletionDeps,
  signal: AbortSignal,
): Promise<string[]> {
  const { model } = await buildAutocompleteModel(deps);
  const recent = req.recent.slice(0, 15).join("\n");
  const ctx = `${req.cwd ? `CWD: ${req.cwd}\n` : ""}${
    recent ? `RECENT:\n${recent}\n` : ""
  }`;
  // "# <task>" switches from completion to natural-language translation.
  const nl = req.line.match(/^\s*#\s*(\S.*)$/);
  const prompt = nl
    ? `${ctx}
TASK:
<<<
${nl[1]}
>>>

Output the candidate commands, one per line.`
    : `${ctx}
COMMAND:
<<<
${req.line}
>>>

Output the candidate full command lines, one per line.`;
  const { text } = await generateText({
    model,
    system: nl ? NL_COMMAND_SYSTEM : SHELL_SUGGEST_SYSTEM,
    prompt,
    maxOutputTokens: nl ? 300 : 160,
    maxRetries: 0,
    abortSignal: signal,
    temperature: 0.2,
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of cleanCompletion(text).split("\n")) {
    const cand = raw.trim().replace(/^\$\s+/, "");
    if (!cand || seen.has(cand)) continue;
    seen.add(cand);
    out.push(cand);
    if (out.length >= 3) break;
  }
  return out;
}

const SHELL_FIX_SYSTEM = `A shell command failed. Propose the corrected command.

Hard rules:
1. Output ONLY the corrected single-line command — no commentary, no markdown fences, no leading "$".
2. Keep the user's intent; fix typos, flags, paths, quoting or obvious misuse shown by the error output.
3. If the failure isn't fixable by editing the command (missing package, no network), output the most useful next command instead (e.g. the install command).`;

export type ShellFixRequest = {
  command: string;
  output: string;
  exitCode: number | null;
  cwd: string | null;
};

/** A corrected command for a failed block ("" when nothing sensible). */
export async function requestCommandFix(
  req: ShellFixRequest,
  deps: CompletionDeps,
  signal: AbortSignal,
): Promise<string> {
  const { model } = await buildAutocompleteModel(deps);
  const output =
    req.output.length > 1500 ? req.output.slice(-1500) : req.output;
  const prompt = `${req.cwd ? `CWD: ${req.cwd}\n` : ""}COMMAND: ${req.command}
EXIT CODE: ${req.exitCode ?? "unknown"}
OUTPUT:
<<<
${output}
>>>

Output the corrected command.`;
  const { text } = await generateText({
    model,
    system: SHELL_FIX_SYSTEM,
    prompt,
    maxOutputTokens: 200,
    maxRetries: 0,
    abortSignal: signal,
    temperature: 0.2,
  });
  return firstLine(cleanCompletion(text)).replace(/^\$\s+/, "");
}

function firstLine(raw: string): string {
  return raw.trim().split("\n")[0]?.trim() ?? "";
}
