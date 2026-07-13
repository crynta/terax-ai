import { invoke } from "@tauri-apps/api/core";

export type SettingsTab =
  | "general"
  | "editor"
  | "lsp"
  | "interface"
  | "explorer"
  | "terminal"
  | "assist"
  | "shelltools"
  | "themes"
  | "shortcuts"
  | "models"
  | "agents"
  | "about";

export async function openSettingsWindow(tab?: SettingsTab): Promise<void> {
  await invoke("open_settings_window", { tab: tab ?? null });
}
