import { cn } from "@/lib/utils";
import { AiBrain01Icon, AiMagicIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AgentSession } from "./lib/useSession";

type Props = { session: AgentSession | null };

export function AiSessionView({ session }: Props) {
  if (!session) return <EmptyState />;
  return <ActiveSession session={session} />;
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <HugeiconsIcon icon={AiMagicIcon} size={18} strokeWidth={1.5} />
      <p className="text-xs">Ask the AI agent anything about your terminal.</p>
    </div>
  );
}

function ActiveSession({ session }: { session: AgentSession }) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 py-3">
      <header className="flex items-start gap-2.5">
        <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <HugeiconsIcon icon={AiBrain01Icon} size={14} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-foreground">
            {session.prompt}
          </p>
          <StatusBadge status={session.status} />
        </div>
      </header>

      <div className="ml-8 flex flex-col gap-2 text-xs text-muted-foreground">
        <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2">
          <p className="font-medium text-foreground/90">Planning…</p>
          <p className="mt-1 leading-relaxed">
            Session is stateless in this build — wiring real agent steps is the
            next milestone.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AgentSession["status"] }) {
  const label = {
    thinking: "Thinking",
    working: "Working",
    done: "Done",
    error: "Error",
  }[status];

  return (
    <span
      className={cn(
        "mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "thinking" && "animate-pulse bg-chart-2",
          status === "working" && "animate-pulse bg-chart-2",
          status === "done" && "bg-chart-1",
          status === "error" && "bg-destructive",
        )}
      />
      {label}
    </span>
  );
}
