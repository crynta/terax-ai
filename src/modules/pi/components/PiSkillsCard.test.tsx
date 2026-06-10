import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PiSkillsCard } from "@/modules/pi/components/PiSkillsCard";
import type { PiSkillsStatus } from "@/modules/pi/lib/native";

const status: PiSkillsStatus = {
  maxSkillBytes: 65536,
  maxSkills: 200,
  truncated: false,
  roots: [
    {
      path: "/repo/.pi/skills",
      scope: "project",
      scanned: true,
      warning: null,
    },
  ],
  skills: [
    {
      name: "design-md",
      description: "Create design docs",
      heading: "Design MD",
      preview: "Use for design docs.",
      path: "/repo/.pi/skills/design-md/SKILL.md",
      baseDir: "/repo/.pi/skills/design-md",
      scope: "project",
      warnings: [],
    },
    {
      name: "Bad Skill",
      description: "",
      heading: null,
      preview: null,
      path: "/repo/.pi/skills/bad/SKILL.md",
      baseDir: "/repo/.pi/skills/bad",
      scope: "project",
      warnings: ["description is missing"],
    },
  ],
};

describe("PiSkillsCard", () => {
  it("renders read-only skill inventory and warnings", () => {
    const html = renderToStaticMarkup(
      <PiSkillsCard
        collapsed={false}
        disabled={false}
        error={null}
        refreshing={false}
        profileMode={false}
        skillsMode={"off"}
        status={status}
        onCollapsedChange={vi.fn()}
        onRefresh={vi.fn()}
        onSkillsModeChange={vi.fn()}
        selectedSkills={[]}
        onSelectedSkillsChange={vi.fn()}
      />,
    );

    expect(html).toContain("Skills are disabled");
    expect(html).toContain("design-md");
    expect(html).toContain("Bad Skill");
    expect(html).toContain("description is missing");
  });
});
