import { getCurrentWindow } from "@tauri-apps/api/window";

// `open -a Terax` reactivates the app at the OS level but does not raise a
// minimized or occluded window. Awaited in order: focus must land only after
// the window is visible and restored, or a minimized window can end up shown
// but unfocused. Idempotent and safe on a cold start where the boot show in
// main.tsx already ran by the time this can fire.
export async function activateMainWindow(): Promise<void> {
  const win = getCurrentWindow();
  await win.show().catch(() => {});
  await win.unminimize().catch(() => {});
  await win.setFocus().catch(() => {});
}
