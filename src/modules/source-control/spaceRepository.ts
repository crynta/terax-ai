import type { SpaceRootIssue } from "@/modules/spaces/lib/spaceRoot";

export function sourceControlPathForSpace(
  root: string | null,
  issue: SpaceRootIssue | undefined,
): string | null {
  return issue ? null : root;
}
