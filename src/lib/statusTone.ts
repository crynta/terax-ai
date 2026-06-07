export type StatusTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "active"
  | "muted";

export function statusDotClass(tone: StatusTone): string {
  switch (tone) {
    case "success":
      return "bg-[var(--status-success)]";
    case "warning":
      return "bg-[var(--status-warning)]";
    case "danger":
      return "bg-destructive";
    case "info":
      return "bg-[var(--status-info)]";
    case "active":
      return "bg-primary";
    case "muted":
      return "bg-muted-foreground/40";
  }
}

export function statusTextClass(tone: StatusTone): string {
  switch (tone) {
    case "success":
      return "text-[var(--status-success-foreground)]";
    case "warning":
      return "text-[var(--status-warning-foreground)]";
    case "danger":
      return "text-destructive";
    case "info":
      return "text-[var(--status-info-foreground)]";
    case "active":
      return "text-primary";
    case "muted":
      return "text-muted-foreground";
  }
}

export function statusBadgeClass(tone: StatusTone): string {
  switch (tone) {
    case "success":
      return "bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]";
    case "warning":
      return "bg-[var(--status-warning-surface)] text-[var(--status-warning-foreground)]";
    case "danger":
      return "bg-destructive/10 text-destructive";
    case "info":
      return "bg-[var(--status-info-surface)] text-[var(--status-info-foreground)]";
    case "active":
      return "bg-primary/15 text-primary";
    case "muted":
      return "bg-muted text-muted-foreground";
  }
}

export function statusBorderSurfaceClass(tone: StatusTone): string {
  switch (tone) {
    case "success":
      return "border-[var(--status-success-border)] bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]";
    case "warning":
      return "border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] text-[var(--status-warning-foreground)]";
    case "danger":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "info":
      return "border-[var(--status-info-border)] bg-[var(--status-info-surface)] text-[var(--status-info-foreground)]";
    case "active":
      return "border-primary/30 bg-primary/10 text-primary";
    case "muted":
      return "border-border/60 bg-muted/30 text-muted-foreground";
  }
}

export function diffTextClass(kind: "add" | "remove"): string {
  return kind === "add"
    ? statusTextClass("success")
    : statusTextClass("danger");
}

export function diffLineClass(kind: "add" | "remove"): string {
  return kind === "add"
    ? "bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]"
    : "bg-destructive/10 text-destructive";
}
