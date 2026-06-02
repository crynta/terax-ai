export function PiPanel() {
  return (
    <section className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      <div className="border-b border-border/60 px-3 py-2">
        <h2 className="text-sm font-semibold tracking-tight">Pi</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pi sessions will appear here.
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
        <div className="rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          Not connected yet
        </div>
        <div className="max-w-56 space-y-1">
          <p className="text-sm font-medium">Pi runtime placeholder</p>
          <p className="text-xs leading-5 text-muted-foreground">
            This panel reserves the sidebar surface before the Node sidecar and
            Pi thread list are wired in.
          </p>
        </div>
      </div>
    </section>
  );
}
