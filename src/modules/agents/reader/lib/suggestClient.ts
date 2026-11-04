import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  BUILTIN_COMMANDS,
  type CommandSource,
  type SlashCommand,
} from "./slashCommands";

/** The custom-command list is re-read when the popup opens after this long. */
const COMMANDS_TTL_MS = 60_000;

type CommandsEntry = { commands: SlashCommand[]; at: number };
const commandCache = new Map<string, CommandsEntry>();
const commandInflight = new Map<string, Promise<SlashCommand[]>>();

/**
 * Built-in plus custom commands for `cwd` (user, project, plugin and skill
 * commands, read from disk by the backend), cached per folder.
 */
export function listCommands(cwd: string | null): Promise<SlashCommand[]> {
  const key = cwd ?? "";
  const cached = commandCache.get(key);
  if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) {
    return Promise.resolve(cached.commands);
  }
  const pending = commandInflight.get(key);
  if (pending) return pending;
  const load = invoke<{ name: string; description: string; source: string }[]>(
    "agent_list_commands",
    { cwd: key },
  )
    .then((custom) => {
      const builtin = new Set(BUILTIN_COMMANDS.map((c) => c.name));
      const commands = [
        ...BUILTIN_COMMANDS,
        ...custom
          .filter((c) => !builtin.has(c.name))
          .map((c) => ({ ...c, source: c.source as CommandSource })),
      ];
      commandCache.set(key, { commands, at: Date.now() });
      return commands;
    })
    .catch(() => cached?.commands ?? [...BUILTIN_COMMANDS])
    .finally(() => commandInflight.delete(key));
  commandInflight.set(key, load);
  return load;
}

/** The last cached list for `cwd`, so the popup can show results instantly. */
export function cachedCommands(cwd: string | null): SlashCommand[] {
  return commandCache.get(cwd ?? "")?.commands ?? [...BUILTIN_COMMANDS];
}

export type FileSuggestion = { rel: string; isDir: boolean };

type SearchResult = {
  hits: { path: string; rel: string; name: string; is_dir: boolean }[];
  truncated: boolean;
  cancelled?: boolean;
};

/**
 * Files and folders under `cwd` matching `query`, ranked by the backend's
 * file index (which honours .gitignore); a newer query supersedes this one.
 */
export async function searchFiles(
  cwd: string,
  query: string,
  limit = 40,
): Promise<FileSuggestion[] | null> {
  const res = await invoke<SearchResult>("fs_search", {
    root: cwd,
    query,
    limit,
    showHidden: false,
    requestKey: "reader-mention",
    workspace: currentWorkspaceEnv(),
  });
  if (res.cancelled) return null;
  return res.hits.map((hit) => ({ rel: hit.rel, isDir: hit.is_dir }));
}
