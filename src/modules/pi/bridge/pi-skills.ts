import { invoke } from "@tauri-apps/api/core";
import type { PiSkillInfo, PiSkillsStatus } from "@/modules/pi/lib/native";

/**
 * Skill shape expected by formatSkillsForSystemPrompt.
 * We inline the format since pi-agent-core doesn't export it publicly.
 */
interface SkillForPrompt {
  name: string;
  description: string;
  content: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

/**
 * Resolve skill files for the webview agent.
 *
 * Uses the existing `pi_skills_status` Tauri command (Rust scans .pi/skills,
 * .agents/skills, ~/.pi/agent/skills) then reads SKILL.md content via the
 * existing readFile bridge tool.
 */
export async function resolveSkillFiles(
  cwd: string,
  skillsMode: "off" | "project" | "selected" | unknown,
  selectedSkills: string[] | unknown,
): Promise<SkillForPrompt[]> {
  if (skillsMode === "off" || !cwd) return [];

  // Guarded: skill scanning is best-effort. If the backing command is absent or
  // errors, skip skill injection rather than failing pi session creation (this
  // runs on the create/resume path in webview-session.ts).
  let status: PiSkillsStatus;
  try {
    status = await invoke<PiSkillsStatus>("pi_skills_status", {
      workspaceRoot: cwd,
      workspace: { kind: "local" },
      includeProfile: true,
    });
  } catch {
    return [];
  }

  // Filter out skills with warnings
  let valid = status.skills.filter((s: PiSkillInfo) => s.warnings.length === 0);

  // In "selected" mode, only keep explicitly selected skills
  if (
    skillsMode === "selected" &&
    Array.isArray(selectedSkills) &&
    selectedSkills.length > 0
  ) {
    const selected = new Set(selectedSkills as string[]);
    valid = valid.filter((s: PiSkillInfo) => selected.has(s.path));
  }

  // Read each SKILL.md content via bridge tools
  const { piBridgeTools } = await import("./pi-tools");

  const skills: SkillForPrompt[] = [];
  for (const info of valid) {
    try {
      const result = await piBridgeTools.readFile(info.path, cwd);
      if ("content" in result && typeof result.content === "string") {
        skills.push({
          name: info.name,
          description: info.description,
          content: result.content,
          filePath: info.path,
          disableModelInvocation: false,
        });
      }
    } catch {
      // Skip unreadable skills
    }
  }

  return skills;
}

/**
 * Format skills as an XML block for the system prompt.
 *
 * Produces the same format as Pi SDK's formatSkillsForSystemPrompt:
 * <available_skills>
 *   <skill>
 *     <name>skill-name</name>
 *     <description>When to use this skill.</description>
 *     <location>/path/to/.pi/skills/skill-name/SKILL.md</location>
 *   </skill>
 * </available_skills>
 *
 * The model reads full skill content on-demand via the read_file tool.
 */
function formatSkillsForSystemPrompt(skills: SkillForPrompt[]): string {
  if (skills.length === 0) return "";

  const entries = skills
    .filter((s) => !s.disableModelInvocation)
    .map((s) =>
      [
        "  <skill>",
        `    <name>${escapeXml(s.name)}</name>`,
        `    <description>${escapeXml(s.description)}</description>`,
        `    <location>${escapeXml(s.filePath)}</location>`,
        "  </skill>",
      ].join("\n"),
    )
    .join("\n");

  return `<available_skills>\n${entries}\n</available_skills>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a system prompt with skills injected as an XML block.
 */
export function buildSystemPromptWithSkills(
  basePrompt: string,
  skills: SkillForPrompt[],
): string {
  if (skills.length === 0) return basePrompt;

  const skillsBlock = formatSkillsForSystemPrompt(skills);
  return skillsBlock ? `${basePrompt}\n\n${skillsBlock}` : basePrompt;
}
