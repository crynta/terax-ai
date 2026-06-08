import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  formatLspPayload,
  LSP_DEV_TOOLS,
  useLspDebugStore,
  type LspDebugEntry,
  type LspSessionState,
} from "@/modules/editor/lib/lsp/debugStore";

const STATE_LABEL: Record<LspSessionState, string> = {
  idle: "Idle",
  unsupported: "Unsupported file",
  spawning: "Spawning server",
  ready: "Connected",
  error: "Error",
  closed: "Closed",
};

const STATE_CLASS: Record<LspSessionState, string> = {
  idle: "bg-muted text-muted-foreground",
  unsupported: "bg-muted text-muted-foreground",
  spawning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  ready: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  error: "bg-destructive/15 text-destructive",
  closed: "bg-muted text-muted-foreground",
};

const LEVEL_CLASS: Record<LspDebugEntry["level"], string> = {
  info: "text-muted-foreground",
  out: "text-sky-700 dark:text-sky-400",
  in: "text-violet-700 dark:text-violet-400",
  warn: "text-amber-700 dark:text-amber-400",
  error: "text-destructive",
};

function formatTime(at: number): string {
  const d = new Date(at);
  const base = d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${base}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function LspDebugDialog() {
  const open = useLspDebugStore((s) => s.panelOpen);
  const setOpen = useLspDebugStore((s) => s.setPanelOpen);
  const session = useLspDebugStore((s) => s.session);
  const entries = useLspDebugStore((s) => s.entries);
  const clear = useLspDebugStore((s) => s.clear);

  const copyLogs = async () => {
    const text = entries
      .map((e) => {
        const line = `[${formatTime(e.at)}] ${e.level.toUpperCase()} ${e.message}`;
        return e.detail ? `${line}\n  ${e.detail}` : line;
      })
      .join("\n");
    await navigator.clipboard.writeText(text);
  };

  if (!LSP_DEV_TOOLS) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(85vh,900px)] w-[min(960px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-border/60 px-4 py-3">
          <DialogTitle className="text-[14px]">LSP debug</DialogTitle>
        </DialogHeader>

        <div className="grid shrink-0 gap-3 border-b border-border/60 px-4 py-3 text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium",
                STATE_CLASS[session.state],
              )}
            >
              {STATE_LABEL[session.state]}
            </span>
            {session.diagnosticCount > 0 ? (
              <span className="text-muted-foreground">
                {session.diagnosticCount} diagnostic
                {session.diagnosticCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          <div className="grid gap-1 text-muted-foreground">
            <Row label="File" value={session.lastPath} />
            <Row
              label="Server"
              value={
                session.command
                  ? `${session.command} ${session.args.join(" ")}`.trim()
                  : null
              }
            />
            <Row label="Root" value={session.rootUri} />
            <Row label="CWD" value={session.cwd} />
            <Row label="Language" value={session.languageId} />
            <Row
              label="Transport"
              value={
                session.transportId != null
                  ? `#${session.transportId}`
                  : null
              }
            />
            <Row label="Pool" value={session.poolKey} />
            {session.openDocuments.length > 0 ? (
              <Row
                label="Open docs"
                value={session.openDocuments.join(", ")}
              />
            ) : null}
            {session.error ? (
              <p className="text-destructive">{session.error}</p>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => void copyLogs()}
            >
              Copy log
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={clear}
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-1 px-4 py-3 font-mono text-[10.5px] leading-relaxed">
            {entries.length === 0 ? (
              <p className="text-muted-foreground">
                No LSP events yet. Open a supported file in the editor
                (ts, rs, py, go, ...).
              </p>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="whitespace-pre-wrap break-all">
                  <span className="text-muted-foreground/70">
                    {formatTime(entry.at)}{" "}
                  </span>
                  <span className={LEVEL_CLASS[entry.level]}>
                    {entry.level.toUpperCase()}{" "}
                  </span>
                  <span>{entry.message}</span>
                  {entry.detail ? (
                    <div className="pl-4 text-muted-foreground">
                      {entry.detail.startsWith("{") ||
                      entry.detail.startsWith("[")
                        ? formatLspPayload(entry.detail, 400)
                        : entry.detail}
                    </div>
                  ) : null}
                </div>
              ))
            )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <p>
      <span className="text-foreground/80">{label}: </span>
      <span className="break-all">{value}</span>
    </p>
  );
}
