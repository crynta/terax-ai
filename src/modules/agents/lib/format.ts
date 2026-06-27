export function displayAgent(agent: string): string {
  if (!agent) return "Agent";
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}
