import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildSharedExtensions } from "@/modules/editor/lib/extensions";
import { EDITOR_THEME_EXT } from "@/modules/editor/lib/themes";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Extension } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import { keymap } from "@codemirror/view";
import { Streamdown } from "streamdown";
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  useNotebookDocument,
  type NotebookDocumentState,
} from "./lib/useNotebookDocument";
import type { NotebookCell } from "./lib/ipynb";

export type NotebookPaneHandle = {
  focus: () => void;
  reload: () => boolean;
  save: () => Promise<void>;
};

type Props = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
};

const markdownComponents = { code: MarkdownCode };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function NotebookCellView({
  cell,
  onSourceChange,
  editorExtensions,
  theme,
}: {
  cell: NotebookCell;
  onSourceChange: (source: string) => void;
  editorExtensions: ReturnType<typeof buildSharedExtensions>;
  theme: Extension;
}) {
  const [editing, setEditing] = useState(false);
  const outputText = cell.outputs
    .map((output) => output.text)
    .filter((text) => text.trim().length > 0);

  return (
    <section
      className="overflow-hidden rounded-md border border-border/60 bg-card"
      onDoubleClick={() => setEditing(true)}
    >
      <div className="flex min-h-8 items-center gap-2 border-b border-border/50 px-3 text-[11px] text-muted-foreground">
        <span className="min-w-14 font-mono">
          {cell.type === "code" ? `[${cell.executionCount ?? " "}]` : ""}
        </span>
        <span className="uppercase tracking-normal">{cell.type}</span>
        {editing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-[11px]"
            onClick={() => setEditing(false)}
          >
            Done
          </Button>
        ) : null}
      </div>

      {editing ? (
        <CodeMirror
          value={cell.source}
          onChange={onSourceChange}
          theme={theme}
          extensions={editorExtensions}
          autoFocus
          basicSetup={{
            lineNumbers: cell.type === "code",
            foldGutter: cell.type === "code",
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            searchKeymap: true,
          }}
          className="min-h-24"
        />
      ) : (
        <div className="px-4 py-3">
          {cell.type === "markdown" ? (
            <Streamdown
              className="select-text prose-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              components={markdownComponents}
            >
              {cell.source || " "}
            </Streamdown>
          ) : (
            <pre
              className={cn(
                "m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[13px] leading-6 text-foreground",
                cell.type === "raw" && "text-muted-foreground",
              )}
            >
              {cell.source}
            </pre>
          )}
        </div>
      )}

      {outputText.length > 0 ? (
        <div className="border-t border-border/50 bg-muted/25 px-4 py-3">
          {outputText.map((text, index) => (
            <pre
              key={`${cell.id}-output-${index}`}
              className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-5 text-muted-foreground"
            >
              {text}
            </pre>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function NotebookBody({
  state,
  setCellSource,
  editorExtensions,
  theme,
}: {
  state: NotebookDocumentState;
  setCellSource: (cellId: string, source: string) => void;
  editorExtensions: ReturnType<typeof buildSharedExtensions>;
  theme: Extension;
}) {
  if (state.status === "loading") {
    return <p className="text-[12px] text-muted-foreground">Loading...</p>;
  }
  if (state.status === "error") {
    return <p className="text-[12px] text-destructive">{state.message}</p>;
  }
  if (state.status === "binary") {
    return (
      <p className="text-[12px] text-muted-foreground">
        Binary file, notebook preview not available.
      </p>
    );
  }
  if (state.status === "toolarge") {
    return (
      <p className="text-[12px] text-muted-foreground">
        File is {formatBytes(state.size)}; limit {formatBytes(state.limit)}.
      </p>
    );
  }

  if (state.document.cells.length === 0) {
    return <p className="text-[12px] text-muted-foreground">Empty notebook.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {state.document.cells.map((cell) => (
        <NotebookCellView
          key={cell.id}
          cell={cell}
          onSourceChange={(source) => setCellSource(cell.id, source)}
          editorExtensions={editorExtensions}
          theme={theme}
        />
      ))}
    </div>
  );
}

export const NotebookPane = forwardRef<NotebookPaneHandle, Props>(
  function NotebookPane({ path, onDirtyChange }, ref) {
    const { state, dirty, setCellSource, save, reload } = useNotebookDocument({
      path,
      onDirtyChange,
    });
    const containerRef = useRef<HTMLDivElement>(null);
    const editorThemeId = usePreferencesStore((s) => s.editorTheme);
    const theme = EDITOR_THEME_EXT[editorThemeId] ?? EDITOR_THEME_EXT.atomone;
    const saveExtension = useMemo(
      () =>
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void save();
              return true;
            },
          },
        ]),
      [save],
    );
    const editorExtensions = useMemo(
      () => [...buildSharedExtensions(), saveExtension],
      [saveExtension],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => containerRef.current?.focus(),
        reload,
        save,
      }),
      [reload, save],
    );

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };

    return (
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/60 bg-background outline-none"
      >
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border/60 px-4">
          <div className="min-w-0 flex-1 truncate text-xs font-medium">
            {basename(path)}
          </div>
          {state.status === "ready" && state.document.languageName ? (
            <span className="text-[11px] text-muted-foreground">
              {state.document.languageName}
            </span>
          ) : null}
          {dirty ? (
            <span className="text-[11px] text-muted-foreground">Unsaved</span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={!dirty}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <NotebookBody
            state={state}
            setCellSource={setCellSource}
            editorExtensions={editorExtensions}
            theme={theme}
          />
        </div>
      </div>
    );
  },
);
