import Timer02Icon from "@hugeicons/core-free-icons/Timer02Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
import PauseIcon from "@hugeicons/core-free-icons/PauseIcon";
import SquareIcon from "@hugeicons/core-free-icons/SquareIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
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

import { useAutomation, type ScheduleJob } from "../../scheduler/useAutomation";

type Props = {
  open: boolean;
};

export const AutomationPanel = memo(function AutomationPanel({ open }: Props) {
  const {
    jobs,
    loading,
    addJob,
    removeJob,
    toggleJob,
    startDaemon,
    stopDaemon,
  } = useAutomation();
  const [showForm, setShowForm] = useState(false);
  const [daemonRunning, setDaemonRunning] = useState(false);

  if (!open) return null;

  return (
    <TooltipProvider delayDuration={800} skipDelayDuration={300}>
      <SidebarPanelFrame aria-label="Automation">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 pb-2.5 pt-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <HugeiconsIcon
              icon={Timer02Icon}
              size={14}
              strokeWidth={1.75}
              className="text-muted-foreground"
            />
            <span className="text-[11.5px] font-medium text-foreground">
              Automation
            </span>
            {jobs.length > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 px-1 text-[9.5px] font-semibold tabular-nums text-muted-foreground">
                {jobs.length}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    if (daemonRunning) {
                      void stopDaemon().then(() => setDaemonRunning(false));
                    } else {
                      void startDaemon().then(() => setDaemonRunning(true));
                    }
                  }}
                >
                  <HugeiconsIcon
                    icon={daemonRunning ? SquareIcon : PlayIcon}
                    size={14}
                    strokeWidth={1.75}
                    className={
                      daemonRunning ? "text-green-500" : "text-muted-foreground"
                    }
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {daemonRunning ? "Stop daemon" : "Start daemon"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setShowForm((v) => !v)}
                >
                  <HugeiconsIcon
                    icon={PlusSignIcon}
                    size={14}
                    strokeWidth={1.75}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New job</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <SidebarPanelBody>
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-8">
              <Spinner className="size-4" />
            </div>
          ) : jobs.length === 0 && !showForm ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="text-sm font-medium text-muted-foreground">
                No automations
              </div>
              <div className="max-w-64 text-[11px] leading-relaxed text-muted-foreground/75">
                Schedule recurring prompts to run automatically with cron
                expressions.
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-1"
                onClick={() => setShowForm(true)}
              >
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  size={12}
                  strokeWidth={1.75}
                  className="mr-1"
                />
                Add job
              </Button>
            </div>
          ) : (
            <SidebarPanelScrollRegion>
              {showForm && (
                <NewJobForm
                  onSubmit={async (name, cron, prompt, agentSlug) => {
                    await addJob(name, cron, prompt, agentSlug);
                    setShowForm(false);
                  }}
                  onCancel={() => setShowForm(false)}
                />
              )}
              <div className="flex flex-col gap-0.5 p-1.5">
                {jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onToggle={toggleJob}
                    onRemove={removeJob}
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

function NewJobForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (
    name: string,
    cron: string,
    prompt?: string,
    agentSlug?: string,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentSlug, setAgentSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(() => {
    if (!name.trim() || !cron.trim()) return;
    setSubmitting(true);
    void onSubmit(
      name.trim(),
      cron.trim(),
      prompt.trim() || undefined,
      agentSlug.trim() || undefined,
    ).finally(() => setSubmitting(false));
  }, [name, cron, prompt, agentSlug, onSubmit]);

  return (
    <div className="border-b border-border/40 px-3 py-2.5">
      <div className="flex flex-col gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Job name"
          className="h-7 rounded-md border border-border/60 bg-transparent px-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          value={cron}
          onChange={(e) => setCron(e.target.value)}
          placeholder="Cron expression (e.g. 0 9 * * *)"
          className="h-7 rounded-md border border-border/60 bg-transparent px-2 text-[12px] font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Prompt to run (optional)"
          rows={2}
          className="min-h-0 resize-none text-[12px]"
        />
        <input
          value={agentSlug}
          onChange={(e) => setAgentSlug(e.target.value)}
          placeholder="Agent slug (optional)"
          className="h-7 rounded-md border border-border/60 bg-transparent px-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="h-6 text-[11px]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !cron.trim()}
            className="h-6 text-[11px]"
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function JobRow({
  job,
  onToggle,
  onRemove,
}: {
  job: ScheduleJob;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/30 transition-[background-color] duration-100">
      <button
        type="button"
        onClick={() => void onToggle(job.id, !job.enabled)}
        className="shrink-0"
      >
        <HugeiconsIcon
          icon={job.enabled ? PauseIcon : PlayIcon}
          size={12}
          strokeWidth={1.75}
          className={cn(
            job.enabled ? "text-foreground/80" : "text-muted-foreground/60",
          )}
        />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium leading-tight text-foreground/95">
            {job.name}
          </span>
          {!job.enabled && (
            <Badge
              variant="outline"
              className="h-3.5 px-1 text-[8px] leading-none"
            >
              Paused
            </Badge>
          )}
        </div>
        <span className="truncate text-[10.5px] font-mono leading-tight text-muted-foreground/75">
          {job.cronExpression}
        </span>
        {job.prompt && (
          <span className="truncate text-[10px] leading-tight text-muted-foreground/60">
            {job.prompt}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => void onRemove(job.id)}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <HugeiconsIcon
          icon={Delete02Icon}
          size={12}
          strokeWidth={1.75}
          className="text-muted-foreground hover:text-destructive"
        />
      </button>
    </div>
  );
}
