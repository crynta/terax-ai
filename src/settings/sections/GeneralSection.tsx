import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ThemePref } from "@/modules/settings/store";
import { MONO_FONT_FAMILIES } from "@/lib/fonts";
import {
  DEFAULT_PREFERENCES,
  EDITOR_THEME_LABELS,
  EDITOR_THEMES,
  TERMINAL_FONT_SIZES,
  TERMINAL_SCROLLBACK_PRESETS,
  resetAllPreferences,
  setAutostart,
  setEditorTheme,
  setRestoreWindowState,
  setSettingsAlwaysOnTop,
  setShowHidden,
  setTerminalFontFamily,
  setTerminalFontSize,
  setTerminalScrollback,
  setTerminalWebglEnabled,
  setVimMode,
} from "@/modules/settings/store";
import { useTheme } from "@/modules/theme";
import {
  ArrowDown01Icon,
  ArrowTurnBackwardIcon,
  ComputerIcon,
  KeyboardIcon,
  Moon02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";
import { Input } from "@/components/ui/input";

const APPEARANCE: {
  id: ThemePref;
  label: string;
  icon: typeof ComputerIcon;
}[] = [
  { id: "system", label: "System", icon: ComputerIcon },
  { id: "light", label: "Light", icon: Sun03Icon },
  { id: "dark", label: "Dark", icon: Moon02Icon },
];

export function GeneralSection() {
  const { theme, setTheme } = useTheme();
  const editorTheme = usePreferencesStore((s) => s.editorTheme);
  const autostart = usePreferencesStore((s) => s.autostart);
  const restoreWindowState = usePreferencesStore((s) => s.restoreWindowState);
  const vimMode = usePreferencesStore((s) => s.vimMode);
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const terminalWebglEnabled = usePreferencesStore(
    (s) => s.terminalWebglEnabled,
  );
  const terminalFontFamily = usePreferencesStore((s) => s.terminalFontFamily);
  const terminalFontSize = usePreferencesStore((s) => s.terminalFontSize);
  const terminalScrollback = usePreferencesStore((s) => s.terminalScrollback);
  const settingsAlwaysOnTop = usePreferencesStore((s) => s.settingsAlwaysOnTop);

  const [manualFont, setManualFont] = useState(() => {
    return (
      terminalFontFamily !== "" &&
      !MONO_FONT_FAMILIES.some((f) => f.value === terminalFontFamily)
    );
  });

  const [manualSize, setManualSize] = useState(() => {
    return !TERMINAL_FONT_SIZES.includes(terminalFontSize as any);
  });

  const [manualScrollback, setManualScrollback] = useState(() => {
    return !TERMINAL_SCROLLBACK_PRESETS.includes(terminalScrollback as any);
  });

  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  // Reconcile autostart pref with the actual OS state on mount — the user may
  // have toggled it from System Settings.
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

  const onPickTerminalFontFamily = (f: string) => void setTerminalFontFamily(f);
  const onPickTerminalFontSize = (f: number) => void setTerminalFontSize(f);
  const onPickTerminalScrollback = (f: number) => void setTerminalScrollback(f);
  const onToggleTerminalWebgl = (v: boolean) => void setTerminalWebglEnabled(v);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <SectionHeader
          title="General"
          description="Appearance, editor, and startup."
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

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label>Appearance</Label>
          <div className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/60 bg-card/40 overflow-hidden">
            <SettingRow
              title="Window behavior"
              description="Keep the settings window on top of other windows."
              onReset={() =>
                void setSettingsAlwaysOnTop(
                  DEFAULT_PREFERENCES.settingsAlwaysOnTop,
                )
              }
            >
              <Switch
                checked={settingsAlwaysOnTop}
                onCheckedChange={(v) => void setSettingsAlwaysOnTop(v)}
              />
            </SettingRow>
            <SettingRow
              title="Manual override"
              description="Force light or dark mode regardless of system settings."
              onReset={() => setTheme(DEFAULT_PREFERENCES.theme)}
            >
              <div className="flex gap-1.5 rounded-full border border-border/80 bg-muted/40 p-0.5">
                {APPEARANCE.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setTheme(a.id)}
                    className={cn(
                      "flex h-7 items-center gap-2 rounded-full px-3 text-[11.5px] font-medium transition-all outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      theme === a.id
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                    )}
                  >
                    <HugeiconsIcon icon={a.icon} size={13} strokeWidth={1.8} />
                    <span>{a.label}</span>
                  </button>
                ))}
              </div>
            </SettingRow>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Editor</Label>
          <div className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/60 bg-card/40 overflow-hidden">
            <SettingRow
              title="Editor theme"
              description="Color scheme for the AI chat and file editor."
              onReset={() =>
                void setEditorTheme(DEFAULT_PREFERENCES.editorTheme)
              }
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-8 justify-between gap-2 rounded-none px-2.5 text-[12px] min-w-[140px]"
                  >
                    <span>{EDITOR_THEME_LABELS[editorTheme]}</span>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      size={12}
                      strokeWidth={2}
                      className="opacity-70"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-[160px] rounded-none border border-border bg-popover p-0 shadow-none ring-0 h-[300px] overflow-y-auto"
                >
                  {EDITOR_THEMES.map((id) => (
                    <DropdownMenuItem
                      key={id}
                      onSelect={() => void setEditorTheme(id)}
                      className={cn(
                        "rounded-none px-3 py-1.5 text-[12px]",
                        id === editorTheme && "bg-accent/50",
                      )}
                    >
                      {EDITOR_THEME_LABELS[id]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </SettingRow>

            <SettingRow
              title="Vim mode"
              description="Enable Vim keybindings in the editor."
              onReset={() => void setVimMode(DEFAULT_PREFERENCES.vimMode)}
            >
              <Switch
                checked={vimMode}
                onCheckedChange={(v) => void setVimMode(v)}
              />
            </SettingRow>

            <SettingRow
              title="Show hidden files"
              description="Include dot-prefixed files and folders (.env, .gitignore) in the explorer."
              onReset={() => void setShowHidden(DEFAULT_PREFERENCES.showHidden)}
            >
              <Switch
                checked={showHidden}
                onCheckedChange={(v) => void setShowHidden(v)}
              />
            </SettingRow>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Terminal</Label>
          <div className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/60 bg-card/40 overflow-hidden">
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
                      <TooltipContent
                        side="top"
                        className="max-w-[260px] text-[11px]"
                      >
                        xterm's WebGL renderer caches glyphs in a GPU texture
                        atlas. On some macOS setups, the atlas corrupts. Turn
                        this off as a fallback.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
              }
              description="Hardware-accelerated rendering. Turn off if text shows corruption."
              onReset={() =>
                void setTerminalWebglEnabled(
                  DEFAULT_PREFERENCES.terminalWebglEnabled,
                )
              }
            >
              <Switch
                checked={terminalWebglEnabled}
                onCheckedChange={onToggleTerminalWebgl}
              />
            </SettingRow>

            <SettingRow
              title="Font family"
              description="Terminal font. Supports CSS fallback chains in manual mode."
              onReset={() => {
                void setTerminalFontFamily(
                  DEFAULT_PREFERENCES.terminalFontFamily,
                );
                setManualFont(false);
              }}
            >
              <div className="flex gap-1.5 flex-1 max-w-[240px] justify-end">
                {!manualFont ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="h-8 flex-1 justify-between gap-2 rounded-none px-2.5 text-[12px] min-w-[140px]"
                      >
                        <span className="truncate">
                          {terminalFontFamily
                            ? (MONO_FONT_FAMILIES.find(
                                (f) => f.value === terminalFontFamily,
                              )?.label ?? terminalFontFamily)
                            : "Default (auto-detected)"}
                        </span>
                        <HugeiconsIcon
                          icon={ArrowDown01Icon}
                          size={12}
                          strokeWidth={2}
                          className="opacity-70 shrink-0"
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-[200px] rounded-none border border-border bg-popover p-0 shadow-none ring-0 max-h-[300px] overflow-y-auto"
                    >
                      {MONO_FONT_FAMILIES.map((f) => (
                        <DropdownMenuItem
                          key={f.value}
                          onSelect={() => onPickTerminalFontFamily(f.value)}
                          className={cn(
                            "rounded-none px-3 py-1.5 text-[12px]",
                            f.value === terminalFontFamily && "bg-accent/50",
                          )}
                        >
                          {f.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Input
                    value={terminalFontFamily}
                    onChange={(e) => onPickTerminalFontFamily(e.target.value)}
                    className="h-8 text-[12px] rounded-none focus-visible:ring-0"
                    placeholder="'JetBrains Mono', monospace"
                  />
                )}
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className={cn(
                          "h-8 w-8 shrink-0 rounded-none",
                          manualFont && "bg-accent",
                        )}
                        onClick={() => setManualFont(!manualFont)}
                      >
                        <HugeiconsIcon
                          icon={KeyboardIcon}
                          size={14}
                          strokeWidth={1.5}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px]">
                      {manualFont
                        ? "Switch to dropdown"
                        : "Type custom font family"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </SettingRow>

            <SettingRow
              title="Font size"
              description="Terminal text size."
              onReset={() => {
                void setTerminalFontSize(DEFAULT_PREFERENCES.terminalFontSize);
                setManualSize(false);
              }}
            >
              <div className="flex gap-1.5 flex-1 max-w-[240px] justify-end">
                {!manualSize ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="h-8 flex-1 justify-between gap-2 rounded-none px-2.5 text-[12px] min-w-[140px]"
                      >
                        <span>{terminalFontSize} px</span>
                        <HugeiconsIcon
                          icon={ArrowDown01Icon}
                          size={12}
                          strokeWidth={2}
                          className="opacity-70"
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-[100px] rounded-none border border-border bg-popover p-0 shadow-none ring-0 h-[200px] overflow-y-auto"
                    >
                      {TERMINAL_FONT_SIZES.map((size) => (
                        <DropdownMenuItem
                          key={size}
                          onSelect={() => onPickTerminalFontSize(size)}
                          className={cn(
                            "rounded-none px-3 py-1.5 text-[12px]",
                            size === terminalFontSize && "bg-accent/50",
                          )}
                        >
                          {size} px
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Input
                    type="number"
                    min={5}
                    max={238}
                    value={terminalFontSize}
                    onChange={(e) =>
                      onPickTerminalFontSize(parseInt(e.target.value, 10) || 5)
                    }
                    className="h-8 text-[12px] rounded-none focus-visible:ring-0 w-full"
                  />
                )}
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className={cn(
                          "h-8 w-8 shrink-0 rounded-none",
                          manualSize && "bg-accent",
                        )}
                        onClick={() => setManualSize(!manualSize)}
                      >
                        <HugeiconsIcon
                          icon={KeyboardIcon}
                          size={14}
                          strokeWidth={1.5}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px]">
                      {manualSize
                        ? "Switch to dropdown"
                        : "Type custom font size"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </SettingRow>

            <SettingRow
              title="Scrollback"
              description="Lines of history per terminal. (~3 KB / line)."
              onReset={() => {
                void setTerminalScrollback(
                  DEFAULT_PREFERENCES.terminalScrollback,
                );
                setManualScrollback(false);
              }}
            >
              <div className="flex gap-1.5 flex-1 max-w-[240px] justify-end">
                {!manualScrollback ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="h-8 flex-1 justify-between gap-2 rounded-none px-2.5 text-[12px] min-w-[140px]"
                      >
                        <span>{terminalScrollback.toLocaleString()} lines</span>
                        <HugeiconsIcon
                          icon={ArrowDown01Icon}
                          size={12}
                          strokeWidth={2}
                          className="opacity-70"
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-[140px] rounded-none border border-border bg-popover p-0 shadow-none ring-0"
                    >
                      {TERMINAL_SCROLLBACK_PRESETS.map((lines) => (
                        <DropdownMenuItem
                          key={lines}
                          onSelect={() => onPickTerminalScrollback(lines)}
                          className={cn(
                            "rounded-none px-3 py-1.5 text-[12px]",
                            lines === terminalScrollback && "bg-accent/50",
                          )}
                        >
                          {lines.toLocaleString()} lines
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Input
                    type="number"
                    min={200}
                    max={50000}
                    value={terminalScrollback}
                    onChange={(e) =>
                      onPickTerminalScrollback(
                        parseInt(e.target.value, 10) || 200,
                      )
                    }
                    className="h-8 text-[12px] rounded-none focus-visible:ring-0 w-full"
                  />
                )}
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className={cn(
                          "h-8 w-8 shrink-0 rounded-none",
                          manualScrollback && "bg-accent",
                        )}
                        onClick={() => setManualScrollback(!manualScrollback)}
                      >
                        <HugeiconsIcon
                          icon={KeyboardIcon}
                          size={14}
                          strokeWidth={1.5}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px]">
                      {manualScrollback
                        ? "Switch to presets"
                        : "Type custom scrollback"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </SettingRow>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Startup</Label>
          <div className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/60 bg-card/40 overflow-hidden">
            <SettingRow
              title="Launch at login"
              description="Open Terax automatically when you sign in."
              onReset={() =>
                void onToggleAutostart(DEFAULT_PREFERENCES.autostart)
              }
            >
              <Switch
                checked={autostart}
                onCheckedChange={(v) => void onToggleAutostart(v)}
              />
            </SettingRow>
            <SettingRow
              title="Restore window position & size"
              description="Reopen the main window where you left it."
              onReset={() =>
                void setRestoreWindowState(
                  DEFAULT_PREFERENCES.restoreWindowState,
                )
              }
            >
              <Switch
                checked={restoreWindowState}
                onCheckedChange={(v) => void setRestoreWindowState(v)}
              />
            </SettingRow>
          </div>
        </div>
      </div>

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert all your preferences—appearance, terminal, and
              startup settings—to their factory defaults.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetAllPreferences();
                setResetDialogOpen(false);
              }}
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

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
