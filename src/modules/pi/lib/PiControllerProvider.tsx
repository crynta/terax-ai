import {
  createContext,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PiProviderKeyStatus } from "@/modules/pi/lib/diagnostics";
import type { PiLocalAgentStatus } from "@/modules/pi/lib/local-agents";
import type { PiThinkingLevel } from "@/modules/pi/lib/provider";
import type {
  PiSession,
  PiSessionBranch,
  PiSessionEvent,
} from "@/modules/pi/lib/sessions";
import type { PiDiagnostics, PiRuntimeState } from "@/modules/pi/lib/status";

export type PiPanelSectionId =
  | "diagnostics"
  | "sessions"
  | "context"
  | "localAgents";
export type PiPanelSectionCollapseState = Record<PiPanelSectionId, boolean>;

export type PiControllerState = {
  collapsedSections: PiPanelSectionCollapseState;
  diagnostics: PiDiagnostics | null;
  diagnosticsError: string | null;
  historyError: string | null;
  keyRefreshToken: number;
  localAgents: PiLocalAgentStatus[];
  prompt: string;
  providerKeyStatus: PiProviderKeyStatus | undefined;
  runtimeState: PiRuntimeState;
  selectedSessionId: string | null;
  sessionEvents: PiSessionEvent[];
  sessions: PiSession[];
  supportingSectionsHidden: boolean;
  thinkingLevelOverride: PiThinkingLevel | null;
};

type RetainedState = Partial<PiControllerState>;

export type PiControllerStore = {
  regenerateBranches: Map<string, PiSessionBranch>;
  get<K extends keyof PiControllerState>(
    key: K,
    initialValue: PiControllerState[K],
  ): PiControllerState[K];
  set<K extends keyof PiControllerState>(
    key: K,
    next: SetStateAction<PiControllerState[K]>,
    fallbackValue?: PiControllerState[K],
  ): PiControllerState[K];
  getPrewarmAttempted(): boolean;
  setPrewarmAttempted(attempted: boolean): void;
};

function hasKey<K extends keyof PiControllerState>(
  state: RetainedState,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(state, key);
}

export function createPiControllerStore(): PiControllerStore {
  const state: RetainedState = {};
  let prewarmAttempted = false;

  return {
    regenerateBranches: new Map<string, PiSessionBranch>(),
    get(key, initialValue) {
      return hasKey(state, key)
        ? (state[key] as PiControllerState[typeof key])
        : initialValue;
    },
    set(key, next, fallbackValue) {
      const current = hasKey(state, key)
        ? (state[key] as PiControllerState[typeof key])
        : fallbackValue;
      const value =
        typeof next === "function"
          ? (
              next as (
                current: PiControllerState[typeof key],
              ) => PiControllerState[typeof key]
            )(current as PiControllerState[typeof key])
          : next;
      state[key] = value;
      return value;
    },
    getPrewarmAttempted() {
      return prewarmAttempted;
    },
    setPrewarmAttempted(attempted) {
      prewarmAttempted = attempted;
    },
  };
}

const fallbackPiControllerStore = createPiControllerStore();
const PiControllerContext = createContext<PiControllerStore>(
  fallbackPiControllerStore,
);

type PiControllerProviderProps = {
  children: ReactNode;
};

export function PiControllerProvider({ children }: PiControllerProviderProps) {
  const storeRef = useRef<PiControllerStore | null>(null);
  storeRef.current ??= createPiControllerStore();

  return (
    <PiControllerContext.Provider value={storeRef.current}>
      {children}
    </PiControllerContext.Provider>
  );
}

export function usePiControllerStore(): PiControllerStore {
  return useContext(PiControllerContext);
}

export function usePiControllerState<K extends keyof PiControllerState>(
  key: K,
  initialValue: PiControllerState[K],
) {
  const store = usePiControllerStore();
  const [value, setValue] = useState<PiControllerState[K]>(() =>
    store.get(key, initialValue),
  );

  const setControllerValue = useCallback(
    (next: SetStateAction<PiControllerState[K]>) => {
      const nextValue = store.set(key, next, value);
      setValue(nextValue);
    },
    [key, store, value],
  );

  useEffect(() => {
    store.set(key, value, initialValue);
  }, [initialValue, key, store, value]);

  return [value, setControllerValue] as const;
}
