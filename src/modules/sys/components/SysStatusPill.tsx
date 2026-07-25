import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSysResources } from "../lib/useSysResources";

const PILL_CLASS =
  "terax-pill-in ml-1.5 flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-full border border-border/50 bg-accent/50 px-2 text-[10.5px] font-medium text-muted-foreground";

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${Math.round(mb)} MB`;
}

function cpuColor(cpuPercent: number): string {
  if (cpuPercent > 80) return "bg-red-500";
  if (cpuPercent >= 50) return "bg-amber-500";
  return "bg-emerald-500";
}

export function SysStatusPill() {
  const resources = useSysResources();
  if (!resources) return null;

  const cpu = Math.round(resources.cpuPercent);
  const ramText = `${formatBytes(resources.memUsedBytes)} / ${formatBytes(
    resources.memTotalBytes,
  )}`;
  const modelText =
    resources.modelProcess && resources.modelMemBytes != null
      ? `${resources.modelProcess} · ${formatBytes(resources.modelMemBytes)}`
      : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={PILL_CLASS}>
          <span
            className={`size-1.5 rounded-full ${cpuColor(resources.cpuPercent)}`}
          />
          <span>CPU {cpu}%</span>
          <span className="text-border">·</span>
          <span>{ramText}</span>
          {modelText ? (
            <>
              <span className="text-border">·</span>
              <span className="rounded-full bg-sky-500/15 px-1.5 text-sky-700 dark:text-sky-400">
                {modelText}
              </span>
            </>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-[11px] leading-relaxed">
        System load: CPU {cpu}% busy, {ramText} RAM used.
        {modelText
          ? ` A local model (${modelText}) is running.`
          : " No local model process detected."}
      </TooltipContent>
    </Tooltip>
  );
}
