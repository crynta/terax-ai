import { describe, expect, it } from "vitest";
import {
  COMPOSER_SYNTAX_MODES,
  DEFAULT_COMPOSER_SYNTAX_MODE,
  DEFAULT_COMPOSER_SYNTAX_RULES,
  resolveComposerSyntaxMode,
  resolveComposerSyntaxModeForContext,
} from "./composerLanguage";

describe("terminal composer syntax mode", () => {
  it("defaults to bash highlighting", () => {
    expect(DEFAULT_COMPOSER_SYNTAX_MODE).toBe("bash");
  });

  it("offers markdown and xml modes", () => {
    expect(COMPOSER_SYNTAX_MODES.map((mode) => mode.id)).toEqual(
      expect.arrayContaining(["bash", "markdown", "xml"]),
    );
  });

  it("falls back to bash for unknown persisted values", () => {
    expect(resolveComposerSyntaxMode("xml")).toBe("xml");
    expect(resolveComposerSyntaxMode("unknown")).toBe("bash");
    expect(resolveComposerSyntaxMode(null)).toBe("bash");
  });

  it("defaults active AI CLIs to markdown", () => {
    expect(DEFAULT_COMPOSER_SYNTAX_RULES).toContainEqual(
      expect.objectContaining({
        pattern: "claude|codex|gemini",
        mode: "markdown",
      }),
    );
    expect(
      resolveComposerSyntaxModeForContext({
        agentName: "codex",
        defaultMode: "bash",
        rules: DEFAULT_COMPOSER_SYNTAX_RULES,
      }),
    ).toBe("markdown");
  });

  it("uses the first matching custom default rule before the unified default", () => {
    expect(
      resolveComposerSyntaxModeForContext({
        agentName: "psql",
        defaultMode: "bash",
        rules: [
          { id: "ai", pattern: "claude|codex", mode: "markdown" },
          { id: "psql", pattern: "psql", mode: "sql" },
        ],
      }),
    ).toBe("sql");
  });
});
