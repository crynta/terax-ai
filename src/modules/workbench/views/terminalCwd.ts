import { native } from "@/modules/ai/lib/native";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { workspaceScopeKey } from "@/modules/workspace";
import { reportTerminalCwd } from "../actions";
import { snapshot } from "../store";

const authorizedCwds = new Set<string>();

export function reportCwd(tabId: number, cwd: string) {
  const tab = snapshot().tabs.find((tab) => tab.id === tabId);
  if (tab?.kind !== "terminal") return;
  reportTerminalCwd(tabId, cwd);
  const project = useSpaces.getState().spaces.find((p) => p.id === tab.spaceId);
  if (!cwd || !project) return;
  const key = JSON.stringify([workspaceScopeKey(project.env), cwd]);
  if (authorizedCwds.has(key)) return;
  authorizedCwds.add(key);
  void native.workspaceAuthorize(cwd, project.env).catch(() => {
    authorizedCwds.delete(key);
  });
}
