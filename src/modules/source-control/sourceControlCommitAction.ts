export type SourceControlCommitActionState = {
  committed: boolean;
  message: string;
  actionBusy: string | null;
};

export function commitPrimaryLabel({
  committed,
  message,
  actionBusy,
}: SourceControlCommitActionState): string {
  if (actionBusy === "commit") return "Committing...";
  if (actionBusy === "commit-push") return "Committing...";
  if (actionBusy === "commit-sync") return "Committing...";
  if (committed && message.trim().length === 0) return "Committed";
  return "Commit";
}

export function shouldResetCommitSuccess(
  previousMessage: string,
  nextMessage: string,
): boolean {
  return previousMessage.trim().length === 0 && nextMessage.trim().length > 0;
}
