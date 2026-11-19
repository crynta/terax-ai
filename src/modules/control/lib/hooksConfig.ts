import { invoke } from "@tauri-apps/api/core";

export type HooksAction = "install" | "uninstall";

/** What installing or removing an agent's hooks would change. */
export type HooksPlan = {
  agent: string;
  action: HooksAction;
  path: string;
  /** File contents now; null when the file does not exist. */
  before: string | null;
  /** File contents afterwards; null when the file would be removed. */
  after: string | null;
  changed: boolean;
};

export function planAgentHooks(
  agent: string,
  action: HooksAction,
): Promise<HooksPlan> {
  return invoke<HooksPlan>("agent_hooks_plan", { agent, action });
}

/** Applies a previewed plan; rejects when the file changed after the preview. */
export function applyAgentHooksPlan(plan: HooksPlan): Promise<void> {
  return invoke("agent_hooks_apply", {
    agent: plan.agent,
    action: plan.action,
    before: plan.before,
  });
}

export function enableAgentHooks(agent: string): Promise<void> {
  return invoke("agent_enable_hooks", { agent });
}

export function disableAgentHooks(agent: string): Promise<void> {
  return invoke("agent_disable_hooks", { agent });
}

export function agentHooksInstalled(agent: string): Promise<boolean> {
  return invoke<boolean>("agent_hooks_status", { agent });
}
