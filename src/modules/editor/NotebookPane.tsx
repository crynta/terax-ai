import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getKey } from "@/modules/ai/lib/keyring";
import { onKeysChanged } from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useDocument } from "./lib/useDocument";
import type { EditorPaneHandle } from "./EditorPane";
import { NotebookCell } from "./NotebookCell";
import {
  parseNotebook,
  serializeNotebook,
  createEmptyNotebook,
  type Notebook,
  type Cell,
} from "./lib/notebook";

type Props = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  onClose?: () => void;
};

type RunAction = "stay" | "next" | "insert";
type CellKind = Extract<Cell["cell_type"], "code" | "markdown">;
type ExecCellResult = { outputs: any[]; execution_count: number };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function createCell(type: CellKind): Cell {
  return {
    cell_type: type,
    metadata: { id: crypto.randomUUID() },
    source: [""],
    ...(type === "code" ? { execution_count: null, outputs: [] } : {}),
  };
}

function cloneCellForInsert(cell: Cell): Cell {
  return {
    ...cell,
    metadata: { ...(cell.metadata || {}), id: crypto.randomUUID() },
    source: Array.isArray(cell.source) ? [...cell.source] : cell.source,
    outputs: cell.cell_type === "code" ? [] : cell.outputs,
    execution_count: cell.cell_type === "code" ? null : cell.execution_count,
  };
}

function applyExecutionResult(cell: Cell, result: ExecCellResult): Cell {
  return {
    ...cell,
    outputs: result.outputs,
    execution_count: result.execution_count,
  };
}

function stampCellIds(cells: Cell[]): Cell[] {
  let changed = false;
  const newCells = cells.map((c) => {
    if (c.metadata?.id) return c;
    changed = true;
    return {
      ...c,
      metadata: {
        ...(c.metadata || {}),
        id: crypto.randomUUID(),
      },
    };
  });
  return changed ? newCells : cells;
}

function cellSource(cell: Cell): string {
  return Array.isArray(cell.source) ? cell.source.join("") : cell.source;
}

function buildPreviousCodeContext(cells: Cell[], idx: number): string {
  const blocks = cells
    .slice(0, idx)
    .filter((cell) => cell.cell_type === "code")
    .map((cell) => cellSource(cell).trim())
    .filter(Boolean)
    .map((source, i) => `# %% Previous cell ${i + 1}\n${source}`);

  return blocks.length ? `${blocks.join("\n\n")}\n\n# %% Current cell\n` : "";
}

function parseOrCreateNotebook(content: string): Notebook | null {
  if (!content.trim()) {
    const empty = createEmptyNotebook();
    return { ...empty, cells: stampCellIds(empty.cells) };
  }

  const parsed = parseNotebook(content);
  return parsed ? { ...parsed, cells: stampCellIds(parsed.cells) } : null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest(
    "input, textarea, select, [contenteditable='true'], .cm-editor"
  );
}

export const NotebookPane = forwardRef<EditorPaneHandle, Props>(
  function NotebookPane(
    { path, onDirtyChange, onSaved }: Props,
    ref: React.ForwardedRef<EditorPaneHandle>
  ) {
    const { doc, onChange, save, reload } = useDocument({ path, onDirtyChange });
    const reloadRef = useRef(reload);
    reloadRef.current = reload;
    const paneRef = useRef<HTMLDivElement>(null);

    const [notebook, setNotebook] = useState<Notebook | null>(null);
    const notebookRef = useRef<Notebook | null>(null);
    const [activeCellIdx, setActiveCellIdx] = useState(0);
    const [mode, setMode] = useState<"command" | "edit">("command");
    const [executingIdx, setExecutingIdx] = useState<number | null>(null);
    const [isRunningAll, setIsRunningAll] = useState(false);
    const apiKeyRef = useRef<string | null>(null);
    const lastCommandKeyRef = useRef<{ key: string; at: number } | null>(null);

    useEffect(() => {
      let cancelled = false;
      const refresh = async () => {
        const provider = usePreferencesStore.getState().autocompleteProvider;
        if (provider === "lmstudio") {
          apiKeyRef.current = null;
          return;
        }
        const k = await getKey(provider);
        if (!cancelled) apiKeyRef.current = k;
      };
      void refresh();
      let unlistenKeys: (() => void) | undefined;
      void onKeysChanged(() => void refresh()).then((un) => {
        unlistenKeys = un;
      });
      const unsubPrefs = usePreferencesStore.subscribe((state, prev) => {
        if (state.autocompleteProvider !== prev.autocompleteProvider) {
          void refresh();
        }
      });
      return () => {
        cancelled = true;
        unlistenKeys?.();
        unsubPrefs();
      };
    }, []);

    useEffect(() => {
      if (doc.status === "ready") {
        const nextNotebook = parseOrCreateNotebook(doc.content);
        if (nextNotebook) {
          notebookRef.current = nextNotebook;
          setNotebook(nextNotebook);
        } else {
          console.error("[NotebookPane] Invalid notebook JSON:", path);
        }
      }
    }, [doc]);

    const updateNotebook = (newNotebook: Notebook) => {
      notebookRef.current = newNotebook;
      setNotebook(newNotebook);
      onChange(serializeNotebook(newNotebook));
    };

    const currentNotebook = () => notebookRef.current ?? notebook;

    const updateCells = (
      cells: Cell[],
      nextActiveCellIdx = activeCellIdx,
      baseNotebook = currentNotebook()
    ) => {
      if (!baseNotebook) return;
      updateNotebook({ ...baseNotebook, cells });
      setActiveCellIdx(
        Math.max(0, Math.min(nextActiveCellIdx, cells.length - 1))
      );
    };

    useImperativeHandle(
      ref,
      () => ({
        setQuery: () => {},
        findNext: () => {},
        findPrevious: () => {},
        clearQuery: () => {},
        focus: () => paneRef.current?.focus(),
        getSelection: () => null,
        getPath: () => path,
        reload: () => reloadRef.current(),
      }),
      [path]
    );

    if (doc.status === "loading") {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Loading Notebook…
        </div>
      );
    }
    if (doc.status === "error") {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">
          {doc.message}
        </div>
      );
    }
    if (doc.status === "binary" || doc.status === "toolarge") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
          <div className="text-sm text-foreground">File not supported</div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(doc.size)}
          </div>
        </div>
      );
    }
    if (!notebook) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Invalid Notebook Format
        </div>
      );
    }

    const handleCellChange = (idx: number, cell: Cell) => {
      const newCells = [...currentNotebook()!.cells];
      newCells[idx] = cell;
      updateCells(newCells);
    };

    const handleDelete = (idx: number) => {
      const sourceCells = currentNotebook()!.cells;
      let newCells = sourceCells.filter((_: Cell, i: number) => i !== idx);
      if (newCells.length === 0) {
        newCells = [createCell("code")];
      }
      updateCells(newCells, idx - 1);
    };

    const handleAddBelow = (idx: number, type: CellKind) => {
      const newCells = [...currentNotebook()!.cells];
      newCells.splice(idx + 1, 0, createCell(type));
      updateCells(newCells, idx + 1);
    };

    const handleAddAbove = (idx: number, type: CellKind) => {
      const newCells = [...currentNotebook()!.cells];
      newCells.splice(idx, 0, createCell(type));
      updateCells(newCells, idx);
    };

    const handleMoveUp = (idx: number) => {
      if (idx === 0) return;
      const newCells = [...currentNotebook()!.cells];
      [newCells[idx - 1], newCells[idx]] = [newCells[idx], newCells[idx - 1]];
      updateCells(newCells, idx - 1);
    };

    const handleMoveDown = (idx: number) => {
      const sourceCells = currentNotebook()!.cells;
      if (idx === sourceCells.length - 1) return;
      const newCells = [...sourceCells];
      [newCells[idx], newCells[idx + 1]] = [newCells[idx + 1], newCells[idx]];
      updateCells(newCells, idx + 1);
    };

    const handleChangeType = (idx: number, type: Cell["cell_type"]) => {
      const sourceNotebook = currentNotebook()!;
      const cell = sourceNotebook.cells[idx];
      if (!cell || cell.cell_type === type) return;
      const newCells = [...sourceNotebook.cells];
      newCells[idx] = {
        ...cell,
        cell_type: type,
        outputs: type === "code" ? cell.outputs ?? [] : [],
        execution_count: type === "code" ? cell.execution_count ?? null : undefined,
      };
      updateCells(newCells);
    };

    const handleRunCell = async (
      idx: number,
      action: RunAction = "stay",
    ) => {
      const sourceNotebook = currentNotebook();
      if (!sourceNotebook) return;

      const cell = sourceNotebook.cells[idx];
      if (!cell) return;

      if (cell.cell_type !== "code") {
        if (action === "next" && idx < sourceNotebook.cells.length - 1) {
          setActiveCellIdx(idx + 1);
        } else if (action === "insert") {
          handleAddBelow(idx, "code");
        }
        return;
      }

      setExecutingIdx(idx);
      try {
        const result = await invoke<ExecCellResult>("notebook_exec_cell", {
          source: cellSource(cell),
          path,
        });

        const newCells = [...sourceNotebook.cells];
        newCells[idx] = applyExecutionResult(cell, result);

        if (
          action === "insert" ||
          (action === "next" && idx === newCells.length - 1)
        ) {
          newCells.splice(idx + 1, 0, createCell("code"));
        }

        const nextActiveIdx = action === "stay" ? idx : idx + 1;
        updateCells(newCells, nextActiveIdx, sourceNotebook);
      } catch (err) {
        console.error("[NotebookPane] Run failed:", err);
      } finally {
        setExecutingIdx(null);
      }
    };

    const handleRunAll = async () => {
      let workingNotebook = notebookRef.current ?? notebook;
      if (!workingNotebook || isRunningAll) return;

      setIsRunningAll(true);
      try {
        for (let i = 0; i < workingNotebook.cells.length; i++) {
          const cell = workingNotebook.cells[i];
          if (cell.cell_type !== "code") continue;

          setExecutingIdx(i);
          const result = await invoke<ExecCellResult>("notebook_exec_cell", {
            source: cellSource(cell),
            path,
          });

          const newCells = [...workingNotebook.cells];
          newCells[i] = applyExecutionResult(cell, result);
          workingNotebook = { ...workingNotebook, cells: newCells };
          updateNotebook(workingNotebook);
        }
      } catch (err) {
        console.error("[NotebookPane] Run all failed:", err);
      } finally {
        setExecutingIdx(null);
        setIsRunningAll(false);
      }
    };

    const handleClearAll = () => {
      const sourceNotebook = currentNotebook();
      if (!sourceNotebook || executingIdx !== null || isRunningAll) return;
      const newCells = sourceNotebook.cells.map((c) => ({
        ...c,
        outputs: c.cell_type === "code" ? [] : undefined,
        execution_count: c.cell_type === "code" ? null : undefined,
      }));
      updateCells(newCells, activeCellIdx, sourceNotebook);
    };

    const handleCopyCell = (idx: number) => {
      const sourceNotebook = currentNotebook()!;
      const cell = sourceNotebook.cells[idx];
      if (!cell) return;
      const newCells = [...sourceNotebook.cells];
      newCells.splice(idx + 1, 0, cloneCellForInsert(cell));
      updateCells(newCells, idx + 1, sourceNotebook);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save().then(() => onSaved?.());
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        setMode("command");
        paneRef.current?.focus();
        return;
      }

      if (isEditableTarget(e.target)) {
        return;
      }

      const idx = activeCellIdx;
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

      if (e.key === "Enter" && !hasModifier && !e.shiftKey) {
        e.preventDefault();
        setMode("edit");
        return;
      }
      if (e.key === "ArrowUp" || e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMode("command");
        setActiveCellIdx((current) => Math.max(0, current - 1));
        return;
      }
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "j") {
        e.preventDefault();
        setMode("command");
        setActiveCellIdx((current) =>
          Math.min(notebook.cells.length - 1, current + 1)
        );
        return;
      }
      if (!hasModifier && !e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        handleAddAbove(idx, "code");
        return;
      }
      if (!hasModifier && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        handleAddBelow(idx, "code");
        return;
      }
      if (!hasModifier && !e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        handleChangeType(idx, "markdown");
        return;
      }
      if (!hasModifier && !e.shiftKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleChangeType(idx, "code");
        return;
      }
      if (!hasModifier && !e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        handleChangeType(idx, "raw");
        return;
      }
      if (!hasModifier && !e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        handleCopyCell(idx);
        return;
      }
      if (!hasModifier && !e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        handleDelete(idx);
        return;
      }
      if (!hasModifier && !e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const now = Date.now();
        const last = lastCommandKeyRef.current;
        if (last?.key === "d" && now - last.at < 800) {
          lastCommandKeyRef.current = null;
          handleDelete(idx);
        } else {
          lastCommandKeyRef.current = { key: "d", at: now };
        }
        return;
      }
      if (!hasModifier && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        void handleRunCell(idx, "next");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        void handleRunCell(idx, "stay");
        return;
      }
      if (e.altKey && !e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        void handleRunCell(idx, "insert");
      }
    };

    return (
      <div
        ref={paneRef}
        className="flex h-full min-h-0 flex-col overflow-y-auto bg-background p-4 outline-none relative"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <div className="absolute top-2 right-4 flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40 select-none">
          <button 
            className="hover:text-primary transition-colors disabled:opacity-50"
            onClick={handleRunAll}
            disabled={executingIdx !== null || isRunningAll}
          >
            Run All
          </button>
          <button 
            className="hover:text-primary transition-colors disabled:opacity-50"
            onClick={handleClearAll}
            disabled={executingIdx !== null || isRunningAll}
          >
            Clear Outputs
          </button>
          <span>Jupyter Notebook</span>
        </div>
        <div className="max-w-4xl mx-auto w-full pb-32 pt-4">
          {notebook.cells.map((cell: Cell, idx: number) => (
            <NotebookCell
              key={cell.metadata?.id ?? idx}
              cell={cell}
              isActive={activeCellIdx === idx}
              isExecuting={executingIdx === idx}
              isCommandMode={mode === "command"}
              onFocus={() => {
                setActiveCellIdx(idx);
                setMode("command");
                paneRef.current?.focus();
              }}
              onChange={(c) => handleCellChange(idx, c)}
              onDelete={() => handleDelete(idx)}
              onAddBelow={(t) => handleAddBelow(idx, t)}
              onMoveUp={() => handleMoveUp(idx)}
              onMoveDown={() => handleMoveDown(idx)}
              onEdit={() => {
                setActiveCellIdx(idx);
                setMode("edit");
              }}
              onRunStay={() => handleRunCell(idx, "stay")}
              onRunNext={() => handleRunCell(idx, "next")}
              onRunInsert={() => handleRunCell(idx, "insert")}
              getPath={() => path}
              getAutocompleteApiKey={() => apiKeyRef.current}
              getPreviousCodeContext={() =>
                buildPreviousCodeContext(notebook.cells, idx)
              }
            />
          ))}
        </div>
      </div>
    );
  }
);
