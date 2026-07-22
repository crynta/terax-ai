import { invoke } from "@tauri-apps/api/core";

export function historySuggest(line: string): Promise<string | null> {
  return invoke<string | null>("history_suggest", { line }).catch(() => null);
}

export function historyCommands(prefix: string, limit = 50): Promise<string[]> {
  return invoke<string[]>("history_commands", { prefix, limit }).catch(() => []);
}

export function historyList(query: string, limit = 200): Promise<string[]> {
  return invoke<string[]>("history_list", { query, limit }).catch(() => []);
}

export interface HistoryEntry {
  id: number;
  command: string;
  timestamp: number;
  exit_code: number | null;
  session_id: string;
}

export function historyClear(): Promise<void> {
  return invoke<void>("history_clear").catch(() => {});
}

export function historyDelete(id: number): Promise<void> {
  return invoke<void>("history_delete", { id }).catch(() => {});
}

export function historyListFull(
  query: string,
  limit?: number,
  offset?: number,
): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("history_list_full", { query, limit, offset }).catch(() => []);
}

export function historyRecord(
  command: string,
  exitCode?: number | null,
  sessionId?: string,
  maxEntries?: number,
): void {
  void invoke("history_record", {
    command,
    exitCode: exitCode ?? null,
    sessionId: sessionId ?? null,
    maxEntries: maxEntries ?? null,
  }).catch(() => {});
}

