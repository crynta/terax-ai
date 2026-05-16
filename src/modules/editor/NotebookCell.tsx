import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { Streamdown } from "streamdown";
import { math } from "@streamdown/math";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { EDITOR_THEME_EXT } from "./lib/themes";
import {
  buildSharedExtensions,
  languageCompartment,
  vimCompartment,
} from "./lib/extensions";
import { Prec } from "@codemirror/state";
import { vim } from "@replit/codemirror-vim";
import { resolveLanguage } from "./lib/languageResolver";
import { NotebookOutput } from "./NotebookOutput";
import type { Cell } from "./lib/notebook";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp01Icon,
  ArrowDown01Icon,
  PlusSignIcon,
  Delete02Icon,
  CodeCircleIcon,
  TextIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import {
  DEFAULT_AUTOCOMPLETE_MODEL,
  LMSTUDIO_DEFAULT_BASE_URL,
} from "@/modules/ai/config";
import { inlineCompletion } from "./lib/autocomplete/inlineExtension";

const streamdownPlugins = { math };
const codeMirrorBasicSetup = {
  lineNumbers: false,
  highlightActiveLineGutter: false,
  foldGutter: true,
  bracketMatching: true,
  closeBrackets: true,
  highlightActiveLine: false,
};

export type NotebookCellProps = {
  cell: Cell;
  onChange: (cell: Cell) => void;
  onDelete: () => void;
  onAddBelow: (type: "code" | "markdown") => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isActive: boolean;
  isExecuting?: boolean;
  isCommandMode: boolean;
  onFocus: () => void;
  onEdit: () => void;
  onRunStay: () => void;
  onRunNext: () => void;
  onRunInsert: () => void;
  getPath: () => string | null;
  getAutocompleteApiKey: () => string | null;
  getPreviousCodeContext: () => string;
};

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function asNotebookSource(value: string): string[] {
  return value
    .split("\n")
    .map((line, i, lines) => (i === lines.length - 1 ? line : `${line}\n`));
}

function sourceText(cell: Cell): string {
  return Array.isArray(cell.source) ? cell.source.join("") : cell.source;
}

function editorLanguageFile(cell: Cell): string {
  return cell.cell_type === "code" ? "file.py" : "file.md";
}

export function NotebookCell({
  cell,
  onChange,
  onDelete,
  onAddBelow,
  onMoveUp,
  onMoveDown,
  isActive,
  isExecuting,
  isCommandMode,
  onFocus,
  onEdit,
  onRunStay,
  onRunNext,
  onRunInsert,
  getPath,
  getAutocompleteApiKey,
  getPreviousCodeContext,
}: NotebookCellProps) {
  const [editing, setEditing] = useState(false);
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const onRunStayRef = useLatest(onRunStay);
  const onRunNextRef = useLatest(onRunNext);
  const onRunInsertRef = useLatest(onRunInsert);
  const cellTypeRef = useLatest(cell.cell_type);
  const getPathRef = useLatest(getPath);
  const getAutocompleteApiKeyRef = useLatest(getAutocompleteApiKey);
  const getPreviousCodeContextRef = useLatest(getPreviousCodeContext);

  const editorThemeId = usePreferencesStore((s) => s.editorTheme);
  const vimMode = usePreferencesStore((s) => s.vimMode);
  const themeExt = EDITOR_THEME_EXT[editorThemeId] ?? EDITOR_THEME_EXT.atomone;

  const extensions = useMemo(
    () => [
      vimCompartment.of(vimMode ? Prec.highest(vim()) : []),
      ...buildSharedExtensions(),
      languageCompartment.of([]),
      inlineCompletion({
        getPrefs: () => {
          const s = usePreferencesStore.getState();
          return {
            enabled: cellTypeRef.current === "code" && s.autocompleteEnabled,
            provider: s.autocompleteProvider,
            modelId:
              s.autocompleteModelId ||
              DEFAULT_AUTOCOMPLETE_MODEL[s.autocompleteProvider],
            apiKey: getAutocompleteApiKeyRef.current(),
            lmstudioBaseURL: s.lmstudioBaseURL || LMSTUDIO_DEFAULT_BASE_URL,
          };
        },
        getPath: () => {
          const notebookPath = getPathRef.current();
          return notebookPath ? `${notebookPath}#cell.py` : "notebook-cell.py";
        },
        getLanguage: () => (cellTypeRef.current === "code" ? "py" : "md"),
        getPrefixContext: () =>
          cellTypeRef.current === "code"
            ? getPreviousCodeContextRef.current()
            : "",
      }),
      Prec.highest(
        EditorView.theme({
          ".cm-content": {
            caretColor: "var(--primary)",
          },
        })
      ),
      Prec.highest(
        keymap.of([
          {
            key: "Shift-Enter",
            run: () => {
              onRunNextRef.current();
              return true;
            },
          },
          {
            key: "Ctrl-Enter",
            run: () => {
              onRunStayRef.current();
              return true;
            },
          },
          {
            key: "Alt-Enter",
            run: () => {
              onRunInsertRef.current();
              return true;
            },
          },
        ])
      ),
    ],
    [vimMode]
  );

  useEffect(() => {
    let cancelled = false;
    resolveLanguage(editorLanguageFile(cell)).then((ext) => {
      if (cancelled) return;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({ effects: languageCompartment.reconfigure(ext ?? []) });
    });
    return () => { cancelled = true; };
  }, [cell.cell_type]);

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    resolveLanguage(editorLanguageFile(cell)).then((ext) => {
      if (cancelled) return;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({ effects: languageCompartment.reconfigure(ext ?? []) });
    });
    return () => { cancelled = true; };
  }, [editing]);

  const sourceStr = sourceText(cell);

  const handleChange = (val: string) => {
    onChange({ ...cell, source: asNotebookSource(val) });
  };

  const toggleType = () => {
    const newType = cell.cell_type === "code" ? "markdown" : "code";
    onChange({
      ...cell,
      cell_type: newType,
      outputs: newType === "markdown" ? [] : cell.outputs,
    });
  };

  const handleStartEditing = useCallback(() => {
    onEdit();
    setEditing(true);
    setTimeout(() => { cmRef.current?.view?.focus(); }, 0);
  }, [onEdit]);

  useEffect(() => {
    if (!isActive || isCommandMode) return;
    if (cell.cell_type !== "code") setEditing(true);
    setTimeout(() => { cmRef.current?.view?.focus(); }, 0);
  }, [cell.cell_type, isActive, isCommandMode]);

  const showEditor = cell.cell_type === "code" || editing;

  return (
    <div
      className={cn(
        "group relative flex flex-col mb-4 rounded-md border transition-colors",
        isActive
          ? "border-primary/50 shadow-sm"
          : "border-border/30 hover:border-border/60"
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".cm-editor")) {
          onEdit();
          return;
        }
        onFocus();
      }}
      onDoubleClick={handleStartEditing}
    >
      <div className="absolute right-2 -top-3 hidden group-hover:flex items-center gap-1 bg-background border border-border/60 rounded-md shadow-sm p-0.5 z-10">
        <Button size="icon-sm" variant="ghost"
          onClick={(e) => { e.stopPropagation(); toggleType(); }}
          title={`Change to ${cell.cell_type === "code" ? "Markdown" : "Code"}`}>
          <HugeiconsIcon icon={cell.cell_type === "code" ? TextIcon : CodeCircleIcon} size={14} />
        </Button>
        {cell.cell_type === "code" && (
          <Button size="icon-sm" variant="ghost"
            onClick={(e) => { e.stopPropagation(); onRunNext(); }}
            title="Run Cell (Shift+Enter)" className="text-primary hover:text-primary hover:bg-primary/10">
            <HugeiconsIcon icon={PlayIcon} size={14} />
          </Button>
        )}
        <Button size="icon-sm" variant="ghost"
          onClick={(e) => { e.stopPropagation(); onMoveUp(); }} title="Move Up">
          <HugeiconsIcon icon={ArrowUp01Icon} size={14} />
        </Button>
        <Button size="icon-sm" variant="ghost"
          onClick={(e) => { e.stopPropagation(); onMoveDown(); }} title="Move Down">
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
        </Button>
        <Button size="icon-sm" variant="ghost"
          onClick={(e) => { e.stopPropagation(); onAddBelow("code"); }} title="Add Code Cell Below">
          <HugeiconsIcon icon={PlusSignIcon} size={14} />
        </Button>
        <Button size="icon-sm" variant="ghost"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete Cell" className="text-destructive hover:text-destructive">
          <HugeiconsIcon icon={Delete02Icon} size={14} />
        </Button>
      </div>

      <div className="flex flex-row w-full">
        {/* Execution count gutter */}
        <div className="w-16 shrink-0 py-2 px-2 text-right font-mono text-[11px] text-muted-foreground select-none bg-muted/20 border-r border-border/30">
          {isExecuting ? (
            <div className="animate-spin inline-block w-2 h-2 border-t-2 border-primary rounded-full" />
          ) : (
            cell.cell_type === "code" ? `[${cell.execution_count ?? " "}]` : ""
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-hidden bg-background">
          {!showEditor ? (
            <div
              className="p-4 prose prose-sm dark:prose-invert max-w-none cursor-text min-h-[40px]"
              onDoubleClick={(e) => { e.stopPropagation(); handleStartEditing(); }}
            >
              {sourceStr ? (
                <Streamdown plugins={streamdownPlugins}>{sourceStr}</Streamdown>
              ) : (
                <span className="text-muted-foreground italic">Double-click to edit markdown</span>
              )}
            </div>
          ) : (
            <div className="p-0">
              <CodeMirror
                ref={cmRef}
                value={sourceStr}
                onChange={handleChange}
                theme={themeExt}
                extensions={extensions}
                className={cn(
                  "min-h-[24px] overflow-hidden [&>.cm-editor]:outline-none",
                  cell.cell_type === "code" ? "bg-muted/10" : ""
                )}
                basicSetup={codeMirrorBasicSetup}
                onBlur={() => {
                  if (cell.cell_type === "markdown" && isCommandMode) {
                    setEditing(false);
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>

      {cell.cell_type === "code" && cell.outputs && cell.outputs.length > 0 && (
        <div className="flex flex-row w-full border-t border-border/30">
          <div className="w-16 shrink-0 bg-muted/20 border-r border-border/30" />
          <div className="flex-1 p-2 bg-background flex flex-col gap-2 overflow-x-auto">
            {cell.outputs.map((out, i) => (
              <NotebookOutput key={i} output={out} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
