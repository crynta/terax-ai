import { describe, expect, it } from "vitest";
import {
  SLASH_COMMANDS,
  TERAX_CMD_RE,
  wrapWithCommandMarker,
} from "@/modules/ai/lib/slashCommands";

describe("SLASH_COMMANDS", () => {
  it("has init and plan commands", () => {
    expect(SLASH_COMMANDS.init).toBeDefined();
    expect(SLASH_COMMANDS.plan).toBeDefined();
  });

  it("commands have required fields", () => {
    for (const cmd of Object.values(SLASH_COMMANDS)) {
      expect(cmd.name).toBeTruthy();
      expect(cmd.invocation).toMatch(/^\//);
      expect(cmd.label).toBeTruthy();
    }
  });
});

describe("TERAX_CMD_RE", () => {
  it("matches terax-command tags", () => {
    const m = '<terax-command name="init" />\n'.match(TERAX_CMD_RE);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("init");
  });

  it("matches with state attribute", () => {
    const m = '<terax-command name="plan" state="active" />\n'.match(
      TERAX_CMD_RE,
    );
    expect(m).not.toBeNull();
    expect(m![1]).toBe("plan");
    expect(m![2]).toBe("active");
  });

  it("does not match plain text", () => {
    expect("hello world".match(TERAX_CMD_RE)).toBeNull();
  });
});

describe("wrapWithCommandMarker", () => {
  it("wraps prompt in command marker", () => {
    const result = wrapWithCommandMarker("do something", "init");
    expect(result).toContain('<terax-command name="init" />');
    expect(result).toContain("do something");
  });
});
