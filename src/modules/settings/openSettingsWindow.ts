import { invoke } from "@tauri-apps/api/core";

export type SettingsTab =
  | "general"
  | "shortcuts"
  | "models"
  | "agents"
  | "external-agents"
  | "about";

export async function openSettingsWindow(tab?: SettingsTab): Promise<void> {
  await invoke("open_settings_window", { tab: tab ?? null });
}
