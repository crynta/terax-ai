import FlashIcon from "@hugeicons/core-free-icons/FlashIcon";
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  SidebarPanelBody,
  SidebarPanelFrame,
  SidebarPanelScrollRegion,
} from "@/modules/sidebar";

import { useSkills, type SkillInfo } from "../../agents/useSkills";

type Props = {
  open: boolean;
};

export const SkillBrowser = memo(function SkillBrowser({ open }: Props) {
  const { skills, loading, refresh } = useSkills();
  const [selected, setSelected] = useState<string | null>(null);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  if (!open) return null;

  return (
    <TooltipProvider delayDuration={800} skipDelayDuration={300}>
      <SidebarPanelFrame aria-label="Skills">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 pb-2.5 pt-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <HugeiconsIcon
              icon={FlashIcon}
              size={14}
              strokeWidth={1.75}
              className="text-muted-foreground"
            />
            <span className="text-[11.5px] font-medium text-foreground">
              Skills
            </span>
            {skills.length > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 px-1 text-[9.5px] font-semibold tabular-nums text-muted-foreground">
                {skills.length}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={handleRefresh}>
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    size={14}
                    strokeWidth={1.75}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refresh</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <SidebarPanelBody>
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-8">
              <Spinner className="size-4" />
            </div>
          ) : skills.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <HugeiconsIcon
                icon={FolderOpenIcon}
                size={24}
                strokeWidth={1.5}
                className="text-muted-foreground/50"
              />
              <div className="text-sm font-medium text-muted-foreground">
                No skills found
              </div>
              <div className="max-w-64 text-[11px] leading-relaxed text-muted-foreground/75">
                Add SKILL.md files to your agent skill directories to make them
                available.
              </div>
            </div>
          ) : (
            <SidebarPanelScrollRegion>
              <div className="flex flex-col gap-0.5 p-1.5">
                {skills.map((skill) => (
                  <SkillRow
                    key={skill.name}
                    skill={skill}
                    selected={selected === skill.name}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            </SidebarPanelScrollRegion>
          )}
        </SidebarPanelBody>
      </SidebarPanelFrame>
    </TooltipProvider>
  );
});

function SkillRow({
  skill,
  selected,
  onSelect,
}: {
  skill: SkillInfo;
  selected: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(skill.name)}
      className={cn(
        "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-[background-color] duration-100",
        selected ? "bg-accent/60" : "hover:bg-accent/30",
      )}
    >
      <HugeiconsIcon
        icon={FlashIcon}
        size={12}
        strokeWidth={1.75}
        className="mt-0.5 shrink-0 text-muted-foreground/70"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[12px] font-medium leading-tight text-foreground/95">
          {skill.name}
        </span>
        {skill.description && (
          <span className="line-clamp-2 text-[10.5px] leading-tight text-muted-foreground/75">
            {skill.description}
          </span>
        )}
        <span className="truncate text-[10px] leading-tight text-muted-foreground/50">
          {skill.path}
        </span>
      </div>
    </button>
  );
}
