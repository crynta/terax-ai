import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PiLocalAgentsCard } from "@/modules/pi/components/PiLocalAgentsCard";
import { buildPiLocalAgentStatuses } from "@/modules/pi/lib/local-agents";

function renderCard(prompt = "Review the current diff") {
  return renderToStaticMarkup(
    <PiLocalAgentsCard
      activeAgents={[
        {
          id: "claude",
          label: "Claude Code",
          status: "waiting",
          detail: "Needs review",
        },
      ]}
      agents={buildPiLocalAgentStatuses([
        { binary: "claude", path: "/Users/me/.local/bin/claude" },
        { binary: "codex", path: null },
        { binary: "opencode", path: "/opt/homebrew/bin/opencode" },
        { binary: "pi", path: "/Users/me/Library/pnpm/pi" },
        { binary: "gemini", path: "/Users/me/.nvm/bin/gemini" },
        { binary: "agy", path: "/Users/me/.local/bin/agy" },
      ])}
      collapsed={false}
      disabled={false}
      refreshing={false}
      prompt={prompt}
      onCollapsedChange={() => {}}
      onInstall={() => {}}
      onLaunch={() => {}}
      onLaunchWithPrompt={() => {}}
      onRefresh={() => {}}
    />,
  );
}

describe("PiLocalAgentsCard", () => {
  it("renders active agents and safe local CLI launch posture", () => {
    const html = renderCard();

    expect(html).toContain("Local CLI agents");
    expect(html).toContain("No hidden spawns");
    expect(html).toContain("Safe visible terminal launch");
    expect(html).toContain("Claude Code");
    expect(html).toContain("Needs review");
    expect(html).toContain("Installed");
    expect(html).toContain("Missing");
    expect(html).toContain("Open terminal");
    expect(html).toContain("With prompt");
    expect(html).toContain("Pi");
    expect(html).toContain("Gemini CLI");
    expect(html).toContain("Antigravity");
    expect(html).toContain("No bash, edit, or write tools");
    expect(html).toContain("read-only");
    expect(html).toContain("terminal sandbox restrictions");
    expect(html).toContain(
      "Local Windows launch stays disabled until env isolation is native",
    );
  });

  it("hides prompt handoff when the composer has no prompt", () => {
    const html = renderCard("   ");

    expect(html).not.toContain("With prompt");
  });
});
