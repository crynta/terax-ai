import { useEffect, useRef, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceScopeKey } from "@/modules/workspace";
import { loadSession } from "./sessionPersistence";
import type { RestoredInitial } from "./sessionDeserialize";
import { sessionKey } from "./sessionKey";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; restored: RestoredInitial | null; key: string };

const RESTORE_START_ID = 1_000_000; // sentinel to avoid clashing with default ids

/**
 * Loads the saved session (if any) once on mount. Returns "loading" until the
 * read resolves; "ready" thereafter. Callers gate their first useTabs() call
 * on this so the default tab doesn't clobber the restored payload.
 *
 * Reads launchDir / workspaceScope once at mount — switching env after mount
 * does NOT trigger a re-load (we keep the session in place and persist to the
 * new key on next write; see the persistence effect).
 */
export function useSessionLoad(launchDir: string | undefined): LoadState {
  const restoreSession = usePreferencesStore((s) => s.restoreSession);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!hydrated) return; // wait for prefs to populate restoreSession
    startedRef.current = true;

    const key = sessionKey(launchDir, currentWorkspaceScopeKey());
    if (!restoreSession) {
      setState({ kind: "ready", restored: null, key });
      return;
    }
    void loadSession(key, RESTORE_START_ID).then((restored) => {
      setState({ kind: "ready", restored, key });
    });
  }, [hydrated, restoreSession, launchDir]);

  return state;
}
