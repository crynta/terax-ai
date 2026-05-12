import { LazyStore } from "@tauri-apps/plugin-store";

export type SavedTerminalCommand = {
  id: string;
  name: string;
  description: string;
  command: string;
  pinned?: boolean;
};

const STORE_PATH = "terax-terminal-commands.json";
const KEY_LIST = "commands";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function loadSavedTerminalCommands(): Promise<
  SavedTerminalCommand[]
> {
  return (await store.get<SavedTerminalCommand[]>(KEY_LIST)) ?? [];
}

export async function saveSavedTerminalCommands(
  list: SavedTerminalCommand[],
): Promise<void> {
  await store.set(KEY_LIST, list);
  await store.save();
}

export function newSavedTerminalCommandId(): string {
  return `tc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
