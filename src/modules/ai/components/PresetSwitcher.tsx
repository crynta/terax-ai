import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  Tick02Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AGENT_PRESETS, type AgentPreset } from "../agents/presets";
import { useChatStore } from "../store/chatStore";

export function PresetSwitcher() {
  const activePresetId = useChatStore((s) => s.activePresetId);
  const setActivePresetId = useChatStore((s) => s.setActivePresetId);

  const active = activePresetId
    ? AGENT_PRESETS.find((p) => p.id === activePresetId) ?? null
    : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          className={cn(
            "flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10.5px] transition-colors",
            active
              ? "border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400"
              : "border-border/60 bg-card text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground",
          )}
          title={active ? `Preset: ${active.label}` : "No preset active"}
        >
          {active ? (
            <>
              <span className="text-[11px]">{active.icon}</span>
              <span className="max-w-[5rem] truncate">{active.label}</span>
            </>
          ) : (
            <span className="text-[10.5px]">Preset</span>
          )}
          <HugeiconsIcon icon={ArrowDown01Icon} size={10} strokeWidth={2} className="opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Presets
        </div>
        {AGENT_PRESETS.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-muted-foreground">
            No presets available.
          </div>
        ) : (
          AGENT_PRESETS.map((p) => (
            <PresetItem
              key={p.id}
              preset={p}
              active={p.id === activePresetId}
              onSelect={() => setActivePresetId(p.id === activePresetId ? null : p.id)}
            />
          ))
        )}
        {activePresetId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setActivePresetId(null)}
              className="gap-2 text-[12px] text-muted-foreground"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
              Clear preset
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PresetItem({
  preset,
  active,
  onSelect,
}: {
  preset: AgentPreset;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className={cn(
        "flex items-start gap-2 pr-2 text-[12px]",
        active && "bg-accent/40",
      )}
    >
      <span className="mt-0.5 text-[13px]">{preset.icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{preset.label}</span>
        <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
          {preset.description}
        </span>
      </span>
      {active ? (
        <HugeiconsIcon
          icon={Tick02Icon}
          size={12}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-foreground"
        />
      ) : null}
    </DropdownMenuItem>
  );
}
