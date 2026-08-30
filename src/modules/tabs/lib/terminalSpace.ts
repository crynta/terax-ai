import { hasLeaf } from "@/modules/terminal";
import type { Tab } from "./useTabs";

export function spaceIdForLeaf(tabs: Tab[], leafId: number): string | null {
  return (
    tabs.find((tab) => tab.kind === "terminal" && hasLeaf(tab.paneTree, leafId))
      ?.spaceId ?? null
  );
}
