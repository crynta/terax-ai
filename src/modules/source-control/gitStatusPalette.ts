/** SCM panel left-bar accent. */
export function gitStatusAccentClass(code: string): string {
  switch (code.trim().toUpperCase()) {
    case "A":
      return "bg-emerald-500/85";
    case "U":
      return "bg-teal-500/85";
    case "M":
      return "bg-amber-500/85";
    case "D":
      return "bg-rose-500/85";
    case "R":
    case "C":
      return "bg-sky-500/85";
    default:
      return "bg-muted-foreground/40";
  }
}

/** Explorer / git-history file letter badges. */
export function gitStatusTextClass(code: string): string {
  switch (code.trim().toUpperCase()) {
    case "A":
      return "text-emerald-500/85";
    case "U":
      return "text-teal-500/85";
    case "M":
      return "text-amber-500/85";
    case "D":
      return "text-rose-500/85";
    case "R":
    case "C":
      return "text-sky-500/85";
    default:
      return "text-muted-foreground";
  }
}

/** Explorer folder dot when any descendant has git changes. */
export const gitFolderDirtyDotClass = "bg-amber-500/30";
