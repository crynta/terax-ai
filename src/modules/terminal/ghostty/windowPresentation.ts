import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  WindowPresentationPolicy,
  type WindowPresentation,
} from "@/modules/terminal/ghostty/WindowPresentationPolicy";

type NativePresentation = {
  revision: number;
  occluded: boolean;
  sleeping: boolean;
};
const listeners = new Set<(state: WindowPresentation) => void>();
let policy: WindowPresentationPolicy | null = null;
let native: NativePresentation = {
  revision: -1,
  occluded: false,
  sleeping: false,
};
let disconnect: (() => void) | null = null;

export function terminalWindowPresentation(): WindowPresentation {
  const state = policy?.snapshot();
  const visible =
    typeof document === "undefined" || document.visibilityState === "visible";
  if (state && (!state.visible || visible)) return state;
  return { visible, reclaim: false };
}

export function subscribeWindowPresentation(
  listener: (state: WindowPresentation) => void,
): () => void {
  if (!policy) connect();
  listeners.add(listener);
  listener(terminalWindowPresentation());
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    disconnect?.();
    disconnect = null;
    policy?.dispose();
    policy = null;
    native = { revision: -1, occluded: false, sleeping: false };
  };
}

export function windowPresentationDiagnostics() {
  return {
    ...terminalWindowPresentation(),
    native,
    transitions: policy?.transitions ?? 0,
    reclamations: policy?.reclamations ?? 0,
  };
}

function connect(): void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  policy = new WindowPresentationPolicy((state) => {
    for (const listener of listeners) listener(state);
  });
  const sync = () =>
    policy?.update(
      document.visibilityState === "visible" && !native.occluded,
      native.sleeping,
    );
  const accept = (value: NativePresentation) => {
    if (
      disposed ||
      !value ||
      value.revision < 0 ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < native.revision ||
      typeof value.occluded !== "boolean" ||
      typeof value.sleeping !== "boolean"
    )
      return;
    native = value;
    sync();
  };
  document.addEventListener("visibilitychange", sync);
  sync();
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    void getCurrentWindow()
      .listen<NativePresentation>("terax:window-presentation", ({ payload }) =>
        accept(payload),
      )
      .then(async (stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        accept(await invoke<NativePresentation>("window_presentation_state"));
      })
      .catch((error: unknown) => {
        if (!disposed)
          console.warn(
            "[terax] Native window presentation tracking unavailable:",
            error,
          );
      });
  }
  disconnect = () => {
    disposed = true;
    document.removeEventListener("visibilitychange", sync);
    unlisten?.();
  };
}
