import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setShortcuts } from "@/modules/settings/store";
import {
  getBindingTokens,
  type KeyBinding,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type Shortcut,
  type ShortcutId,
} from "@/modules/shortcuts/shortcuts";
import {
  ArrowTurnBackwardIcon,
  Delete02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

export function ShortcutsSection() {
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const [search, setSearch] = useState("");
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const filteredShortcuts = useMemo(() => {
    // Filter out internal/non-overridable shortcuts like tab.selectByIndex.
    const base = SHORTCUTS.filter((s) => s.id !== "tab.selectByIndex");
    if (!search) return base;
    const lower = search.toLowerCase();
    return base.filter(
      (s) =>
        s.label.toLowerCase().includes(lower) ||
        s.group.toLowerCase().includes(lower),
    );
  }, [search]);

  const onRecord = (id: ShortcutId, binding: KeyBinding) => {
    const next = { ...userShortcuts, [id]: [binding] };
    void setShortcuts(next);
    setRecordingId(null);
  };

  const onClear = (id: ShortcutId) => {
    const next = { ...userShortcuts, [id]: [] };
    void setShortcuts(next);
  };

  const onResetShortcut = (id: ShortcutId) => {
    const next = { ...userShortcuts };
    delete next[id];
    void setShortcuts(next);
  };

  const onResetAll = () => {
    void setShortcuts({});
    setResetDialogOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <SectionHeader
          title="Shortcuts"
          description="View and customize keyboard shortcuts."
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-[11px]"
          onClick={() => setResetDialogOpen(true)}
        >
          <HugeiconsIcon
            icon={ArrowTurnBackwardIcon}
            size={12}
            strokeWidth={2}
          />
          Reset All
        </Button>
      </div>

      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          size={14}
          strokeWidth={2}
          className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Search shortcuts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 pl-9 text-[12.5px]"
        />
      </div>

      <div className="flex flex-col gap-8">
        {SHORTCUT_GROUPS.map((group) => {
          const items = filteredShortcuts.filter((s) => s.group === group);
          if (items.length === 0) return null;

          return (
            <div key={group} className="flex flex-col gap-3">
              <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {group}
              </h3>
              <div className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/60 bg-card/40 overflow-hidden">
                {items.map((s) => (
                  <ShortcutRow
                    key={s.id}
                    shortcut={s}
                    isRecording={recordingId === s.id}
                    onStartRecording={() => setRecordingId(s.id)}
                    onStopRecording={() => setRecordingId(null)}
                    onRecord={(b) => onRecord(s.id, b)}
                    onClear={() => onClear(s.id)}
                    onReset={() => onResetShortcut(s.id)}
                    userBindings={userShortcuts[s.id]}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all shortcuts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert all your custom keyboard shortcuts to their
              factory defaults. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onResetAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reset All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ShortcutRow({
  shortcut,
  isRecording,
  onStartRecording,
  onStopRecording,
  onRecord,
  onClear,
  onReset,
  userBindings,
}: {
  shortcut: Shortcut;
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onRecord: (b: KeyBinding) => void;
  onClear: () => void;
  onReset: () => void;
  userBindings?: KeyBinding[];
}) {
  const bindings =
    userBindings !== undefined ? userBindings : shortcut.defaultBindings;
  const isModified = userBindings !== undefined;
  const tokens = getBindingTokens(bindings[0]);

  const recordKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isRecording) return;
    // Tab still moves focus, which cancels recording.
    if (
      event.key === "Tab" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      onStopRecording();
      return;
    }
    if (
      event.repeat ||
      event.nativeEvent.isComposing ||
      ["Control", "Shift", "Alt", "AltGraph", "Meta", "Dead"].includes(
        event.key,
      )
    )
      return;
    // Shift alone is fine for navigation keys, but must not swallow typing.
    if (
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      (!event.shiftKey || event.key.length === 1)
    )
      return;
    onRecord({
      key: event.key,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
    });
  };

  return (
    <div className="group flex items-center justify-between px-3 py-2.5 transition-colors hover:bg-muted/30">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-medium">{shortcut.label}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={
            isRecording
              ? `Recording shortcut for ${shortcut.label}. Press Escape to cancel.`
              : `Change shortcut for ${shortcut.label} (${tokens.join(" + ") || "Unassigned"})`
          }
          onClick={(event) => {
            if (isRecording) {
              onStopRecording();
            } else {
              event.currentTarget.focus();
              onStartRecording();
            }
          }}
          onBlur={isRecording ? onStopRecording : undefined}
          onKeyDown={recordKey}
          className="flex min-w-[100px] cursor-pointer items-center justify-end gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {isRecording ? (
            <span className="flex items-center gap-2 rounded bg-accent/50 px-2 py-1 text-[11px] ring-1 ring-accent">
              <span className="font-medium motion-safe:animate-pulse">
                Recording...
              </span>
              <span className="text-muted-foreground">(Esc to cancel)</span>
            </span>
          ) : tokens.length > 0 ? (
            <KbdGroup>
              {tokens.map((t) => (
                <Kbd
                  key={t}
                  className="group-hover:bg-accent group-hover:text-accent-foreground transition-colors"
                >
                  {t}
                </Kbd>
              ))}
            </KbdGroup>
          ) : (
            <span className="text-[11px] text-muted-foreground italic">
              Unassigned
            </span>
          )}
        </button>

        {!isRecording && (
          <div className="flex items-center gap-1">
            {isModified && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={onReset}
                aria-label={`Reset shortcut for ${shortcut.label}`}
                title="Reset to default"
              >
                <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={12} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              onClick={onClear}
              aria-label={`Clear shortcut for ${shortcut.label}`}
              title="Clear shortcut"
            >
              <HugeiconsIcon icon={Delete02Icon} size={12} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
