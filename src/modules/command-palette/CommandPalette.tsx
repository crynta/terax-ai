import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  getBindingTokens,
  SHORTCUTS,
  type KeyBinding,
  type ShortcutId,
} from "@/modules/shortcuts";
import { AlertCircleIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  COMMAND_PALETTE_ACTION_GROUPS,
  type CommandPaletteAction,
} from "./actions";
import {
  COMMAND_PALETTE_FILE_SEARCH_MIN_QUERY_LENGTH,
  useWorkspaceFileSearch,
  type CommandPaletteFileHit,
} from "./useWorkspaceFileSearch";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CommandPaletteAction[];
  workspaceRoot: string | null;
  onOpenFile: (path: string) => void;
};

const SHORTCUTS_BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

export function CommandPalette({
  open,
  onOpenChange,
  actions,
  workspaceRoot,
  onOpenFile,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedValue, setSelectedValue] = useState("");
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const { results, searching, error, reset, retry } = useWorkspaceFileSearch({
    root: workspaceRoot,
    query,
    enabled: open,
  });

  const resetPalette = useCallback(() => {
    setQuery("");
    setSelectedValue("");
    reset();
  }, [reset]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) resetPalette();
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetPalette],
  );

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      document.getElementById("terax-command-palette-input")?.focus();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open]);

  const trimmedQuery = query.trim();
  const showFiles =
    trimmedQuery.length >= COMMAND_PALETTE_FILE_SEARCH_MIN_QUERY_LENGTH;

  const visibleActions = useMemo(
    () => filterActions(actions, trimmedQuery),
    [actions, trimmedQuery],
  );

  const selectableValues = useMemo(() => {
    const actionValues = visibleActions
      .filter((action) => !action.disabledReason)
      .map((action) => actionValue(action));

    if (!showFiles || !workspaceRoot) return actionValues;
    if (error) return [...actionValues, RETRY_VALUE];
    return [
      ...actionValues,
      ...results.map((hit) => fileValue(hit)),
    ];
  }, [error, results, showFiles, visibleActions, workspaceRoot]);

  useEffect(() => {
    if (selectableValues.length === 0) {
      setSelectedValue("");
      return;
    }
    if (!selectableValues.includes(selectedValue)) {
      setSelectedValue(selectableValues[0]);
    }
  }, [selectableValues, selectedValue]);

  const runAfterClose = useCallback(
    (run: () => void) => {
      handleOpenChange(false);
      window.setTimeout(run, 0);
    },
    [handleOpenChange],
  );

  const runAction = useCallback(
    (action: CommandPaletteAction) => {
      if (action.disabledReason) return;
      runAfterClose(action.run);
    },
    [runAfterClose],
  );

  const openFile = useCallback(
    (hit: CommandPaletteFileHit) => {
      runAfterClose(() => onOpenFile(hit.path));
    },
    [onOpenFile, runAfterClose],
  );

  const runSelectedValue = useCallback(
    (value: string) => {
      const action = visibleActions.find((a) => actionValue(a) === value);
      if (action) {
        runAction(action);
        return;
      }
      if (value === RETRY_VALUE) {
        retry();
        return;
      }
      const file = results.find((hit) => fileValue(hit) === value);
      if (file) openFile(file);
    },
    [openFile, results, retry, runAction, visibleActions],
  );

  const onCommandKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Tab") {
        if (selectableValues.length === 0) return;
        e.preventDefault();
        const currentIndex = selectableValues.indexOf(selectedValue);
        const baseIndex = currentIndex === -1 ? 0 : currentIndex;
        const delta = e.shiftKey ? -1 : 1;
        const nextIndex =
          (baseIndex + delta + selectableValues.length) %
          selectableValues.length;
        setSelectedValue(selectableValues[nextIndex]);
        return;
      }

      if (e.key === " " && selectedValue) {
        e.preventDefault();
        runSelectedValue(selectedValue);
      }
    },
    [runSelectedValue, selectableValues, selectedValue],
  );

  const hasVisibleActions = visibleActions.length > 0;
  const hasAnyVisibleContent = hasVisibleActions || showFiles;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command Palette"
      description="Run a command or open a workspace file."
      className="top-1/2 w-[min(680px,calc(100vw-32px))] -translate-y-1/2"
    >
      <Command
        shouldFilter={false}
        loop
        value={selectedValue}
        onValueChange={setSelectedValue}
        onKeyDown={onCommandKeyDown}
      >
        <CommandInput
          id="terax-command-palette-input"
          value={query}
          onValueChange={setQuery}
          placeholder="Run a command or open a file..."
          autoFocus
        />
        <CommandList className="max-h-[420px]">
          {COMMAND_PALETTE_ACTION_GROUPS.map((group) => {
            const groupActions = visibleActions.filter((a) => a.group === group);
            if (groupActions.length === 0) return null;
            return (
              <CommandGroup key={group} heading={group}>
                {groupActions.map((action) => (
                  <ActionItem
                    key={action.id}
                    action={action}
                    shortcutLabel={formatShortcut(
                      action.shortcutId,
                      userShortcuts,
                    )}
                    onRun={() => runAction(action)}
                  />
                ))}
              </CommandGroup>
            );
          })}

          {showFiles ? (
            <CommandGroup heading="Files">
              {!workspaceRoot ? (
                <StatusItem label="No workspace root" />
              ) : error ? (
                <>
                  <StatusItem label="Could not search workspace" tone="error" />
                  <CommandItem
                    value={RETRY_VALUE}
                    onSelect={retry}
                    className="text-[12.5px]"
                  >
                    <HugeiconsIcon
                      icon={Refresh01Icon}
                      size={14}
                      strokeWidth={1.75}
                    />
                    <span>Retry file search</span>
                  </CommandItem>
                </>
              ) : searching && results.length === 0 ? (
                <StatusItem label="Searching..." />
              ) : results.length > 0 ? (
                results.map((hit) => (
                  <CommandItem
                    key={hit.path}
                    value={fileValue(hit)}
                    onSelect={() => openFile(hit)}
                    className="text-[12.5px]"
                  >
                    <img
                      src={fileIconUrl(hit.name)}
                      alt=""
                      className="size-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                    <span className="ml-auto max-w-64 truncate text-[11px] font-normal text-muted-foreground">
                      {hit.rel}
                    </span>
                  </CommandItem>
                ))
              ) : (
                <StatusItem label="No files found" />
              )}
            </CommandGroup>
          ) : null}

          {!hasAnyVisibleContent ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No commands found.
            </div>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

const RETRY_VALUE = "retry-file-search";

function actionValue(action: CommandPaletteAction): string {
  return `action:${action.id}`;
}

function fileValue(hit: CommandPaletteFileHit): string {
  return `file:${hit.path}`;
}

function ActionItem({
  action,
  shortcutLabel,
  onRun,
}: {
  action: CommandPaletteAction;
  shortcutLabel: string | null;
  onRun: () => void;
}) {
  const rightLabel = action.disabledReason ?? shortcutLabel;
  return (
    <CommandItem
      value={actionValue(action)}
      disabled={!!action.disabledReason}
      onSelect={onRun}
      className="text-[12.5px]"
    >
      <HugeiconsIcon
        icon={action.icon}
        size={14}
        strokeWidth={1.75}
        className="text-muted-foreground"
      />
      <span className="truncate">{action.label}</span>
      {rightLabel ? (
        <CommandShortcut
          className={action.disabledReason ? "normal-case tracking-normal" : ""}
        >
          {rightLabel}
        </CommandShortcut>
      ) : null}
    </CommandItem>
  );
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

function filterActions(
  actions: CommandPaletteAction[],
  query: string,
): CommandPaletteAction[] {
  const q = query.toLowerCase();
  if (!q) return actions;
  return actions.filter((action) => {
    const haystack = [action.label, action.group, ...action.keywords]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

function formatShortcut(
  shortcutId: ShortcutId | undefined,
  userShortcuts: Record<ShortcutId, KeyBinding[]>,
): string | null {
  if (!shortcutId) return null;
  const shortcut = SHORTCUTS_BY_ID.get(shortcutId);
  const bindings = userShortcuts[shortcutId] ?? shortcut?.defaultBindings;
  const tokens = getBindingTokens(bindings?.[0]);
  if (tokens.length === 0) return null;
  return tokens.join(" ");
}
