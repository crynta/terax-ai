import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { VoiceHoldMods } from "@/modules/settings/store";
import { useVoiceStore } from "./voiceStore";

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

function modsHeld(e: KeyboardEvent, mods: VoiceHoldMods): boolean {
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
  const startedByHold = useRef(false);

  useEffect(() => {
    if (!enabled || !useFn) return;
    let active = true;
    let unlistenDown: UnlistenFn | undefined;
    let unlistenUp: UnlistenFn | undefined;
    const keep = (set: (u: UnlistenFn) => void) => (u: UnlistenFn) => {
      if (active) set(u);
      else u();
    };
    void listen("voice://fn-down", () => {
      if (useVoiceStore.getState().status === "idle") {
        startedByHold.current = true;
        useVoiceStore.getState().start();
      }
    }).then(keep((u) => (unlistenDown = u)));
    void listen("voice://fn-up", () => {
      if (startedByHold.current) {
        startedByHold.current = false;
        useVoiceStore.getState().stop();
      }
    }).then(keep((u) => (unlistenUp = u)));
    return () => {
      active = false;
      unlistenDown?.();
      unlistenUp?.();
    };
  }, [enabled, useFn]);

  useEffect(() => {
    if (!enabled || useFn) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || !MODIFIER_KEYS.has(e.key)) return;
      const mods = usePreferencesStore.getState().voiceHoldMods;
      if (modsHeld(e, mods) && useVoiceStore.getState().status === "idle") {
        startedByHold.current = true;
        useVoiceStore.getState().start();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (!MODIFIER_KEYS.has(e.key)) return;
      if (
        startedByHold.current &&
        useVoiceStore.getState().status === "recording"
      ) {
        startedByHold.current = false;
        useVoiceStore.getState().stop();
      }
    };
    window.addEventListener("keydown", onDown, { capture: true });
    window.addEventListener("keyup", onUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onDown, { capture: true });
      window.removeEventListener("keyup", onUp, { capture: true });
    };
  }, [enabled, useFn]);
}
