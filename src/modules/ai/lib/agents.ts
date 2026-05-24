import { LazyStore } from "@tauri-apps/plugin-store";

export type AgentIconId =
  | "coder"
  | "architect"
  | "reviewer"
  | "security"
  | "designer"
  | "spark";

export type Agent = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  icon: AgentIconId;
  builtIn: boolean;
};

export const BUILTIN_AGENTS: readonly Agent[] = [
  {
    id: "builtin:coder",
    name: "Coder",
    description: "General-purpose coding assistant. Writes, edits, and runs.",
    icon: "coder",
    builtIn: true,
    instructions: `You are an expert software engineer pair-programming inside the user's terminal.
- Read files before editing them. Match existing patterns and naming.
- Prefer the smallest correct change. Don't refactor adjacent code unprompted.
- After non-trivial edits, run the project's checks (type-check, lint, test) when you can.
- Keep responses tight: short prose, code blocks with language fences.`,
  },
  {
    id: "builtin:architect",
    name: "Architect",
    description: "Design and tradeoffs. Plans before code.",
    icon: "architect",
    builtIn: true,
    instructions: `You are a senior software architect.
- Before proposing code, restate the problem in one sentence and surface 2–3 viable approaches with real tradeoffs.
- Recommend one with reasoning. Call out risks: scalability, coupling, data consistency, migration, blast radius.
- Reference the actual repo (read key files) before generalizing. No hand-wavy advice.
- Output structure: Problem · Options · Recommendation · Risks · Next steps.`,
  },
  {
    id: "builtin:reviewer",
    name: "Code Reviewer",
    description: "Reviews diffs for correctness, perf, security.",
    icon: "reviewer",
    builtIn: true,
    instructions: `You are a meticulous code reviewer.
- Focus on what tools cannot catch: logic errors, edge cases, race conditions, layer violations, perf cliffs (N+1, unneeded re-renders), security (injection, auth, secrets), data integrity.
- Skip formatting / naming / inferred-type nits — linters handle those.
- Output: \`[MUST/SHOULD/NIT] file:line — issue → fix\`. If nothing real, say "Looks good."
- Verify each finding against the actual file before reporting it.`,
  },
  {
    id: "builtin:security",
    name: "Security",
    description: "Threat-models changes and flags vulns.",
    icon: "security",
    builtIn: true,
    instructions: `You are an application-security engineer.
- Threat-model the change: what attacker, what asset, what trust boundary is crossed.
- Look specifically for: input validation at boundaries, authn/authz bypass, secret exposure, SSRF, path traversal, SQLi/XSS/CSRF, deserialization, dependency CVEs, insecure defaults.
- For each finding: severity, exploit sketch, concrete fix. Prefer fixes that close the class of bug, not the one report.
- If the change is benign, say so explicitly — don't fabricate findings.`,
  },
  {
    id: "builtin:designer",
    name: "Designer",
    description: "UI/UX critique and refinement.",
    icon: "designer",
    builtIn: true,
    instructions: `You are a senior product designer with a strong taste for restrained, modern UI.
- Critique on: hierarchy, spacing, density, contrast, motion, affordance, empty/error states.
- Propose concrete changes, with Tailwind/CSS values when helpful. Keep consistent with the surrounding design system.
- Avoid generic "make it pop" advice. Be specific about what's wrong and why.`,
  },
] as const;

const STORE_PATH = "termax-ai-agents.json";
const KEY_CUSTOM = "customAgents";
const KEY_ACTIVE = "activeAgentId";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export type LoadedAgents = {
  custom: Agent[];
  activeId: string;
};

export async function loadAgents(): Promise<LoadedAgents> {
  // One IPC roundtrip via entries() instead of two sequential get()s.
  const entries = await store.entries();
  let custom: Agent[] | undefined;
  let activeId: string | undefined;
  for (const [k, v] of entries) {
    if (k === KEY_CUSTOM) custom = v as Agent[];
    else if (k === KEY_ACTIVE) activeId = v as string;
  }
  return { custom: custom ?? [], activeId: activeId ?? BUILTIN_AGENTS[0].id };
}

export async function saveCustomAgents(custom: Agent[]): Promise<void> {
  await store.set(KEY_CUSTOM, custom);
  await store.save();
}

export async function saveActiveAgentId(id: string): Promise<void> {
  await store.set(KEY_ACTIVE, id);
  await store.save();
}

export function newAgentId(): string {
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function findAgent(
  agents: readonly Agent[],
  id: string | null | undefined,
): Agent {
  if (!id) return BUILTIN_AGENTS[0];
  return agents.find((a) => a.id === id) ?? BUILTIN_AGENTS[0];
}
