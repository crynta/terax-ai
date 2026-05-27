import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

/** Read plain text from the OS clipboard (works for content copied outside Terax). */
export async function readClipboardText(
  event?: ClipboardEvent,
): Promise<string> {
  const fromEvent = event?.clipboardData?.getData("text/plain");
  if (fromEvent) return fromEvent;

  try {
    return await readText();
  } catch {
    // Web fallback for `pnpm tauri dev` in a browser or older builds.
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  }
  return "";
}

/** Write plain text to the OS clipboard. */
export async function writeClipboardText(text: string): Promise<void> {
  try {
    await writeText(text);
    return;
  } catch {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }
}
