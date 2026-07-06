import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { KEY_SEP } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  chromeHideMode,
  clampTerminalPadding,
  type ShellTool,
  setShellTools,
  TERMINAL_FONT_SIZES,
  TERMINAL_FONT_WEIGHTS,
} from "@/modules/settings/store";
import { KbdChip } from "@/modules/shortcuts/KbdChip";
import {
  getBindingTokens,
  type KeyBinding,
  SHORTCUTS,
  type ShortcutId,
} from "@/modules/shortcuts/shortcuts";
import {
  Add01Icon,
  ArrowDown01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { ShortcutRecorder } from "./ShortcutRecorder";

const GLOBAL = "global";

const INPUT_CLASS =
  "h-7 rounded-md border border-border bg-background px-2 text-[12px] outline-none focus:border-foreground/40";

/** Settings for terminal TUIs (nvim, htop, …) that override globals while
 *  they run in the foreground of the focused terminal. */
export function ShellToolsGroup() {
  const tools = usePreferencesStore((s) => s.shellTools);

  const update = (next: ShellTool[]) => void setShellTools(next);

  const patch = (id: string, changes: Partial<ShellTool>) =>
    update(tools.map((t) => (t.id === id ? { ...t, ...changes } : t)));

  const remove = (id: string) => update(tools.filter((t) => t.id !== id));

  const add = () =>
    update([
      ...tools,
      {
        id: `tool-${Date.now().toString(36)}`,
        name: "New tool",
        patterns: [],
        blockShortcuts: true,
      },
    ]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
          Shell tools
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="h-6 gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={add}
        >
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
          Add tool
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        TUIs recognized in the terminal. While one is in the foreground of the
        focused terminal, its settings override the global ones — e.g. app
        keybindings are passed through to nvim instead of being captured.
      </p>
      {tools.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 px-3 py-3 text-[11px] text-muted-foreground">
          No tools configured.
        </p>
      ) : (
        tools.map((tool) => (
          <ToolRow
            key={tool.id}
            tool={tool}
            onPatch={(changes) => patch(tool.id, changes)}
            onRemove={() => remove(tool.id)}
          />
        ))
      )}
    </div>
  );
}

function ToolRow({
  tool,
  onPatch,
  onRemove,
}: {
  tool: ShellTool;
  onPatch: (changes: Partial<ShellTool>) => void;
  onRemove: () => void;
}) {
  const shortcutMode =
    tool.shortcutMode ?? (tool.blockShortcuts ? "none" : "all");
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <CommittedInput
          value={tool.name}
          placeholder="Name"
          className="w-36"
          onCommit={(v) => onPatch({ name: v || "Tool" })}
        />
        <CommittedInput
          value={tool.patterns.join(", ")}
          placeholder="Commands, e.g. nvim, vim"
          className="min-w-0 flex-1"
          title="Command names that activate the tool (argv[0]), comma-separated"
          onCommit={(v) =>
            onPatch({
              patterns: v
                .split(",")
                .map((p) => p.trim().toLowerCase())
                .filter(Boolean),
            })
          }
        />
        <button
          type="button"
          onClick={onRemove}
          title="Remove tool"
          aria-label="Remove tool"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.75} />
        </button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[12px] font-medium">Keybindings</span>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            What happens to app shortcuts while the tool is in the foreground.
          </span>
        </div>
        <Select
          value={shortcutMode}
          onValueChange={(v) =>
            onPatch({
              shortcutMode: v as ShellTool["shortcutMode"],
              // Keep the legacy flag coherent for anything still reading it.
              blockShortcuts: v === "none",
            })
          }
        >
          <SelectTrigger value={shortcutMode} className="h-8 w-40 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[12px]">
              Keep all active
            </SelectItem>
            <SelectItem value="none" className="text-[12px]">
              Pass all to tool
            </SelectItem>
            <SelectItem value="custom" className="text-[12px]">
              Pass selected
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {shortcutMode === "none" && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] font-medium">Keep active</span>
            <span className="text-[10.5px] leading-relaxed text-muted-foreground">
              Exceptions — app shortcuts that still work while the tool runs.
            </span>
          </div>
          <ShortcutsPicker
            selected={tool.allowedShortcuts ?? []}
            emptyLabel="None"
            countLabel="kept"
            onChange={(next) => onPatch({ allowedShortcuts: next })}
          />
        </div>
      )}
      {shortcutMode === "custom" && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] font-medium">Pass to tool</span>
            <span className="text-[10.5px] leading-relaxed text-muted-foreground">
              Only these app shortcuts are handed to the tool.
            </span>
          </div>
          <ShortcutsPicker
            selected={tool.blockedShortcuts ?? []}
            emptyLabel="None"
            countLabel="passed"
            onChange={(next) => onPatch({ blockedShortcuts: next })}
          />
        </div>
      )}
      <RebindSection
        overrides={tool.shortcutOverrides ?? {}}
        onChange={(next) => onPatch({ shortcutOverrides: next })}
      />
      <ChromeHideRow
        title="Status bar"
        description="Hide collapses the bottom bar while the tool runs; Disable also removes the reopen controls and blocks the shortcut."
        value={tool.hideStatusBar}
        onChange={(v) => onPatch({ hideStatusBar: v })}
      />
      <ChromeHideRow
        title="Sidebar"
        description="Hide collapses the sidebar while the tool runs; Disable also removes the header toggle and blocks the shortcut."
        value={tool.hideSidebar}
        onChange={(v) => onPatch({ hideSidebar: v })}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[12px] font-medium">Padding</span>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Inner padding of the terminal while the tool runs.
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Per side
            <Switch
              checked={tool.paddingSides != null}
              onCheckedChange={(v) => {
                const base = tool.padding ?? 0;
                onPatch({
                  paddingSides: v
                    ? { top: base, right: base, bottom: base, left: base }
                    : undefined,
                });
              }}
            />
          </label>
          {tool.paddingSides == null && (
            <CommittedInput
              value={tool.padding != null ? String(tool.padding) : ""}
              placeholder="Global"
              className="w-20 text-right"
              title="Padding in px; negative crops the edges; blank = global"
              onCommit={(v) => {
                if (v === "") {
                  onPatch({ padding: undefined });
                  return;
                }
                const n = Number(v);
                onPatch({
                  padding: Number.isFinite(n)
                    ? clampTerminalPadding(n)
                    : undefined,
                });
              }}
            />
          )}
        </div>
      </div>
      {tool.paddingSides != null && (
        <div className="grid grid-cols-4 gap-2 rounded-md border border-border/40 bg-background/40 p-2">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <div key={side} className="flex flex-col gap-1">
              <span className="text-[10.5px] text-muted-foreground capitalize">
                {side}
              </span>
              <CommittedInput
                value={String(tool.paddingSides?.[side] ?? 0)}
                className="w-full text-right"
                onCommit={(v) => {
                  const n = Number(v);
                  if (!tool.paddingSides || !Number.isFinite(n)) return;
                  onPatch({
                    paddingSides: {
                      ...tool.paddingSides,
                      [side]: clampTerminalPadding(n),
                    },
                  });
                }}
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[12px] font-medium">Cursor blink</span>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Override the global terminal cursor-blink setting for this tool.
          </span>
        </div>
        <Select
          value={tool.cursorBlink ?? GLOBAL}
          onValueChange={(v) =>
            onPatch({
              cursorBlink: v === "on" || v === "off" ? v : undefined,
            })
          }
        >
          <SelectTrigger
            value={tool.cursorBlink ?? GLOBAL}
            className="h-8 w-28 text-[12px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GLOBAL} className="text-[12px]">
              Global
            </SelectItem>
            <SelectItem value="on" className="text-[12px]">
              On
            </SelectItem>
            <SelectItem value="off" className="text-[12px]">
              Off
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[12px] font-medium">Font size</span>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Terminal text size while the tool runs.
          </span>
        </div>
        <Select
          value={tool.fontSize != null ? String(tool.fontSize) : GLOBAL}
          onValueChange={(v) =>
            onPatch({ fontSize: v === GLOBAL ? undefined : Number(v) })
          }
        >
          <SelectTrigger
            value={tool.fontSize != null ? String(tool.fontSize) : GLOBAL}
            className="h-8 w-28 text-[12px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GLOBAL} className="text-[12px]">
              Global
            </SelectItem>
            {TERMINAL_FONT_SIZES.map((size) => (
              <SelectItem
                key={size}
                value={String(size)}
                className="text-[12px]"
              >
                {size} px
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[12px] font-medium">Font family</span>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Leave blank to use the global terminal font.
          </span>
        </div>
        <CommittedInput
          value={tool.fontFamily ?? ""}
          placeholder="Global"
          className="w-44"
          onCommit={(v) => onPatch({ fontFamily: v || undefined })}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[12px] font-medium">Font weight</span>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Thickness of terminal characters while the tool runs.
          </span>
        </div>
        <Select
          value={tool.fontWeight ?? GLOBAL}
          onValueChange={(v) =>
            onPatch({ fontWeight: v === GLOBAL ? undefined : v })
          }
        >
          <SelectTrigger
            value={tool.fontWeight ?? GLOBAL}
            className="h-8 w-28 text-[12px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GLOBAL} className="text-[12px]">
              Global
            </SelectItem>
            {TERMINAL_FONT_WEIGHTS.map((w) => (
              <SelectItem key={w.value} value={w.value} className="text-[12px]">
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** Keep / Hide / Disable select for per-tool app-chrome (status bar, sidebar). */
function ChromeHideRow({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: boolean | "disable" | undefined;
  onChange: (v: boolean | "disable") => void;
}) {
  const mode = chromeHideMode(value);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-[12px] font-medium">{title}</span>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground">
          {description}
        </span>
      </div>
      <Select
        value={mode}
        onValueChange={(v) =>
          onChange(v === "disable" ? "disable" : v === "hide")
        }
      >
        <SelectTrigger value={mode} className="h-8 w-28 text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off" className="text-[12px]">
            Keep
          </SelectItem>
          <SelectItem value="hide" className="text-[12px]">
            Hide
          </SelectItem>
          <SelectItem value="disable" className="text-[12px]">
            Disable
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function bindingLabel(bindings: KeyBinding[] | undefined): string {
  if (!bindings || bindings.length === 0) return "";
  return getBindingTokens(bindings[0]).join(KEY_SEP);
}

function RebindSection({
  overrides,
  onChange,
}: {
  overrides: Partial<Record<ShortcutId, KeyBinding[]>>;
  onChange: (next: Partial<Record<ShortcutId, KeyBinding[]>>) => void;
}) {
  const [recordingFor, setRecordingFor] = useState<ShortcutId | null>(null);
  const entries = Object.entries(overrides) as [ShortcutId, KeyBinding[]][];
  const available = SHORTCUTS.filter((s) => !(s.id in overrides));

  const setOverride = (id: ShortcutId, binding: KeyBinding) => {
    setRecordingFor(null);
    onChange({ ...overrides, [id]: [binding] });
  };

  const remove = (id: ShortcutId) => {
    const next = { ...overrides };
    delete next[id];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[12px] font-medium">Rebind shortcuts</span>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Different key combos for app shortcuts while the tool runs.
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="h-7 gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
              Add rebind
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-72 min-w-64 overflow-y-auto"
          >
            {available.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onSelect={() => setRecordingFor(s.id)}
                className="text-[12px]"
              >
                {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {entries.map(([id, bindings]) => {
        const def = SHORTCUTS.find((s) => s.id === id);
        return (
          <div
            key={id}
            className="flex items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2 py-1.5"
          >
            <span className="min-w-0 flex-1 truncate text-[11.5px]">
              {def?.label ?? id}
            </span>
            {recordingFor === id ? (
              <ShortcutRecorder
                onRecord={(b) => setOverride(id, b)}
                onCancel={() => setRecordingFor(null)}
              />
            ) : (
              <button
                type="button"
                title="Change combo"
                onClick={() => setRecordingFor(id)}
                className="cursor-pointer"
              >
                <KbdChip>{bindingLabel(bindings)}</KbdChip>
              </button>
            )}
            <button
              type="button"
              onClick={() => remove(id)}
              title="Remove rebind"
              aria-label="Remove rebind"
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
            </button>
          </div>
        );
      })}
      {recordingFor && !(recordingFor in overrides) && (
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[11.5px]">
            {SHORTCUTS.find((s) => s.id === recordingFor)?.label}
          </span>
          <ShortcutRecorder
            onRecord={(b) => setOverride(recordingFor, b)}
            onCancel={() => setRecordingFor(null)}
          />
        </div>
      )}
    </div>
  );
}

function ShortcutsPicker({
  selected,
  emptyLabel,
  countLabel,
  onChange,
}: {
  selected: ShortcutId[];
  emptyLabel: string;
  countLabel: string;
  onChange: (next: ShortcutId[]) => void;
}) {
  const toggle = (id: ShortcutId, on: boolean) =>
    onChange(on ? [...selected, id] : selected.filter((s) => s !== id));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {selected.length > 0
            ? `${selected.length} ${countLabel}`
            : emptyLabel}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={11}
            strokeWidth={2}
            className="opacity-70"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 min-w-64 overflow-y-auto"
      >
        {SHORTCUTS.map((s) => (
          <DropdownMenuCheckboxItem
            key={s.id}
            checked={selected.includes(s.id)}
            onCheckedChange={(v) => toggle(s.id, v === true)}
            onSelect={(e) => e.preventDefault()}
            className="text-[12px]"
          >
            {s.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Text input that commits on blur/Enter, so typing doesn't spam the store. */
export function CommittedInput({
  value,
  placeholder,
  className,
  title,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  className?: string;
  title?: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={`${INPUT_CLASS} ${className ?? ""}`}
    />
  );
}
