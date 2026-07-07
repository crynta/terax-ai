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
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { COMMAND_GROUPS } from "./commands";
import { useCommandHistory } from "./hooks/useCommandHistory";
import {
  CONTENT_SEARCH_MIN_QUERY,
  useContentSearch,
} from "./hooks/useContentSearch";
import { fuzzyBest } from "./lib/fuzzy";
import { MODE_HINTS, parseQuery } from "./lib/mode";
import { mruRank, mruSnapshot, recordUse } from "./lib/mru";
import type { PaletteItem } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: "commands" | "content";
  commandItems: PaletteItem[];
  workspaceRoot: string | null;
  onOpenContentHit: (path: string, line: number) => void;
  insertCommand: ((cmd: string) => void) | null;
};

const SHORTCUTS_BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));
const THEME_PREVIEW_DELAY_MS = 140;

export function CommandPalette({
  open,
  onOpenChange,
  initialMode,
  commandItems,
  workspaceRoot,
  onOpenContentHit,
  insertCommand,
}: Props) {
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");
  const [page, setPage] = useState<"root" | "themes">("root");
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const { themeId, customThemes, setThemeId, previewThemeId } = useTheme();

  const parsed = parseQuery(query);
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

  const mru = useMemo(() => (open ? mruSnapshot() : {}), [open]);

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
      runAfterClose(() => onOpenContentHit(path, line));
    },
    [onOpenContentHit, runAfterClose],
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
    : parsed.mode === "content"
      ? "Find text in files..."
      : parsed.mode === "history"
        ? "Search command history..."
        : "Type a command, > for history, # to find in files";

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
        <ScrollArea className="max-h-[420px]">
          <CommandList className="max-h-none overflow-visible pr-3">
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
                        <img
                          src={fileIconUrl(basename(hit.rel))}
                          alt=""
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
                {MODE_HINTS.map((hint) => (
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
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </ScrollArea>
      </Command>
    </CommandDialog>
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
    const s = fuzzyBest(term, [
      item.title,
      item.group,
      ...(item.keywords ?? []),
    ]);
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
        className={
          tone === "error" ? "text-destructive" : "text-muted-foreground"
        }
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
