import type { AgentPreset } from "./mrRobot";
import { MR_ROBOT_PRESET } from "./mrRobot";

export type { AgentPreset };

export const AGENT_PRESETS: AgentPreset[] = [
  MR_ROBOT_PRESET,
];

export function getPreset(id: string): AgentPreset | undefined {
  return AGENT_PRESETS.find(p => p.id === id);
}