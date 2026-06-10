import { useMemo } from "react";
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import CheckmarkCircle01Icon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  PiSection,
  type PiSectionShellProps,
} from "@/modules/pi/components/PiSection";
import type { PiSkillInfo, PiSkillsStatus } from "@/modules/pi/lib/native";
import type { PiSkillsMode } from "@/modules/settings/store";

export type { PiSkillsMode };

export type PiSkillsCardProps = PiSectionShellProps & {
  status: PiSkillsStatus | null;
  error: string | null;
  profileMode: boolean;
  skillsMode: PiSkillsMode;
  selectedSkills: string[];
  onRefresh: () => void;
  onSkillsModeChange: (mode: PiSkillsMode) => void;
  onSelectedSkillsChange: (paths: string[]) => void;
};

function scopeLabel(skill: PiSkillInfo): string {
  return skill.scope === "user" ? "User" : "Project";
}

function SkillRow({
  skill,
  selectable,
  selected,
  onToggle,
}: {
  skill: PiSkillInfo;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const hasWarnings = skill.warnings.length > 0;
  return (
    <div className="rounded-lg border border-border/35 bg-card/55 px-2.5 py-2">
      <div className="flex min-w-0 items-start gap-1.5">
        {selectable ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="mt-0.75 h-3 w-3 shrink-0 accent-primary"
            aria-label={`Enable ${skill.name}`}
          />
        ) : (
          <HugeiconsIcon
            icon={hasWarnings ? Alert02Icon : CheckmarkCircle01Icon}
            size={12}
            strokeWidth={1.85}
            className={cn(
              "mt-0.5 shrink-0",
              hasWarnings ? "text-destructive" : "text-muted-foreground",
            )}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-[10.5px] font-medium text-foreground">
              {skill.name || "unnamed-skill"}
            </span>
            <Badge
              variant="outline"
              className="h-4 shrink-0 rounded-md px-1 text-[9px] text-muted-foreground"
            >
              {scopeLabel(skill)}
            </Badge>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
            {skill.description || skill.preview || "No description provided."}
          </div>
          {skill.warnings.length > 0 ? (
            <div className="mt-1 flex flex-col gap-0.5 text-[10px] leading-snug text-destructive">
              {skill.warnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}
          <div className="mt-1 truncate font-mono text-[9.5px] text-muted-foreground/65">
            {skill.path}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PiSkillsCard({
  collapsed,
  disabled,
  error,
  refreshing,
  profileMode,
  selectedSkills,
  skillsMode,
  status,
  onCollapsedChange,
  onRefresh,
  onSelectedSkillsChange,
  onSkillsModeChange,
}: PiSkillsCardProps) {
  const { validCount, warningCount, validatedPaths } = useMemo(() => {
    const skills = status?.skills ?? [];
    let vc = 0;
    let wc = 0;
    const paths = new Set<string>();
    for (const skill of skills) {
      if (skill.warnings.length === 0) {
        vc += 1;
        paths.add(skill.path);
      } else {
        wc += 1;
      }
    }
    return { validCount: vc, warningCount: wc, validatedPaths: paths };
  }, [status?.skills]);
  const activeSkillCount =
    skillsMode === "project"
      ? validCount
      : skillsMode === "selected"
        ? selectedSkills.filter((p) => validatedPaths.has(p)).length
        : 0;
  const skillCount = status?.skills.length ?? 0;
  const rootWarnings = status?.roots.filter((root) => root.warning).length ?? 0;
  const needsReview =
    Boolean(error) || warningCount > 0 || rootWarnings > 0 || status?.truncated;

  return (
    <PiSection
      title="Skills"
      collapsed={collapsed}
      summary={
        <Badge
          variant={needsReview ? "outline" : "secondary"}
          className="h-4 gap-1 rounded-md px-1.5 text-[9.5px] text-muted-foreground"
        >
          {skillCount} found
        </Badge>
      }
      actions={
        <Button
          size="xs"
          variant="ghost"
          className="h-5 rounded-md px-1.5 text-[10px]"
          disabled={disabled}
          onClick={onRefresh}
        >
          {refreshing ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <HugeiconsIcon
              data-icon="inline-start"
              icon={Refresh01Icon}
              strokeWidth={1.75}
            />
          )}
          Refresh
        </Button>
      }
      contentClassName="px-2.5 pb-2"
      onCollapsedChange={onCollapsedChange}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10.5px] font-medium text-muted-foreground">
          Mode
        </span>
        <Button
          type="button"
          size="xs"
          variant={skillsMode === "off" ? "default" : "outline"}
          className="h-5 px-2 text-[10px]"
          disabled={disabled}
          onClick={() => onSkillsModeChange("off")}
        >
          Off
        </Button>
        <Button
          type="button"
          size="xs"
          variant={skillsMode === "project" ? "default" : "outline"}
          className="h-5 px-2 text-[10px]"
          disabled={disabled}
          onClick={() => onSkillsModeChange("project")}
        >
          Project
        </Button>
        <Button
          type="button"
          size="xs"
          variant={skillsMode === "selected" ? "default" : "outline"}
          className="h-5 px-2 text-[10px]"
          disabled={disabled}
          onClick={() => onSkillsModeChange("selected")}
        >
          Selected
        </Button>
        {(skillsMode === "project" || skillsMode === "selected") && (
          <span className="text-[10px] text-muted-foreground">
            {activeSkillCount} skill{activeSkillCount !== 1 ? "s" : ""} active
          </span>
        )}
      </div>

      <div
        className={cn(
          "rounded-lg border border-border/35 bg-background/65 px-2.5 py-2 text-[10.5px] leading-snug text-muted-foreground",
          skillsMode === "off" && "opacity-60",
        )}
      >
        {skillsMode === "off"
          ? "Skills are disabled. New Pi sessions will start without skill prompts."
          : skillsMode === "selected"
            ? "Only checked skills will be injected into new Pi sessions."
            : "Terax injects only Rust-validated skill files into new Pi sessions. Skills are never installed, executed, or given arbitrary read access."}
        {profileMode ? " User profile roots included." : ""}
      </div>

      {error ? (
        <div className="mt-1.5 rounded-lg border border-destructive/35 bg-destructive/5 px-2.5 py-2 text-[10.5px] leading-snug text-destructive">
          {error}
        </div>
      ) : null}

      {status?.roots.length ? (
        <div className="mt-1.5 flex flex-col gap-1 text-[10px] text-muted-foreground">
          {status.roots.map((root) => (
            <div
              key={`${root.scope}-${root.path}`}
              className="truncate rounded-md border border-border/35 bg-card/45 px-2 py-1"
              title={root.warning ?? root.path}
            >
              {root.scanned ? "Scanned" : "Skipped"} {root.scope}: {root.path}
              {root.warning ? ` (${root.warning})` : ""}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-1.5 flex flex-col gap-1.5">
        {status?.skills.map((skill) => (
          <SkillRow
            key={skill.path}
            skill={skill}
            selectable={skillsMode === "selected"}
            selected={selectedSkills.includes(skill.path)}
            onToggle={() => {
              const next = selectedSkills.includes(skill.path)
                ? selectedSkills.filter((p) => p !== skill.path)
                : [...selectedSkills, skill.path];
              onSelectedSkillsChange(next);
            }}
          />
        ))}
        {status && status.skills.length === 0 ? (
          <div className="rounded-lg border border-border/35 bg-card/50 px-2.5 py-2 text-[10.5px] text-muted-foreground">
            No skills found in the enabled roots.
          </div>
        ) : null}
        {status?.truncated ? (
          <div className="rounded-lg border border-border/35 bg-card/50 px-2.5 py-2 text-[10.5px] text-muted-foreground">
            Skill scan stopped at {status.maxSkills} entries.
          </div>
        ) : null}
      </div>
    </PiSection>
  );
}
