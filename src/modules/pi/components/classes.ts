import type { PiSessionStatus } from "@/modules/pi/lib/sessions";
import type { PiStatusView } from "@/modules/pi/lib/status";

export function statusToneDotClass(tone: PiStatusView["tone"]): string {
  switch (tone) {
    case "success":
      return "bg-foreground/75";
    case "progress":
      return "bg-muted-foreground/60";
    case "error":
      return "bg-destructive";
    case "muted":
      return "bg-muted-foreground/35";
  }
}

export function sessionStatusDotClass(status: PiSessionStatus): string {
  switch (status) {
    case "running":
      return "bg-foreground/70";
    case "idle":
      return "bg-foreground/70";
    case "stopped":
      return "bg-muted-foreground/35";
    case "error":
      return "bg-destructive";
  }
}
