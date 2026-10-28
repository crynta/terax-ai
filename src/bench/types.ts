import type { Tab } from "@/modules/tabs";

/** What the scenario driver may do to the running application: the app's own tab actions. */
export type BenchAppApi = {
  tabs: Tab[];
  activeId: number;
  /** The restore/boot flow finished; the first terminal tab exists. */
  booted: boolean;
  setActiveId: (id: number) => void;
  newTab: (cwd?: string) => number;
  newBlockTab: (cwd?: string) => number;
  newAgentGroupTab: (
    cwd: string | undefined,
    title: string,
    instances: 1 | 2 | 3 | 4,
  ) => { tabId: number; leafIds: number[] };
  splitActivePane: (tabId: number, dir: "row" | "col") => number | null;
  closeTab: (id: number) => void;
  readBuffer: (leafId: number, maxLines?: number) => string | null;
};

/** One scenario, as written by scripts/app-lab/run.py into TERAX_BENCH_SCENARIO. */
export type BenchScenario = {
  name:
    | "tabs"
    | "resize"
    | "split-drag"
    | "occlusion"
    | "agents-steady"
    | "idle"
    | "fs-churn"
    | "input";
  /** tabs: "2" (shell + agent) or "4" (shell, agent, agent+shell split, shell). */
  variant?: string;
  /** Shell command that starts the synthetic agent (see scripts/app-lab/agent-sim.mjs). */
  agentCommand: string;
  window?: { width: number; height: number };
  cycles?: number;
  dwellMs?: number;
  hiddenMs?: number;
  visibleMs?: number;
  durationS?: number;
  warmupS?: number;
  hiddenAgents?: number;
  /** split-drag: seconds of divider motion per drag, and its amplitude as a share of the pane area. */
  dragS?: number;
  dragAmplitude?: number;
  /** split-drag: mouse sample rate of the synthetic drag (Hz). */
  mouseHz?: number;
  /** resize: grow the window before shrinking it (takes it past the size the canvas was allocated for). */
  growFirst?: boolean;
  steps?: number;
  stepPoints?: number;
  stepIntervalMs?: number;
  live?: boolean;
  /** Working directories of new shell and agent tabs (the first tab uses the launch directory). */
  cwds?: { shell?: string; agent?: string };
  /** After the idle tail, request a full garbage collection (WebKit's testing SPI, or allocation pressure from the page) and sample again. */
  gc?: "private" | "alloc";
  /** idle: suspected wakeup source to remove before measuring ("blur" the focused element, "caret-transparent"). */
  probe?: string;
  /** Mitigation probe (see ScenarioRun.startValve): periodic allocation pressure. */
  valve?: { everyS: number; chunks: number; chunkMb: number };
  /** tabs: index (0-based, creation order) of the tab shown at baseline; default 0. */
  holdTab?: number;
  /** tabs control: run the same loop without ever switching tabs. */
  noSwitch?: boolean;
  /** idle, fs-churn: take a full sample every this many seconds (`tick-N`, with the layer tree). */
  tickS?: number;
  /** fs-churn: the orchestrator moves another application to the front; samples need no key window. */
  unfocused?: boolean;
  /** Patch WebGPU/DOM prototypes with lifecycle counters (src/bench/gpuCounters.ts). */
  instrument?: boolean;
  /** Application preferences to set through the app's own store before the scenario starts. */
  prefs?: { windowVibrancy?: boolean };
  /** localStorage entries to set (null removes) before the application starts. */
  localStorage?: Record<string, string | null>;
};

export type BenchConfig = {
  scenario: BenchScenario | null;
  reportUrl: string | null;
  identifier: string;
};
