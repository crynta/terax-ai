import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { playAgentNotificationSound } from "./sound";

export type OsNotificationResult = "requested" | "denied" | "failed";

let granted = false;

async function ensurePermission(): Promise<boolean> {
  // Cache only the positive result so an OS-level settings change can be
  // observed on a later attempt after a denied check.
  if (granted) return true;
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === "granted";
  granted = ok;
  return ok;
}

export async function osNotify(
  title: string,
  body: string,
): Promise<OsNotificationResult> {
  try {
    if (!(await ensurePermission())) return "denied";
    sendNotification({ title, body });
    return "requested";
  } catch (e) {
    console.warn("[terax] os notification failed:", e);
    return "failed";
  }
}

export async function testAgentOsNotification(): Promise<OsNotificationResult> {
  const result = await osNotify(
    "Terax notifications are working",
    "You will be notified when an agent needs your attention.",
  );
  if (result === "requested") playAgentNotificationSound();
  return result;
}
