import { invoke } from "@tauri-apps/api/core";

export async function openNewWindow(): Promise<void> {
  await invoke("open_new_window");
}
