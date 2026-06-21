import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let granted = false;

async function ensurePermission(): Promise<boolean> {
  // Cache only the positive result: a transient denial (e.g. the OS prompt
  // dismissed while unfocused) must not disable notifications for the session.
  if (granted) return true;
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === "granted";
  granted = ok;
  return ok;
}

export async function osNotify(title: string, body: string): Promise<void> {
  try {
    if (await ensurePermission()) sendNotification({ title, body });
  } catch (e) {
    console.warn("[terax] os notification failed:", e);
  }
}
