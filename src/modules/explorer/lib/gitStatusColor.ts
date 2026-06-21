import type { GitStatusCode } from "./gitStatusUtils";

// Soft filename tint, new-VS-Code direction: color the name, no badges.
export function explorerGitTextClass(code: GitStatusCode): string {
  switch (code) {
    case "M":
      return "text-amber-200/85";
    case "A":
    case "U":
      return "text-[#73C991]/90";
    case "R":
      return "text-sky-300/85";
    case "D":
      return "text-rose-200/80";
  }
}
