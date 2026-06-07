import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import SidebarRightIcon from "@hugeicons/core-free-icons/SidebarRightIcon";
import Sun03Icon from "@hugeicons/core-free-icons/Sun03Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ThemePref } from "@/modules/settings/store";
import {
  setAgentNotifications,
  setAutostart,
  setEditorAutoSave,
  setEditorAutoSaveDelay,
  setRestoreWindowState,
  setShowHidden,
  setSidebarPosition,
  setTerminalFontFamily,
  setTerminalFontSize,
  setTerminalLetterSpacing,
  setTerminalScrollback,
  setTerminalWebglEnabled,
  setVimMode,
  setZoomLevel,
  TERMINAL_FONT_SIZES,
  TERMINAL_SCROLLBACK_PRESETS,
} from "@/modules/settings/store";
import type { SidebarPosition } from "@/modules/sidebar/position";
import { useTheme } from "@/modules/theme";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

const APPEARANCE: {
  id: ThemePref;
  label: string;
  icon: typeof ComputerIcon;
}[] = [
  { id: "system", label: "System", icon: ComputerIcon },
  { id: "light", label: "Light", icon: Sun03Icon },
  { id: "dark", label: "Dark", icon: Moon02Icon },
];

const SIDEBAR_POSITION_OPTIONS: {
  id: SidebarPosition;
  label: string;
  icon: typeof SidebarLeftIcon;
}[] = [
  { id: "left", label: "Left", icon: SidebarLeftIcon },
  { id: "right", label: "Right", icon: SidebarRightIcon },
];

const LETTER_SPACINGS = [-4, -3, -2, -1, 0, 1, 2, 3, 4] as const;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.05;
const AUTO_SAVE_STEP = 100;
const AUTO_SAVE_MIN = 100;
const AUTO_SAVE_MAX = 60000;

export function GeneralSection() {
  const { mode, setMode } = useTheme();

  const autostart = usePreferencesStore((s) => s.autostart);
  const restoreWindowState = usePreferencesStore((s) => s.restoreWindowState);
  const vimMode = usePreferencesStore((s) => s.vimMode);
  const editorAutoSave = usePreferencesStore((s) => s.editorAutoSave);
  const editorAutoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const terminalWebglEnabled = usePreferencesStore(
    (s) => s.terminalWebglEnabled,
  );
  const terminalFontFamily = usePreferencesStore((s) => s.terminalFontFamily);
  const terminalLetterSpacing = usePreferencesStore(
    (s) => s.terminalLetterSpacing,
  );
  const terminalFontSize = usePreferencesStore((s) => s.terminalFontSize);
  const terminalScrollback = usePreferencesStore((s) => s.terminalScrollback);
  const zoomLevel = usePreferencesStore((s) => s.zoomLevel);
  const sidebarPosition = usePreferencesStore((s) => s.sidebarPosition);
  const agentNotifications = usePreferencesStore((s) => s.agentNotifications);

  useEffect(() => {
    let alive = true;
    void isEnabled()
      .then((on) => {
        if (!alive) return;
        if (on !== usePreferencesStore.getState().autostart) {
          void setAutostart(on);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const onToggleAutostart = async (next: boolean) => {
    try {
      if (next) await enable();
      else await disable();
      await setAutostart(next);
    } catch (e) {
      console.error("autostart toggle failed", e);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="General" description="Mode, editor, and startup." />

      <div className="flex flex-col gap-2">
        <Label>Appearance</Label>
        <div className="grid grid-cols-3 gap-2">
          {APPEARANCE.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={mode === o.id}
              onClick={() => setMode(o.id)}
              className={cn(
                "group flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border bg-card transition-[background-color,border-color,box-shadow]",
                mode === o.id
                  ? "border-foreground/60 ring-1 ring-foreground/20"
                  : "border-border/60 hover:border-border",
              )}
            >
              <HugeiconsIcon
                icon={o.icon}
                size={18}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="text-[11.5px]">{o.label}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          For theme, background and customization, see the{" "}
          <strong className="font-medium text-foreground">Themes</strong> tab.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Zoom</Label>
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-muted-foreground">
              UI zoom level
            </span>
            <span className="tabular-nums text-[11px] text-muted-foreground">
              {Math.round(zoomLevel * 100)}%
            </span>
          </div>
          <Slider
            aria-label="UI zoom level"
            value={[zoomLevel]}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            onValueChange={(v) => void setZoomLevel(v[0] ?? 1)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Layout</Label>
        <SettingRow
          title="Sidebar position"
          description="Choose which side hosts the Files and Git sidebar."
        >
          <div className="inline-flex rounded-md border border-border/60 bg-card p-0.5">
            {SIDEBAR_POSITION_OPTIONS.map((option) => {
              const active = sidebarPosition === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => void setSidebarPosition(option.id)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[11.5px] transition-colors",
                    active
                      ? "bg-accent text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <HugeiconsIcon
                    icon={option.icon}
                    size={14}
                    strokeWidth={1.75}
                  />
                  {option.label}
                </button>
              );
            })}
          </div>
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Editor</Label>
        <SettingRow
          title="Vim mode"
          description="Enable Vim keybindings in the code editor."
        >
          {({ labelId, descriptionId }) => (
            <Switch
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              checked={vimMode}
              onCheckedChange={(v) => void setVimMode(v)}
            />
          )}
        </SettingRow>
        <SettingRow
          title="Auto save"
          description="Automatically save files after a delay when changes are detected."
        >
          {({ labelId, descriptionId }) => (
            <Switch
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              checked={editorAutoSave}
              onCheckedChange={(v) => void setEditorAutoSave(v)}
            />
          )}
        </SettingRow>
        {editorAutoSave && (
          <AutoSaveDelayInput
            value={editorAutoSaveDelay}
            onChange={(v) => void setEditorAutoSaveDelay(v)}
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Explorer</Label>
        <SettingRow
          title="Show hidden files"
          description="Include dot-prefixed files and folders (.env, .gitignore, .config) in the file explorer and search."
        >
          {({ labelId, descriptionId }) => (
            <Switch
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              checked={showHidden}
              onCheckedChange={(v) => void setShowHidden(v)}
            />
          )}
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Terminal</Label>
        <SettingRow
          title={
            <span className="inline-flex items-center gap-1.5">
              Use WebGL renderer
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="cursor-help text-[11px] text-muted-foreground/70 leading-none"
                      aria-label="More info about WebGL renderer"
                    >
                      ⓘ
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-65 text-[11px]">
                    xterm's WebGL renderer caches glyphs in a GPU texture atlas.
                    On some macOS setups (especially with Nerd Fonts), the atlas
                    corrupts and terminal text becomes unreadable. Turn this off
                    as a fallback - performance dips slightly, but text renders
                    correctly via the DOM renderer.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          }
          description="Hardware-accelerated rendering. Turn off if text shows corruption or blank tiles."
        >
          {({ labelId, descriptionId }) => (
            <Switch
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              checked={terminalWebglEnabled}
              onCheckedChange={(v) => void setTerminalWebglEnabled(v)}
            />
          )}
        </SettingRow>
        <SettingRow
          title="Font family"
          description='Nerd Font name for icons (e.g. "CaskaydiaCove Nerd Font Mono"). Leave blank to auto-detect.'
        >
          {({ labelId, descriptionId }) => (
            <Input
              type="text"
              name="terminal-font-family"
              autoComplete="off"
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              value={terminalFontFamily}
              placeholder="Auto-detect"
              onChange={(e) => void setTerminalFontFamily(e.target.value)}
              className="h-8 w-48 border-border bg-background px-2.5 text-[12px] focus-visible:ring-2"
            />
          )}
        </SettingRow>
        <SettingRow
          title="Letter spacing"
          description="Extra horizontal space between characters (px). Use negative values to tighten Nerd Fonts."
        >
          {({ labelId, descriptionId }) => (
            <Select
              value={String(terminalLetterSpacing)}
              onValueChange={(v) => void setTerminalLetterSpacing(Number(v))}
            >
              <SelectTrigger
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                size="sm"
                className="h-8 w-28 text-[12px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {LETTER_SPACINGS.map((v) => (
                    <SelectItem
                      key={v}
                      value={String(v)}
                      className="text-[12px]"
                    >
                      {v > 0 ? `+${v}` : v} px
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </SettingRow>
        <SettingRow title="Font size" description="Terminal text size.">
          {({ labelId, descriptionId }) => (
            <Select
              value={String(terminalFontSize)}
              onValueChange={(v) => void setTerminalFontSize(Number(v))}
            >
              <SelectTrigger
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                size="sm"
                className="h-8 w-28 text-[12px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {TERMINAL_FONT_SIZES.map((size) => (
                    <SelectItem
                      key={size}
                      value={String(size)}
                      className="text-[12px]"
                    >
                      {size} px
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </SettingRow>
        <SettingRow
          title="Scrollback"
          description="Lines of history kept per terminal. Higher uses more RAM (~3 KB / line)."
        >
          {({ labelId, descriptionId }) => (
            <Select
              value={String(terminalScrollback)}
              onValueChange={(v) => void setTerminalScrollback(Number(v))}
            >
              <SelectTrigger
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                size="sm"
                className="h-8 w-36 text-[12px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {TERMINAL_SCROLLBACK_PRESETS.map((lines) => (
                    <SelectItem
                      key={lines}
                      value={String(lines)}
                      className="text-[12px]"
                    >
                      {lines.toLocaleString()} lines
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Agents</Label>
        <SettingRow
          title="Agent and Pi notifications"
          description="Alert when Claude Code, Codex, Terax, or Pi needs attention, finishes, or fails. Desktop notification when Terax is unfocused, in-app otherwise."
        >
          {({ labelId, descriptionId }) => (
            <Switch
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              checked={agentNotifications}
              onCheckedChange={(v) => void setAgentNotifications(v)}
            />
          )}
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Startup</Label>
        <div className="flex flex-col gap-2">
          <SettingRow
            title="Launch at login"
            description="Open Terax automatically when you sign in."
          >
            {({ labelId, descriptionId }) => (
              <Switch
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                checked={autostart}
                onCheckedChange={(v) => void onToggleAutostart(v)}
              />
            )}
          </SettingRow>
          <SettingRow
            title="Restore window position & size"
            description="Reopen the main window where you left it. Applies on next launch."
          >
            {({ labelId, descriptionId }) => (
              <Switch
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                checked={restoreWindowState}
                onCheckedChange={(v) => void setRestoreWindowState(v)}
              />
            )}
          </SettingRow>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}

function AutoSaveDelayInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(
      AUTO_SAVE_MAX,
      Math.max(AUTO_SAVE_MIN, Math.round(n)),
    );
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <SettingRow
      title="Auto save delay"
      description="Delay before unsaved changes are saved automatically."
    >
      {({ labelId, descriptionId }) => (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            name="editor-auto-save-delay"
            inputMode="numeric"
            autoComplete="off"
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            min={AUTO_SAVE_MIN}
            max={AUTO_SAVE_MAX}
            step={AUTO_SAVE_STEP}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="h-8 w-20 border-border bg-background px-2.5 text-right text-[12px] tabular-nums focus-visible:ring-2 [appearance:textfield] md:text-[12px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-[11px] text-muted-foreground">ms</span>
        </div>
      )}
    </SettingRow>
  );
}
