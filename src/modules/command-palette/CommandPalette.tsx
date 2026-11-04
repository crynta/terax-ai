import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { FileIcon } from "@/modules/explorer/FileIcon";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  getBindingTokens,
  SHORTCUTS,
  type KeyBinding,
  type ShortcutId,
} from "@/modules/shortcuts";
import { listBuiltinThemes, useTheme } from "@/modules/theme";
import {
  AlertCircleIcon,
  ArrowTurnBackwardIcon,
  CommandIcon,
  Tick02Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMMAND_GROUPS } from "./commands";
import { useCommandHistory } from "./hooks/useCommandHistory";
import {
  CONTENT_SEARCH_MIN_QUERY,
  useContentSearch,
} from "./hooks/useContentSearch";
import { useFileSearch } from "./hooks/useFileSearch";
import { fuzzyBest } from "./lib/fuzzy";
import { MODE_HINTS, parseQuery } from "./lib/mode";
import { mruRank, mruSnapshot, recordUse } from "./lib/mru";
import {
  boostRecent,
  type FileHit,
  parseFileTarget,
  pathParts,
  recentToHits,
  type Segment,
} from "./lib/quickOpen";
import { recentFiles, recordRecentFile } from "./lib/recentFiles";
import type {
  OpenFileTarget,
  PaletteBase,
  PaletteInitialMode,
  PaletteItem,
} from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: PaletteInitialMode;
  commandItems: PaletteItem[];
  workspaceRoot: string | null;
  onOpenContentHit: (path: string, line: number) => void;
  onOpenFile: (path: string, target: OpenFileTarget) => void;
  insertCommand: ((cmd: string) => void) | null;
};

const SHORTCUTS_BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));
const THEME_PREVIEW_DELAY_MS = 140;
const FILE_RESULT_LIMIT = 50;
const RECENT_DISPLAY_LIMIT = 12;

export function CommandPalette({
  open,
  onOpenChange,
  initialMode,
  commandItems,
  workspaceRoot,
  onOpenContentHit,
  onOpenFile,
  insertCommand,
}: Props) {
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");
  const [page, setPage] = useState<"root" | "themes">("root");
  const [base, setBase] = useState<PaletteBase>("commands");
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const { themeId, customThemes, setThemeId, previewThemeId } = useTheme();

  const parsed = parseQuery(query, base);
  const inThemes = page === "themes";
  const themeFilter = inThemes ? query.trim() : "";

  const content = useContentSearch(
    workspaceRoot,
    parsed.term,
    open && !inThemes && parsed.mode === "content",
  );
  const history = useCommandHistory(
    parsed.term,
    open && !inThemes && parsed.mode === "history",
  );

  const fileTarget = useMemo(
    () => parseFileTarget(parsed.mode === "files" ? parsed.term : ""),
    [parsed.mode, parsed.term],
  );
  const filesActive = open && !inThemes && parsed.mode === "files";
  const files = useFileSearch(
    workspaceRoot,
    fileTarget.query,
    filesActive,
    showHidden,
  );

  const mru = useMemo(() => (open ? mruSnapshot() : {}), [open]);
  const recent = useMemo(
    () => (open && workspaceRoot ? recentFiles(workspaceRoot) : []),
    [open, workspaceRoot],
  );

  const fileRows = useMemo<FileHit[]>(() => {
    if (!filesActive || !workspaceRoot) return [];
    if (!fileTarget.query) {
      return recentToHits(workspaceRoot, recent, RECENT_DISPLAY_LIMIT);
    }
    return boostRecent(files.hits, recent).slice(0, FILE_RESULT_LIMIT);
  }, [filesActive, workspaceRoot, fileTarget.query, recent, files.hits]);

  // The first row is selected whenever the rows change, not only on the next
  // keystroke: results arrive after the query that asked for them.
  const firstFilePath = fileRows[0]?.path;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fileRows re-arms the selection when a new result set lands with the same first file.
  useEffect(() => {
    if (filesActive) setValue(firstFilePath ? `file:${firstFilePath}` : "");
  }, [filesActive, firstFilePath, fileRows]);

  const rankedCommands = useMemo(() => {
    if (inThemes || parsed.mode !== "commands") return [];
    return rankCommands(commandItems, parsed.term, mru);
  }, [commandItems, parsed.term, parsed.mode, inThemes, mru]);

  const themes = useMemo(() => {
    if (!inThemes) return [];
    const all = [...listBuiltinThemes(), ...customThemes];
    const q = themeFilter.toLowerCase();
    if (!q) return all;
    return all
      .map((t) => ({ t, s: fuzzyBest(q, [t.name, t.id]) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => (b.s ?? 0) - (a.s ?? 0))
      .map((x) => x.t);
  }, [inThemes, themeFilter, customThemes]);

  const resetPalette = useCallback(() => {
    setQuery("");
    setValue("");
    setPage("root");
    previewThemeId(null);
  }, [previewThemeId]);

  const openSideRef = useRef(false);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) resetPalette();
      onOpenChange(next);
    },
    [onOpenChange, resetPalette],
  );

  useEffect(() => {
    if (!open) return;
    setQuery(initialMode === "content" ? "#" : "");
    setBase(initialMode === "files" ? "files" : "commands");
    setPage("root");
    const handle = window.setTimeout(() => {
      document.getElementById("terax-command-palette-input")?.focus();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open, initialMode]);

  useEffect(() => {
    if (!inThemes || !value.startsWith("theme:")) return;
    const id = value.slice("theme:".length);
    if (id === "back") return;
    const handle = window.setTimeout(
      () => previewThemeId(id),
      THEME_PREVIEW_DELAY_MS,
    );
    return () => window.clearTimeout(handle);
  }, [value, inThemes, previewThemeId]);

  const runAfterClose = useCallback(
    (fn: () => void) => {
      handleOpenChange(false);
      window.setTimeout(fn, 0);
    },
    [handleOpenChange],
  );

  const enterThemes = useCallback(() => {
    setPage("themes");
    setQuery("");
    setValue("");
  }, []);

  const exitThemes = useCallback(() => {
    previewThemeId(null);
    setPage("root");
    setQuery("");
    setValue("");
  }, [previewThemeId]);

  const runCommand = useCallback(
    (item: PaletteItem) => {
      if (item.disabledReason) return;
      if (item.id === "theme.pick") return enterThemes();
      if (item.id === "search.content") return setQuery("#");
      if (item.id === "history.open") return setQuery(">");
      recordUse(item.id);
      runAfterClose(item.run);
    },
    [enterThemes, runAfterClose],
  );

  const openContent = useCallback(
    (path: string, line: number) => {
      if (workspaceRoot) recordRecentFile(workspaceRoot, path);
      runAfterClose(() => onOpenContentHit(path, line));
    },
    [onOpenContentHit, runAfterClose, workspaceRoot],
  );

  const openFile = useCallback(
    (path: string) => {
      const side = openSideRef.current;
      openSideRef.current = false;
      if (workspaceRoot) recordRecentFile(workspaceRoot, path);
      const target: OpenFileTarget = {};
      if (fileTarget.line !== undefined) target.line = fileTarget.line;
      if (fileTarget.column !== undefined) target.column = fileTarget.column;
      if (side) target.side = true;
      runAfterClose(() => onOpenFile(path, target));
    },
    [fileTarget.line, fileTarget.column, onOpenFile, runAfterClose, workspaceRoot],
  );

  const runHistory = useCallback(
    (cmd: string) => {
      if (!insertCommand) return;
      runAfterClose(() => insertCommand(cmd));
    },
    [insertCommand, runAfterClose],
  );

  const commitTheme = useCallback(
    (id: string) => {
      setThemeId(id);
      handleOpenChange(false);
    },
    [setThemeId, handleOpenChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") openSideRef.current = e.metaKey || e.ctrlKey;
      if (!inThemes) return;
      if (e.key === "Escape" || (e.key === "Backspace" && query.length === 0)) {
        e.preventDefault();
        e.stopPropagation();
        exitThemes();
      }
    },
    [inThemes, query, exitThemes],
  );

  const placeholder = inThemes
    ? "Search themes..."
    : parsed.mode === "files"
      ? "Go to file... (add :line to jump)"
      : parsed.mode === "content"
        ? "Find text in files..."
        : parsed.mode === "history"
          ? "Search command history..."
          : "Type a command, / for files, > for history, # to find in files";

  const showFiles = !inThemes && parsed.mode === "files";

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command Palette"
      description="Run a command, switch theme, or search your workspace."
      className="top-1/2 w-[min(680px,calc(100vw-32px))] -translate-y-1/2"
    >
      <Command
        shouldFilter={false}
        loop
        value={value}
        onValueChange={setValue}
        onKeyDown={onKeyDown}
      >
        <CommandInput
          id="terax-command-palette-input"
          value={query}
          onValueChange={setQuery}
          placeholder={placeholder}
          autoFocus
        />
        <ScrollArea
          className={showFiles ? "h-[372px]" : "max-h-[420px]"}
        >
          <CommandList
            className="max-h-none overflow-visible pr-3"
            onClickCapture={(e) => {
              openSideRef.current = e.metaKey || e.ctrlKey;
            }}
          >
            {inThemes ? (
              <CommandGroup heading="Themes">
                <CommandItem
                  value="theme:back"
                  onSelect={exitThemes}
                  className="text-[12.5px]"
                >
                  <HugeiconsIcon
                    icon={ArrowTurnBackwardIcon}
                    size={14}
                    strokeWidth={1.75}
                  />
                  <span>Back</span>
                </CommandItem>
                {themes.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`theme:${t.id}`}
                    onSelect={() => commitTheme(t.id)}
                    className="text-[12.5px]"
                  >
                    <span className="truncate">{t.name}</span>
                    {t.id === themeId ? (
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        size={14}
                        strokeWidth={2}
                        className="ml-auto text-muted-foreground"
                      />
                    ) : null}
                  </CommandItem>
                ))}
                {themes.length === 0 ? <StatusItem label="No themes" /> : null}
              </CommandGroup>
            ) : parsed.mode === "commands" ? (
              rankedCommands.length === 0 ? (
                <EmptyHint />
              ) : (
                COMMAND_GROUPS.map((group) => {
                  const rows = rankedCommands.filter((a) => a.group === group);
                  if (rows.length === 0) return null;
                  return (
                    <CommandGroup key={group} heading={group}>
                      {rows.map((item) => (
                        <ActionItem
                          key={item.id}
                          item={item}
                          shortcutLabel={formatShortcut(
                            item.shortcutId,
                            userShortcuts,
                          )}
                          onRun={() => runCommand(item)}
                        />
                      ))}
                    </CommandGroup>
                  );
                })
              )
            ) : parsed.mode === "files" ? (
              <FilesBody
                hasRoot={!!workspaceRoot}
                query={fileTarget.query}
                rows={fileRows}
                search={files}
                line={fileTarget.line}
                column={fileTarget.column}
                onOpen={openFile}
              />
            ) : parsed.mode === "content" ? (
              <CommandGroup heading="Contents">
                {!workspaceRoot ? (
                  <StatusItem label="No workspace root" />
                ) : parsed.term.length < CONTENT_SEARCH_MIN_QUERY ? (
                  <StatusItem label="Type at least 2 characters" />
                ) : (
                  <AsyncBody
                    loading={content.loading}
                    error={content.error}
                    empty={content.results.length === 0}
                    emptyLabel="No matches"
                    onRetry={content.retry}
                  >
                    {content.results.map((hit) => (
                      <CommandItem
                        key={`${hit.path}:${hit.line}`}
                        value={`content:${hit.path}:${hit.line}`}
                        onSelect={() => openContent(hit.path, hit.line)}
                        className="text-[12.5px]"
                      >
                        <FileIcon
                          name={basename(hit.rel)}
                          className="size-4 shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                          {hit.text.trim()}
                        </span>
                        <span className="ml-auto max-w-64 shrink-0 truncate text-[11px] font-normal text-muted-foreground">
                          {hit.rel}:{hit.line}
                        </span>
                      </CommandItem>
                    ))}
                  </AsyncBody>
                )}
              </CommandGroup>
            ) : parsed.mode === "history" ? (
              <CommandGroup heading="Command history">
                {!insertCommand ? (
                  <StatusItem label="Open a terminal to run history" />
                ) : (
                  <AsyncBody
                    loading={history.loading}
                    error={history.error}
                    empty={history.results.length === 0}
                    emptyLabel="No history"
                    onRetry={history.retry}
                  >
                    {history.results.map((cmd) => (
                      <CommandItem
                        key={`hist:${cmd}`}
                        value={`hist:${cmd}`}
                        onSelect={() => runHistory(cmd)}
                        className="text-[12.5px]"
                      >
                        <HugeiconsIcon
                          icon={TerminalIcon}
                          size={14}
                          strokeWidth={1.75}
                          className="text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                          {cmd}
                        </span>
                      </CommandItem>
                    ))}
                  </AsyncBody>
                )}
              </CommandGroup>
            ) : (
              <CommandGroup heading="Search modes">
                {MODE_HINTS.filter((hint) => hint.bases.includes(base)).map(
                  (hint) => (
                  <CommandItem
                    key={hint.sigil}
                    value={`hint:${hint.sigil}`}
                    onSelect={() => setQuery(hint.sigil)}
                    className="text-[12.5px]"
                  >
                    <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {hint.sigil}
                    </kbd>
                    <span>{hint.label}</span>
                  </CommandItem>
                  ),
                )}
              </CommandGroup>
            )}
          </CommandList>
        </ScrollArea>
        {showFiles ? <FilesFooter /> : null}
      </Command>
    </CommandDialog>
  );
}

function FilesBody({
  hasRoot,
  query,
  rows,
  search,
  line,
  column,
  onOpen,
}: {
  hasRoot: boolean;
  query: string;
  rows: FileHit[];
  search: { loading: boolean; error: string | null; retry: () => void };
  line?: number;
  column?: number;
  onOpen: (path: string) => void;
}) {
  if (!hasRoot) {
    return (
      <CommandGroup heading="Files">
        <StatusItem label="Open a folder to search its files" />
      </CommandGroup>
    );
  }
  if (!query) {
    return (
      <CommandGroup heading={rows.length > 0 ? "Recent files" : "Files"}>
        {rows.length === 0 ? (
          <StatusItem label="Type a file name" />
        ) : (
          rows.map((hit) => (
            <FileRow
              key={hit.path}
              hit={hit}
              line={line}
              column={column}
              onOpen={onOpen}
            />
          ))
        )}
      </CommandGroup>
    );
  }
  return (
    <CommandGroup heading="Files">
      <AsyncBody
        loading={search.loading}
        error={search.error}
        empty={rows.length === 0}
        emptyLabel="No matching files"
        onRetry={search.retry}
      >
        {rows.map((hit) => (
          <FileRow
            key={hit.path}
            hit={hit}
            line={line}
            column={column}
            onOpen={onOpen}
          />
        ))}
      </AsyncBody>
    </CommandGroup>
  );
}

const FileRow = memo(function FileRow({
  hit,
  line,
  column,
  onOpen,
}: {
  hit: FileHit;
  line?: number;
  column?: number;
  onOpen: (path: string) => void;
}) {
  const parts = useMemo(
    () => pathParts(hit.rel, hit.indices),
    [hit.rel, hit.indices],
  );
  return (
    <CommandItem
      value={`file:${hit.path}`}
      onSelect={() => onOpen(hit.path)}
      className="h-9 gap-2.5 py-0 text-[12.5px]"
    >
      <FileIcon name={hit.name} className="size-4 shrink-0" />
      <span className="max-w-[65%] shrink-0 truncate">
        <Marked
          segments={parts.name}
          plain="text-foreground/85"
          marked="font-semibold text-foreground"
        />
      </span>
      {parts.dir.length > 0 ? (
        <span className="min-w-0 flex-1 truncate text-[11px] font-normal text-muted-foreground">
          <Marked
            segments={parts.dir}
            plain=""
            marked="font-medium text-foreground/90"
          />
        </span>
      ) : null}
      {line !== undefined ? (
        <CommandShortcut className="font-mono tracking-normal">
          :{line}
          {column !== undefined ? `:${column}` : ""}
        </CommandShortcut>
      ) : null}
    </CommandItem>
  );
});

function Marked({
  segments,
  plain,
  marked,
}: {
  segments: Segment[];
  plain: string;
  marked: string;
}) {
  return (
    <>
      {segments.map((seg, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reordered.
        <span key={i} className={cn(seg.hit ? marked : plain)}>
          {seg.text}
        </span>
      ))}
    </>
  );
}

function FilesFooter() {
  return (
    <div className="flex h-8 shrink-0 items-center gap-4 border-t border-border/50 px-4 text-[11px] text-muted-foreground">
      <FooterHint keys="↑↓" label="navigate" />
      <FooterHint keys="↵" label="open" />
      <FooterHint keys=":42" label="go to line" />
    </div>
  );
}

function FooterHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px]">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

function rankCommands(
  items: PaletteItem[],
  term: string,
  mru: Record<string, number>,
): PaletteItem[] {
  if (!term) {
    return [...items].sort((a, b) => mruRank(mru, b.id) - mruRank(mru, a.id));
  }
  const scored: { item: PaletteItem; s: number }[] = [];
  for (const item of items) {
    const s = fuzzyBest(term, [item.title, item.group, ...(item.keywords ?? [])]);
    if (s !== null) scored.push({ item, s });
  }
  scored.sort(
    (a, b) => b.s - a.s || mruRank(mru, b.item.id) - mruRank(mru, a.item.id),
  );
  return scored.map((x) => x.item);
}

function ActionItem({
  item,
  shortcutLabel,
  onRun,
}: {
  item: PaletteItem;
  shortcutLabel: string | null;
  onRun: () => void;
}) {
  const rightLabel = item.disabledReason ?? item.trailing ?? shortcutLabel;
  return (
    <CommandItem
      value={`cmd:${item.id}`}
      disabled={!!item.disabledReason}
      onSelect={onRun}
      className="text-[12.5px]"
    >
      {item.icon ? (
        <HugeiconsIcon
          icon={item.icon}
          size={14}
          strokeWidth={1.75}
          className="text-muted-foreground"
        />
      ) : null}
      <span className="truncate">{item.title}</span>
      {rightLabel ? (
        <CommandShortcut
          className={item.disabledReason ? "normal-case tracking-normal" : ""}
        >
          {rightLabel}
        </CommandShortcut>
      ) : null}
    </CommandItem>
  );
}

function AsyncBody({
  loading,
  error,
  empty,
  emptyLabel,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyLabel: string;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (error) {
    return (
      <>
        <StatusItem label="Search failed" tone="error" />
        <CommandItem value="retry" onSelect={onRetry} className="text-[12.5px]">
          <span>Retry</span>
        </CommandItem>
      </>
    );
  }
  if (empty && loading) return <StatusItem label="Searching..." />;
  if (empty) return <StatusItem label={emptyLabel} />;
  return <>{children}</>;
}

function StatusItem({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "error";
}) {
  return (
    <CommandItem
      value={`status:${label}`}
      disabled
      className="text-[12.5px] font-normal"
    >
      {tone === "error" ? (
        <HugeiconsIcon
          icon={AlertCircleIcon}
          size={14}
          strokeWidth={1.75}
          className="text-destructive"
        />
      ) : null}
      <span
        className={tone === "error" ? "text-destructive" : "text-muted-foreground"}
      >
        {label}
      </span>
    </CommandItem>
  );
}

function EmptyHint() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
      <HugeiconsIcon icon={CommandIcon} size={18} strokeWidth={1.5} />
      <span>No commands found. Type ? to see search modes.</span>
    </div>
  );
}

function basename(rel: string): string {
  const parts = rel.split(/[\\/]/);
  return parts[parts.length - 1] || rel;
}

function formatShortcut(
  shortcutId: ShortcutId | undefined,
  userShortcuts: Record<ShortcutId, KeyBinding[]>,
): string | null {
  if (!shortcutId) return null;
  const shortcut = SHORTCUTS_BY_ID.get(shortcutId);
  const bindings = userShortcuts[shortcutId] ?? shortcut?.defaultBindings;
  const tokens = getBindingTokens(bindings?.[0]);
  return tokens.length ? tokens.join(" ") : null;
}
