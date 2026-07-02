import { cn } from "@/lib/utils";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { leafIds, livePtySessions } from "@/modules/terminal";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import {
  classifyProcess,
  type ClassifiedProcess,
  type ProcessInfo,
  visibleCommand,
} from "./processClassifier";

const REFRESH_MS = 4000;
const MAX_VISIBLE = 120;

type Props = {
  tabs: Tab[];
  onSelectTerminal: (tabId: number, leafId: number) => void;
};

type ProcessOwner = {
  tabId: number;
  leafId: number;
  label: string;
};

const KIND_CLASS: Record<ClassifiedProcess["kind"], string> = {
  agent:
    "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  node: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  python: "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  rust: "border-orange-500/25 bg-orange-500/10 text-orange-600 dark:text-orange-300",
  c: "border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-300",
  shell: "border-cyan-500/25 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
  git: "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300",
  system: "border-border bg-muted/35 text-muted-foreground",
  binary: "border-border bg-card text-muted-foreground",
};

export function ProcessesSection({ tabs, onSelectTerminal }: Props) {
  const [processes, setProcesses] = useState<ClassifiedProcess[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    async function load() {
      try {
        const live = livePtySessions();
        if (live.length === 0) {
          if (!cancelled) {
            setProcesses([]);
            setError(null);
          }
          return;
        }
        const rows = await invoke<ProcessInfo[]>(
          "proc_list_terminal_processes",
          {
            ids: live.map((s) => s.ptyId),
          },
        );
        if (cancelled) return;
        setProcesses(sortProcesses(rows.map(classifyProcess)));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) timer = window.setTimeout(load, REFRESH_MS);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const visible = useMemo(() => processes.slice(0, MAX_VISIBLE), [processes]);
  const owners = processOwners(tabs);

  return (
    <section className="flex min-h-0 basis-1/2 flex-col border-t border-border/60">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Processes
          </div>
          <div className="truncate text-[10px] text-muted-foreground/70">
            Spawned by Terax terminals
          </div>
        </div>
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-semibold tabular-nums text-muted-foreground">
          {processes.length}
        </span>
      </div>

      {error ? (
        <div className="px-3 py-2 text-[10.5px] leading-relaxed text-destructive">
          {error}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-muted-foreground">
          No terminal-spawned processes.
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
          {visible.map((process) => (
            <li key={process.pid}>
              <ProcessRow
                process={process}
                owner={owners.get(process.ptyId)}
                onSelectTerminal={onSelectTerminal}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProcessRow({
  process,
  owner,
  onSelectTerminal,
}: {
  process: ClassifiedProcess;
  owner?: ProcessOwner;
  onSelectTerminal: (tabId: number, leafId: number) => void;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          title={process.detail}
          className={cn(
            "inline-flex h-4 shrink-0 items-center rounded border px-1 text-[8.5px] font-semibold leading-none",
            KIND_CLASS[process.kind],
          )}
        >
          {process.label}
        </span>
        <span className="min-w-0 truncate text-[11.5px] font-medium">
          {process.name}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[9.5px] tabular-nums text-muted-foreground/75">
          {process.pid}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 gap-1.5">
        {owner ? (
          <span className="shrink-0 truncate text-[9.5px] text-muted-foreground/55">
            {owner.label}
          </span>
        ) : null}
        <span className="min-w-0 truncate font-mono text-[9.5px] text-muted-foreground/70">
          {visibleCommand(process)}
        </span>
      </div>
    </>
  );

  if (!owner) {
    return (
      <div className="group rounded-md px-2 py-1.5 transition-colors hover:bg-foreground/[0.045]">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelectTerminal(owner.tabId, owner.leafId)}
      className="group block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.045] active:bg-foreground/[0.08]"
    >
      {content}
    </button>
  );
}

function processOwners(tabs: Tab[]): Map<number, ProcessOwner> {
  const live = livePtySessions();
  const byLeaf = new Map(live.map((s) => [s.leafId, s.ptyId]));
  const owners = new Map<number, ProcessOwner>();
  for (const tab of tabs) {
    if (tab.kind !== "terminal") continue;
    for (const leafId of leafIds(tab.paneTree)) {
      const ptyId = byLeaf.get(leafId);
      if (!ptyId) continue;
      owners.set(ptyId, {
        tabId: tab.id,
        leafId,
        label: tab.customTitle ?? tab.title ?? `Terminal ${tab.id}`,
      });
    }
  }
  return owners;
}

function sortProcesses(processes: ClassifiedProcess[]): ClassifiedProcess[] {
  const priority: Record<ClassifiedProcess["kind"], number> = {
    agent: 0,
    node: 1,
    python: 2,
    rust: 3,
    c: 4,
    shell: 5,
    git: 6,
    binary: 7,
    system: 8,
  };
  return processes.sort((a, b) => {
    const byKind = priority[a.kind] - priority[b.kind];
    if (byKind !== 0) return byKind;
    return a.name.localeCompare(b.name) || a.pid - b.pid;
  });
}
