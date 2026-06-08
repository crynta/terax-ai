import { invoke } from "@tauri-apps/api/core";
import type { SettingsSection } from "./types";

export type SettingsTab = SettingsSection;

export async function openSettingsWindow(tab?: SettingsTab): Promise<void> {
  await invoke("open_settings_window", { tab: tab ?? null });
}
