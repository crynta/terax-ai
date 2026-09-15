import { invoke } from "@tauri-apps/api/core";

/** Mirrors `Backdrop` in `src-tauri/src/modules/vibrancy.rs`. */
export type Backdrop = "vibrancy" | "mica" | "none";

/** Must stay in sync with the pre-paint script in index.html. */
export const PREPAINT_BG = { dark: "#141414", light: "#ffffff" } as const;

let kindPromise: Promise<Backdrop> | null = null;

export function getBackdropKind(): Promise<Backdrop> {
  kindPromise ??= invoke<Backdrop>("window_backdrop_kind").catch(
    () => "none" as const,
  );
  return kindPromise;
}

/** Last state handed to the native side. Repeating it would rebuild the
 * effect view for nothing. */
let applied: string | null = null;
let queue: Promise<void> = Promise.resolve();

/** Serialized: two in-flight toggles could otherwise land out of order. */
export function applyVibrancy(enabled: boolean, dark: boolean): Promise<void> {
  queue = queue.then(() => run(enabled, dark));
  return queue;
}

async function run(enabled: boolean, dark: boolean): Promise<void> {
  const kind = await getBackdropKind();
  const on = enabled && kind !== "none";
  const root = document.documentElement;

  const paintOpaque = () => {
    root.removeAttribute("data-vibrancy");
    root.style.backgroundColor = dark ? PREPAINT_BG.dark : PREPAINT_BG.light;
  };

  if (on) {
    root.setAttribute("data-vibrancy", "on");
    // The pre-paint colour parked on <html> sits in front of the backdrop.
    root.style.backgroundColor = "";
  } else {
    paintOpaque();
  }

  // Mica tints its own backdrop and cannot read the webview theme, so it has
  // to be rebuilt on a mode flip; NSVisualEffectView adapts on its own.
  const key = on ? (kind === "mica" ? `on:${dark}` : "on") : "off";
  if (key === applied) return;

  try {
    await invoke("window_set_backdrop", { enabled: on, dark });
    applied = key;
  } catch {
    // Never leave the webview transparent over nothing.
    paintOpaque();
    applied = null;
  }
}
