import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ThemePref } from "@/modules/settings/store";
import {
  EDITOR_THEME_LABELS,
  EDITOR_THEMES,
  setAutostart,
  setEditorTheme,
  setRestoreWindowState,
  setTerminalFontSize,
  setTerminalWebglEnabled,
  setVimMode,
  type EditorThemeId,
} from "@/modules/settings/store";
import { useTheme } from "@/modules/theme";
import {
  ArrowDown01Icon,
  ComputerIcon,
  Moon02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

const TERMINAL_FONT_SIZE_MIN = 8;
const TERMINAL_FONT_SIZE_MAX = 32;

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
  const terminalWebglEnabled = usePreferencesStore(
    (s) => s.terminalWebglEnabled,
  );
  const terminalFontSize = usePreferencesStore((s) => s.terminalFontSize);
  const [isEditingTerminalFontSize, setIsEditingTerminalFontSize] =
    useState(false);
  const [terminalFontSizeDraft, setTerminalFontSizeDraft] = useState(() =>
    String(terminalFontSize),
  );

  useEffect(() => {
    if (isEditingTerminalFontSize) return;
    setTerminalFontSizeDraft(String(terminalFontSize));
  }, [isEditingTerminalFontSize, terminalFontSize]);

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

  const onPickEditor = (id: EditorThemeId) => void setEditorTheme(id);

  const onToggleTerminalWebgl = (next: boolean) => {
    void setTerminalWebglEnabled(next).catch((e) => {
      console.error("terminal WebGL preference update failed", e);
    });
  };

  const onTerminalFontSizeChange = (value: string) => {
    setTerminalFontSizeDraft(value);

    const fontSize = Number(value);
    if (
      !Number.isFinite(fontSize) ||
      fontSize < TERMINAL_FONT_SIZE_MIN ||
      fontSize > TERMINAL_FONT_SIZE_MAX
    ) {
      return;
    }

    void setTerminalFontSize(Math.round(fontSize)).catch((e) => {
      console.error("terminal font size preference update failed", e);
    });
  };

  const commitTerminalFontSize = () => {
    const fontSize = Number(terminalFontSizeDraft);
    if (
      !Number.isFinite(fontSize) ||
      fontSize < TERMINAL_FONT_SIZE_MIN ||
      fontSize > TERMINAL_FONT_SIZE_MAX
    ) {
      setTerminalFontSizeDraft(String(terminalFontSize));
      setIsEditingTerminalFontSize(false);
      return;
    }

    const nextFontSize = Math.round(fontSize);
    void setTerminalFontSize(nextFontSize).catch((e) => {
      console.error("terminal font size preference update failed", e);
    });
    setTerminalFontSizeDraft(String(nextFontSize));
    setIsEditingTerminalFontSize(false);
  };

  const onTerminalFontSizeKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key !== "Enter") return;
    commitTerminalFontSize();
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="General"
        description="Appearance, editor, and startup."
      />

      <div className="flex flex-col gap-2">
        <Label>Appearance</Label>
        <div className="grid grid-cols-3 gap-2">
          {APPEARANCE.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setTheme(o.id)}
              className={cn(
                "group flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border bg-card transition-all",
                theme === o.id
                  ? "border-foreground/60 ring-1 ring-foreground/20"
                  : "border-border/60 hover:border-border",
              )}
            >
              <HugeiconsIcon icon={o.icon} size={18} strokeWidth={1.5} />
              <span className="text-[11.5px]">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Editor theme</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 justify-between gap-2 px-2.5 text-[12px]"
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
          <DropdownMenuContent align="start" className="min-w-[220px]">
            {EDITOR_THEMES.map((t) => (
              <DropdownMenuItem
                key={t}
                onSelect={() => onPickEditor(t)}
                className={cn(
                  "text-[12px]",
                  t === editorTheme && "bg-accent/50",
                )}
              >
                {EDITOR_THEME_LABELS[t]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <SettingRow
          title="Vim mode"
          description="Enable Vim keybindings in the code editor."
        >
          <Switch
            checked={vimMode}
            onCheckedChange={(v) => void setVimMode(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Terminal</Label>
        <SettingRow
          title="Use WebGL renderer"
          description="Accelerates terminal rendering using your GPU. Turn off if terminal text flickers, appears blurry, or causes graphics issues. Applies to new terminal sessions."
        >
          <Switch
            checked={terminalWebglEnabled}
            onCheckedChange={onToggleTerminalWebgl}
          />
        </SettingRow>
        <SettingRow
          title="Font size"
          description="Set terminal text size in pixels. Applies to new terminal sessions."
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={TERMINAL_FONT_SIZE_MIN}
              max={TERMINAL_FONT_SIZE_MAX}
              step={1}
              value={terminalFontSizeDraft}
              onFocus={() => setIsEditingTerminalFontSize(true)}
              onChange={(e) => onTerminalFontSizeChange(e.currentTarget.value)}
              onBlur={commitTerminalFontSize}
              onKeyDown={onTerminalFontSizeKeyDown}
              className="h-8 w-16 rounded-lg px-2 text-center text-[12px]"
            />
            <span className="text-[11px] text-muted-foreground">px</span>
          </div>
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Startup</Label>
        <div className="flex flex-col gap-2">
          <SettingRow
            title="Launch at login"
            description="Open Terax automatically when you sign in."
          >
            <Switch
              checked={autostart}
              onCheckedChange={(v) => void onToggleAutostart(v)}
            />
          </SettingRow>
          <SettingRow
            title="Restore window position & size"
            description="Reopen the main window where you left it. Applies on next launch."
          >
            <Switch
              checked={restoreWindowState}
              onCheckedChange={(v) => void setRestoreWindowState(v)}
            />
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
