import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
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
import type { ThemePref, VimKeymap } from "@/modules/settings/store";
import {
  ANIMATION_CUSTOM_MAX,
  ANIMATION_CUSTOM_MIN,
  type AnimationSpeed,
  clampTerminalPadding,
  setAgentNotifications,
  setAnimationSpeed,
  setAnimationSpeedCustom,
  setAutostart,
  setCommandDoneToasts,
  setDefaultWorkspaceEnv,
  setExplorerGitDecorations,
  setFailedCommandAi,
  setHoverKeybindHints,
  setNlCommandsEnabled,
  setRestoreWindowState,
  setShowHidden,
  setSidebarDisabled,
  setSidebarStartCollapsed,
  setSmartTabTitles,
  setSshPaletteEnabled,
  setStatusBarDisabled,
  setStatusBarStartCollapsed,
  setStatusBarVisible,
  setTabProgressEnabled,
  setTerminalCursorBlink,
  setTerminalFontFamily,
  setTerminalFontSize,
  setTerminalFontWeight,
  setTerminalLetterSpacing,
  setTerminalPadding,
  setTerminalPaddingSides,
  setTerminalScrollback,
  setTerminalShell,
  setTerminalSuggestAiDelayMs,
  setTerminalSuggestDelayMs,
  setTerminalSuggestEnabled,
  setTerminalSuggestMaxItems,
  setTerminalSuggestMinChars,
  setTerminalWebglEnabled,
  setVimKeymaps,
  setVimMode,
  setZoomLevel,
  TERMINAL_FONT_SIZES,
  TERMINAL_FONT_WEIGHTS,
  TERMINAL_PADDING_MAX,
  TERMINAL_PADDING_MIN,
  TERMINAL_SCROLLBACK_PRESETS,
  TERMINAL_SUGGEST_AI_DELAY_MAX,
  TERMINAL_SUGGEST_AI_DELAY_MIN,
  TERMINAL_SUGGEST_DELAY_MAX,
  TERMINAL_SUGGEST_DELAY_MIN,
  TERMINAL_SUGGEST_MAX_ITEMS_MAX,
  TERMINAL_SUGGEST_MAX_ITEMS_MIN,
  TERMINAL_SUGGEST_MIN_CHARS_MAX,
  TERMINAL_SUGGEST_MIN_CHARS_MIN,
} from "@/modules/settings/store";
import { KbdChip } from "@/modules/shortcuts/KbdChip";
import { useTheme } from "@/modules/theme";
import {
  Add01Icon,
  ComputerIcon,
  Delete02Icon,
  Moon02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";
import { CommittedInput, ShellToolsGroup } from "../components/ShellToolsGroup";

const APPEARANCE: {
  id: ThemePref;
  label: string;
  icon: typeof ComputerIcon;
}[] = [
  { id: "system", label: "System", icon: ComputerIcon },
  { id: "light", label: "Light", icon: Sun03Icon },
  { id: "dark", label: "Dark", icon: Moon02Icon },
];

const ANIMATION_SPEEDS: { value: AnimationSpeed; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "fast", label: "Fast" },
  { value: "normal", label: "Normal" },
  { value: "slow", label: "Slow" },
  { value: "custom", label: "Custom" },
];

const LETTER_SPACINGS = [-4, -3, -2, -1, 0, 1, 2, 3, 4] as const;

type ShellInfo = { name: string; path: string; integrated: boolean };
const SHELL_AUTO = "auto";
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.05;

/** General: appearance mode, zoom, startup and notifications. */
export function GeneralSection() {
  const { mode, setMode } = useTheme();

  const autostart = usePreferencesStore((s) => s.autostart);
  const restoreWindowState = usePreferencesStore((s) => s.restoreWindowState);
  const sidebarStartCollapsed = usePreferencesStore(
    (s) => s.sidebarStartCollapsed,
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const explorerGitDecorations = usePreferencesStore(
    (s) => s.explorerGitDecorations,
  );
  const statusBarStartCollapsed = usePreferencesStore(
    (s) => s.statusBarStartCollapsed,
  );
  const zoomLevel = usePreferencesStore((s) => s.zoomLevel);
  const agentNotifications = usePreferencesStore((s) => s.agentNotifications);
  const commandDoneToasts = usePreferencesStore((s) => s.commandDoneToasts);

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
      <SectionHeader
        title="General"
        description="Mode, terminal, and startup."
      />

      <div className="flex flex-col gap-2">
        <GroupLabel>Appearance</GroupLabel>
        <div className="grid grid-cols-3 gap-2">
          {APPEARANCE.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setMode(o.id)}
              className={cn(
                "group flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border bg-card transition-all",
                mode === o.id
                  ? "border-foreground/60 ring-1 ring-foreground/20"
                  : "border-border/60 hover:border-border",
              )}
            >
              <HugeiconsIcon icon={o.icon} size={18} strokeWidth={1.5} />
              <span className="text-[11.5px]">{o.label}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          For theme, background and customization, see the{" "}
          <strong className="font-medium text-foreground">Themes</strong>{" "}
          section.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel>Zoom</GroupLabel>
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
            value={[zoomLevel]}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            onValueChange={(v) => void setZoomLevel(v[0] ?? 1)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Explorer</Label>
        <SettingRow
          title="Show status bar"
          description="The bottom bar with the workspace path, LSP status and the AI agent button. Also toggled from the command palette or its shortcut."
        >
          <Switch
            checked={statusBarVisible && !statusBarDisabled}
            disabled={statusBarDisabled}
            onCheckedChange={(v) => void setStatusBarVisible(v)}
          />
        </SettingRow>
        <SettingRow
          title="Disable status bar"
          description="Remove the status bar entirely: no reopen controls anywhere and the toggle shortcut is blocked."
        >
          <Switch
            checked={statusBarDisabled}
            onCheckedChange={(v) => void setStatusBarDisabled(v)}
          />
        </SettingRow>
        <SettingRow
          title="Disable sidebar"
          description="Remove the sidebar entirely: the header toggle disappears and the toggle shortcut is blocked."
        >
          <Switch
            checked={sidebarDisabled}
            onCheckedChange={(v) => void setSidebarDisabled(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel>Tabs</GroupLabel>
        <SettingRow
          title="Smart tab titles"
          description="Terminal tabs show the running command or TUI name instead of the folder while something runs."
        >
          <Switch
            checked={smartTabTitles}
            onCheckedChange={(v) => void setSmartTabTitles(v)}
          />
        </SettingRow>
        <SettingRow
          title="Tab progress bar"
          description="Thin progress line on the tab, parsed from command output percentages."
        >
          <Switch
            checked={tabProgressEnabled}
            onCheckedChange={(v) => void setTabProgressEnabled(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel>Motion & hints</GroupLabel>
        <SettingRow
          title="Keybind hints on hover"
          description="Slide the shortcut chip out when hovering icon buttons. Off keeps a plain hover highlight."
        >
          <Switch
            checked={hoverKeybindHints}
            onCheckedChange={(v) => void setHoverKeybindHints(v)}
          />
        </SettingRow>
        <SettingRow
          title="Animation speed"
          description="Speed of interface animations: sidebar, status bar, search field, keybind hints."
        >
          <Select
            value={animationSpeed}
            onValueChange={(v) => void setAnimationSpeed(v as AnimationSpeed)}
          >
            <SelectTrigger
              value={animationSpeed}
              className="h-8 w-28 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANIMATION_SPEEDS.map((s) => (
                <SelectItem
                  key={s.value}
                  value={s.value}
                  className="text-[12px]"
                >
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        {animationSpeed === "custom" && (
          <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11.5px] text-muted-foreground">
                Duration multiplier — higher is slower, 0 disables animations
              </span>
              <span className="tabular-nums text-[11px] text-muted-foreground">
                {animationSpeedCustom.toFixed(2)}×
              </span>
            </div>
            <Slider
              value={[animationSpeedCustom]}
              min={ANIMATION_CUSTOM_MIN}
              max={ANIMATION_CUSTOM_MAX}
              step={0.05}
              onValueChange={(v) => void setAnimationSpeedCustom(v[0] ?? 1)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** File explorer behavior. */
export function ExplorerSettingsSection() {
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const explorerGitDecorations = usePreferencesStore(
    (s) => s.explorerGitDecorations,
  );

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Explorer"
        description="File tree visibility and git decorations."
      />
      <div className="flex flex-col gap-2">
        <SettingRow
          title="Show hidden files"
          description="Include dot-prefixed files and folders (.env, .gitignore, .config) in the file explorer and search."
        >
          <Switch
            checked={showHidden}
            onCheckedChange={(v) => void setShowHidden(v)}
          />
        </SettingRow>
        <SettingRow
          title="Git decorations"
          description="Tint changed files and dim gitignored entries in the file explorer."
        >
          <Switch
            checked={explorerGitDecorations}
            onCheckedChange={(v) => void setExplorerGitDecorations(v)}
          />
        </SettingRow>
      </div>
    </div>
  );
}

/** Integrated terminal: renderer, font, shell. */
export function TerminalSettingsSection() {
  const terminalWebglEnabled = usePreferencesStore(
    (s) => s.terminalWebglEnabled,
  );
  const terminalCursorBlink = usePreferencesStore((s) => s.terminalCursorBlink);
  const terminalFontFamily = usePreferencesStore((s) => s.terminalFontFamily);
  const terminalFontWeight = usePreferencesStore((s) => s.terminalFontWeight);
  const terminalShell = usePreferencesStore((s) => s.terminalShell);
  const defaultWorkspaceEnv = usePreferencesStore((s) => s.defaultWorkspaceEnv);
  const terminalLetterSpacing = usePreferencesStore(
    (s) => s.terminalLetterSpacing,
  );
  const terminalFontSize = usePreferencesStore((s) => s.terminalFontSize);
  const terminalScrollback = usePreferencesStore((s) => s.terminalScrollback);
  const terminalPadding = usePreferencesStore((s) => s.terminalPadding);
  const terminalPaddingSides = usePreferencesStore(
    (s) => s.terminalPaddingSides,
  );
  const sshPaletteEnabled = usePreferencesStore((s) => s.sshPaletteEnabled);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [wslDistros, setWslDistros] = useState<{ name: string }[]>([]);

  useEffect(() => {
    void invoke<ShellInfo[]>("pty_list_shells")
      .then(setShells)
      .catch(() => {});
    void invoke<{ name: string }[]>("wsl_list_distros")
      .then(setWslDistros)
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Terminal"
        description="Renderer, font, shell and scrollback."
      />
      <div className="flex flex-col gap-2">
        <GroupLabel>Shell</GroupLabel>
        <SettingRow
          title="Integrated terminal shell"
          description={
            shells.find((s) => s.path === terminalShell)?.integrated === false
              ? "Command blocks and directory tracking are unavailable for this shell."
              : wslDistros.length > 0
                ? "Shell for the integrated terminal. WSL spaces use the distro login shell. Existing tabs keep their shell."
                : "Shell for new terminal tabs. Existing tabs keep their shell."
          }
        >
          <Select
            value={terminalShell || SHELL_AUTO}
            onValueChange={(v) =>
              void setTerminalShell(v === SHELL_AUTO ? "" : v)
            }
          >
            <SelectTrigger
              value={terminalShell || SHELL_AUTO}
              className="h-8 w-40 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SHELL_AUTO} className="text-[12px]">
                Auto
              </SelectItem>
              {shells.map((s) => (
                <SelectItem key={s.path} value={s.path} className="text-[12px]">
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        {(wslDistros.length > 0 || defaultWorkspaceEnv !== "local") && (
          <SettingRow
            title="Workspace environment"
            description="Where new spaces run, terminal and AI agent alike: Windows or a WSL distro. Existing spaces keep theirs; switch any from the status bar."
          >
            <Select
              value={defaultWorkspaceEnv}
              onValueChange={(v) => void setDefaultWorkspaceEnv(v)}
            >
              <SelectTrigger
                value={defaultWorkspaceEnv}
                className="h-8 w-40 text-[12px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local" className="text-[12px]">
                  Windows
                </SelectItem>
                {wslDistros.map((d) => (
                  <SelectItem
                    key={d.name}
                    value={`wsl:${d.name}`}
                    className="text-[12px]"
                  >
                    WSL: {d.name}
                  </SelectItem>
                ))}
                {defaultWorkspaceEnv.startsWith("wsl:") &&
                  !wslDistros.some(
                    (d) => `wsl:${d.name}` === defaultWorkspaceEnv,
                  ) && (
                    <SelectItem
                      value={defaultWorkspaceEnv}
                      className="text-[12px]"
                    >
                      {defaultWorkspaceEnv.slice("wsl:".length)} (unavailable)
                    </SelectItem>
                  )}
              </SelectContent>
            </Select>
          </SettingRow>
        )}
        <SettingRow
          title="SSH hosts in command palette"
          description="Hosts from ~/.ssh/config as palette entries, including multi-host connect."
        >
          <Switch
            checked={sshPaletteEnabled}
            onCheckedChange={(v) => void setSshPaletteEnabled(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel>Text</GroupLabel>
        <FontFamilyInput
          value={terminalFontFamily}
          onCommit={(v) => void setTerminalFontFamily(v)}
        />
        <SettingRow title="Font size" description="Terminal text size.">
          <Select
            value={String(terminalFontSize)}
            onValueChange={(v) => void setTerminalFontSize(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-28 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
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
        </SettingRow>
        <SettingRow
          title="Font weight"
          description="Thickness of terminal characters"
        >
          <Select
            value={terminalFontWeight}
            onValueChange={(v) => void setTerminalFontWeight(v)}
          >
            <SelectTrigger
              value={terminalFontWeight}
              className="h-8 w-28 text-[12px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_FONT_WEIGHTS.map((w) => (
                <SelectItem
                  key={w.value}
                  value={w.value}
                  className="text-[12px]"
                >
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title="Letter spacing"
          description="Extra horizontal space between characters (px). Use negative values to tighten Nerd Fonts."
        >
          <Select
            value={String(terminalLetterSpacing)}
            onValueChange={(v) => void setTerminalLetterSpacing(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-28 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LETTER_SPACINGS.map((v) => (
                <SelectItem key={v} value={String(v)} className="text-[12px]">
                  {v > 0 ? `+${v}` : v} px
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title="Cursor blinking"
          description="Blink the terminal cursor. Off by default for lower idle CPU, matching VS Code and the macOS terminal."
        >
          <Switch
            checked={terminalCursorBlink}
            onCheckedChange={(v) => void setTerminalCursorBlink(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel>Rendering & buffer</GroupLabel>
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
                    as a fallback — performance dips slightly, but text renders
                    correctly via the DOM renderer.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          }
          description="Hardware-accelerated rendering. Turn off if text shows corruption or blank tiles."
        >
          <Switch
            checked={terminalWebglEnabled}
            onCheckedChange={(v) => void setTerminalWebglEnabled(v)}
          />
        </SettingRow>
        <SettingRow
          title="Scrollback"
          description="Lines of history kept per terminal. Higher uses more RAM (~3 KB / line)."
        >
          <Select
            value={String(terminalScrollback)}
            onValueChange={(v) => void setTerminalScrollback(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-36 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_SCROLLBACK_PRESETS.map((lines) => (
                <SelectItem
                  key={lines}
                  value={String(lines)}
                  className="text-[12px]"
                >
                  {lines.toLocaleString()} lines
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title="Padding"
          description="Gap between the pane edge and the terminal content. 0 is flush; negative values crop the edges."
        >
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Per side
              <Switch
                checked={terminalPaddingSides !== null}
                onCheckedChange={(v) =>
                  void setTerminalPaddingSides(
                    v
                      ? {
                          top: terminalPadding,
                          right: terminalPadding,
                          bottom: terminalPadding,
                          left: terminalPadding,
                        }
                      : null,
                  )
                }
              />
            </label>
            {terminalPaddingSides === null && (
              <PaddingInput
                value={terminalPadding}
                onChange={(v) => void setTerminalPadding(v)}
              />
            )}
          </div>
        </SettingRow>
        {terminalPaddingSides !== null && (
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/60 p-3 sm:grid-cols-4">
            {(["top", "right", "bottom", "left"] as const).map((side) => (
              <div key={side} className="flex flex-col gap-1">
                <span className="text-[10.5px] capitalize text-muted-foreground">
                  {side}
                </span>
                <PaddingInput
                  value={terminalPaddingSides[side]}
                  onChange={(v) =>
                    void setTerminalPaddingSides({
                      ...terminalPaddingSides,
                      [side]: v,
                    })
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}

function FontFamilyInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Commit (and trim) only on blur/Enter so a trailing space can be typed
  // mid-edit, e.g. "JetBrains Mono ".
  const commit = () => {
    const next = draft.trim();
    if (next !== draft) setDraft(next);
    if (next !== value) onCommit(next);
  };

  return (
    <SettingRow
      title="Font family"
      description='Nerd Font name for icons (e.g. "CaskaydiaCove Nerd Font Mono"). Leave blank to auto-detect.'
    >
      <input
        type="text"
        value={draft}
        placeholder="Auto-detect"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-[12px] outline-none focus:border-foreground/40"
      />
    </SettingRow>
  );
}
