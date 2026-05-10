import { emit, listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  loadSavedTerminalCommands,
  newSavedTerminalCommandId,
  saveSavedTerminalCommands,
  type SavedTerminalCommand,
} from "../lib/savedCommands";

const CHANGED_EVENT = "terax://saved-terminal-commands-changed";

type State = {
  hydrated: boolean;
  commands: SavedTerminalCommand[];
  hydrate: () => Promise<void>;
  upsert: (command: SavedTerminalCommand) => void;
  remove: (id: string) => void;
};

let initialized = false;

export const useSavedTerminalCommandsStore = create<State>((set, get) => ({
  hydrated: false,
  commands: [],
  hydrate: async () => {
    if (initialized) return;
    initialized = true;
    set({ commands: await loadSavedTerminalCommands(), hydrated: true });
    void listen(CHANGED_EVENT, async () => {
      set({ commands: await loadSavedTerminalCommands() });
    });
  },
  upsert: (command) => {
    const list = get().commands;
    const idx = list.findIndex((c) => c.id === command.id);
    const next =
      idx === -1
        ? [...list, command]
        : list.map((c) => (c.id === command.id ? command : c));
    set({ commands: next });
    void saveSavedTerminalCommands(next).then(() => emit(CHANGED_EVENT));
  },
  remove: (id) => {
    const next = get().commands.filter((c) => c.id !== id);
    set({ commands: next });
    void saveSavedTerminalCommands(next).then(() => emit(CHANGED_EVENT));
  },
}));

export { newSavedTerminalCommandId };
