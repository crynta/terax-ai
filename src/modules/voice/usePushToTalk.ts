import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { VoiceHoldMods } from "@/modules/settings/store";
import { useVoiceStore } from "./voiceStore";

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

export function modsHeld(e: KeyboardEvent, mods: VoiceHoldMods): boolean {
  const any = !!(mods.ctrl || mods.alt || mods.shift || mods.meta);
  return (
    any &&
    !!mods.ctrl === e.ctrlKey &&
    !!mods.alt === e.altKey &&
    !!mods.shift === e.shiftKey &&
    !!mods.meta === e.metaKey
  );
}

export function usePushToTalk() {
  const enabled = usePreferencesStore((s) => s.voiceHoldEnabled);
  const useFn = usePreferencesStore((s) => s.voiceHoldUseFn);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat) return;
      if (useVoiceStore.getState().status === "idle") return;
      e.preventDefault();
      e.stopPropagation();
      useVoiceStore.getState().requestCancel();
    };
    const onBlur = () => {
      if (useVoiceStore.getState().status === "idle") return;
      useVoiceStore.getState().dispatchHold({ type: "blur" });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") return;
      onBlur();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !useFn) return;
    let active = true;
    void invoke("voice_set_fn_monitor", { enabled: true });
    let unlistenDown: UnlistenFn | undefined;
    let unlistenUp: UnlistenFn | undefined;
    const keep = (set: (u: UnlistenFn) => void) => (u: UnlistenFn) => {
      if (active) set(u);
      else u();
    };
    void listen("voice://fn-down", () => {
      useVoiceStore.getState().dispatchHold({
        type: "down",
        at: performance.now(),
      });
    }).then(keep((u) => (unlistenDown = u)));
    void listen("voice://fn-up", () => {
      useVoiceStore.getState().dispatchHold({
        type: "up",
        at: performance.now(),
      });
    }).then(keep((u) => (unlistenUp = u)));
    return () => {
      active = false;
      unlistenDown?.();
      unlistenUp?.();
      void invoke("voice_set_fn_monitor", { enabled: false });
    };
  }, [enabled, useFn]);

  useEffect(() => {
    if (!enabled || useFn) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || !MODIFIER_KEYS.has(e.key)) return;
      if (!modsHeld(e, usePreferencesStore.getState().voiceHoldMods)) return;
      useVoiceStore.getState().dispatchHold({
        type: "down",
        at: performance.now(),
      });
    };
    const onUp = (e: KeyboardEvent) => {
      if (!MODIFIER_KEYS.has(e.key)) return;
      useVoiceStore.getState().dispatchHold({
        type: "up",
        at: performance.now(),
      });
    };
    window.addEventListener("keydown", onDown, { capture: true });
    window.addEventListener("keyup", onUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onDown, { capture: true });
      window.removeEventListener("keyup", onUp, { capture: true });
    };
  }, [enabled, useFn]);
}
