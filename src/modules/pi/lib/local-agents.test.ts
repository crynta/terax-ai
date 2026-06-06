import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildPiLocalAgentLaunchCommand,
  buildPiLocalAgentStatuses,
  PI_LOCAL_AGENT_DEFS,
  PI_LOCAL_AGENT_POLICY,
  piLocalAgentByName,
  piLocalAgentHookCommand,
  piLocalAgentInstallSummary,
} from "./local-agents";

const execFileAsync = promisify(execFile);

describe("Pi local agent catalog", () => {
  it("tracks the supported CLI agents with safe visible defaults", () => {
    expect(PI_LOCAL_AGENT_DEFS.map((agent) => agent.id)).toEqual([
      "claude",
      "codex",
      "cursor",
      "opencode",
      "pi",
      "gemini",
      "antigravity",
    ]);
    expect(PI_LOCAL_AGENT_POLICY.posture).toBe("Safe visible terminal launch");
    expect(PI_LOCAL_AGENT_POLICY.hiddenProcessSpawns).toBe(false);
  });

  it("keeps terminal hook commands on the agent definitions", () => {
    expect(piLocalAgentHookCommand("claude")).toBe("agent_enable_claude_hooks");
    expect(piLocalAgentHookCommand("codex")).toBe("agent_enable_codex_hooks");
    expect(piLocalAgentHookCommand("gemini")).toBe("agent_enable_gemini_hooks");
    expect(piLocalAgentHookCommand("antigravity")).toBe(
      "agent_enable_antigravity_hooks",
    );
    expect(piLocalAgentHookCommand("pi")).toBeNull();
  });

  it("uses terminal-safe plan commands", () => {
    const cursor = PI_LOCAL_AGENT_DEFS.find((agent) => agent.id === "cursor");
    const pi = PI_LOCAL_AGENT_DEFS.find((agent) => agent.id === "pi");
    const gemini = PI_LOCAL_AGENT_DEFS.find((agent) => agent.id === "gemini");
    const antigravity = PI_LOCAL_AGENT_DEFS.find(
      (agent) => agent.id === "antigravity",
    );

    expect(cursor?.planCommand).toBe("cursor-agent --mode plan");
    expect(pi?.planCommand).toBe("pi --tools read,grep,find,ls");
    expect(pi?.promptHandoff).toBe("positional");
    expect(pi?.guardrail).toContain("No bash, edit, or write tools");
    expect(gemini?.planCommand).toBe("gemini --approval-mode plan");
    expect(gemini?.promptHandoff).toBe("flag");
    expect(gemini?.promptFlag).toBe("--prompt-interactive");
    expect(gemini?.launchUnavailableReason).toBeNull();
    expect(gemini?.guardrail).toContain("read-only");
    expect(antigravity?.binary).toBe("agy");
    expect(antigravity?.planCommand).toBe("agy --sandbox");
    expect(antigravity?.promptHandoff).toBe("flag");
    expect(antigravity?.promptFlag).toBe("--prompt-interactive");
    expect(antigravity?.launchUnavailableReason).toBeNull();
    expect(antigravity?.guardrail).not.toContain(
      "dangerously-skip-permissions",
    );
  });

  it("launches OpenCode only with explicit isolated read-only config", () => {
    const opencode = PI_LOCAL_AGENT_DEFS.find(
      (agent) => agent.id === "opencode",
    );
    const command = opencode && buildPiLocalAgentLaunchCommand(opencode);

    expect(opencode?.launchUnavailableReason).toBeNull();
    expect(opencode?.promptHandoff).toBe("flag");
    expect(command).toContain('TERAX_OPENCODE_HOME="$(mktemp -d)"');
    expect(command).toContain('HOME="$TERAX_OPENCODE_HOME"');
    expect(command).toContain('XDG_CONFIG_HOME="$TERAX_OPENCODE_HOME/config"');
    expect(command).toContain('XDG_DATA_HOME="$HOME/.local/share"');
    expect(command).toContain(
      'OPENCODE_CONFIG_DIR="$TERAX_OPENCODE_HOME/config/opencode"',
    );
    expect(command).toContain("OPENCODE_DISABLE_PROJECT_CONFIG=1");
    expect(command).toContain("OPENCODE_DISABLE_CLAUDE_CODE=1");
    expect(command).toContain("OPENCODE_CONFIG_CONTENT=");
    expect(command).toContain("opencode --pure --agent terax-plan");
    expect(command).toContain('"*":"deny"');
    expect(command).toContain('"read":"allow"');
    expect(command).toContain('"edit":"deny"');
    expect(command).toContain('"bash":"deny"');
    expect(command).not.toContain("dangerously-skip-permissions");
  });

  it("uses OpenCode --prompt handoff and keeps Windows detect-only until env isolation is implemented", () => {
    const opencode = PI_LOCAL_AGENT_DEFS.find(
      (agent) => agent.id === "opencode",
    );

    expect(
      opencode &&
        buildPiLocalAgentLaunchCommand(opencode, "inspect Bob's diff"),
    ).toContain("--prompt 'inspect Bob'\\''s diff'");
    expect(
      opencode &&
        buildPiLocalAgentLaunchCommand(opencode, "inspect", {
          windowsShell: true,
        }),
    ).toBeNull();
  });

  it("executes the OpenCode launch with isolated config and preserved auth data", async () => {
    const opencode = PI_LOCAL_AGENT_DEFS.find(
      (agent) => agent.id === "opencode",
    );
    expect(opencode).toBeDefined();
    const command = buildPiLocalAgentLaunchCommand(opencode!, "inspect safely");
    expect(command).not.toBeNull();

    const root = await mkdtemp(join(tmpdir(), "terax-opencode-launch-"));
    const binDir = join(root, "bin");
    const originalHome = join(root, "real-home");
    const capturePath = join(root, "capture.json");
    const captureScript = join(root, "capture.mjs");
    await mkdir(binDir, { recursive: true });
    await mkdir(join(originalHome, ".local", "share", "opencode"), {
      recursive: true,
    });
    await writeFile(
      join(originalHome, ".local", "share", "opencode", "auth.json"),
      "{}",
    );
    await writeFile(
      captureScript,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.OPENCODE_CAPTURE_FILE, JSON.stringify({ argv: process.argv.slice(2), env: { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME, XDG_STATE_HOME: process.env.XDG_STATE_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME, OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR, OPENCODE_DISABLE_PROJECT_CONFIG: process.env.OPENCODE_DISABLE_PROJECT_CONFIG, OPENCODE_DISABLE_CLAUDE_CODE: process.env.OPENCODE_DISABLE_CLAUDE_CODE, OPENCODE_DISABLE_AUTOUPDATE: process.env.OPENCODE_DISABLE_AUTOUPDATE, OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT } }, null, 2));\n`,
    );
    await writeFile(
      join(binDir, "opencode"),
      '#!/bin/sh\nexec node "$OPENCODE_CAPTURE_SCRIPT" "$@"\n',
      { mode: 0o755 },
    );

    await execFileAsync("bash", ["-c", command!], {
      cwd: root,
      env: {
        ...process.env,
        HOME: originalHome,
        OPENCODE_CAPTURE_FILE: capturePath,
        OPENCODE_CAPTURE_SCRIPT: captureScript,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    });

    const captured = JSON.parse(await readFile(capturePath, "utf8"));
    expect(captured.argv).toEqual([
      "--pure",
      "--agent",
      "terax-plan",
      "--prompt",
      "inspect safely",
    ]);
    expect(captured.env.HOME).not.toBe(originalHome);
    expect(captured.env.XDG_CONFIG_HOME).toBe(`${captured.env.HOME}/config`);
    expect(captured.env.XDG_CACHE_HOME).toBe(`${captured.env.HOME}/cache`);
    expect(captured.env.XDG_STATE_HOME).toBe(`${captured.env.HOME}/state`);
    expect(captured.env.OPENCODE_CONFIG_DIR).toBe(
      `${captured.env.HOME}/config/opencode`,
    );
    expect(captured.env.XDG_DATA_HOME).toBe(`${originalHome}/.local/share`);
    expect(captured.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(captured.env.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
    expect(captured.env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1");

    const config = JSON.parse(captured.env.OPENCODE_CONFIG_CONTENT);
    expect(config.default_agent).toBe("terax-plan");
    expect(config.permission).toMatchObject({
      "*": "deny",
      edit: "deny",
      bash: "deny",
      task: "deny",
      skill: "deny",
      read: "allow",
      grep: "allow",
      glob: "allow",
      list: "allow",
    });
    expect(config.agent["terax-plan"].permission).toMatchObject({
      edit: "deny",
      bash: "deny",
      task: "deny",
      skill: "deny",
    });
  });

  it("builds prompt handoff commands without shell injection", () => {
    const cursor = PI_LOCAL_AGENT_DEFS.find((agent) => agent.id === "cursor");
    const opencode = PI_LOCAL_AGENT_DEFS.find(
      (agent) => agent.id === "opencode",
    );
    const pi = PI_LOCAL_AGENT_DEFS.find((agent) => agent.id === "pi");
    const gemini = PI_LOCAL_AGENT_DEFS.find((agent) => agent.id === "gemini");
    const antigravity = PI_LOCAL_AGENT_DEFS.find(
      (agent) => agent.id === "antigravity",
    );

    expect(
      cursor &&
        buildPiLocalAgentLaunchCommand(cursor, "review Bob's diff; rm -rf /"),
    ).toBe("cursor-agent --mode plan 'review Bob'\\''s diff; rm -rf /'");
    expect(
      pi && buildPiLocalAgentLaunchCommand(pi, "review Bob's diff; rm -rf /"),
    ).toBe("pi --tools read,grep,find,ls 'review Bob'\\''s diff; rm -rf /'");
    expect(
      opencode && buildPiLocalAgentLaunchCommand(opencode, "inspect this"),
    ).toContain("opencode --pure --agent terax-plan --prompt 'inspect this'");
    expect(
      gemini && buildPiLocalAgentLaunchCommand(gemini, "inspect this"),
    ).toBe("gemini --approval-mode plan --prompt-interactive 'inspect this'");
    expect(
      antigravity &&
        buildPiLocalAgentLaunchCommand(antigravity, "inspect this; rm -rf /"),
    ).toBe("agy --sandbox --prompt-interactive 'inspect this; rm -rf /'");
  });

  it("can force POSIX prompt quoting for WSL terminals on Windows", () => {
    const pi = PI_LOCAL_AGENT_DEFS.find((agent) => agent.id === "pi");

    expect(
      pi &&
        buildPiLocalAgentLaunchCommand(pi, "review Bob's diff", {
          windowsShell: false,
        }),
    ).toBe("pi --tools read,grep,find,ls 'review Bob'\\''s diff'");
    expect(
      pi &&
        buildPiLocalAgentLaunchCommand(pi, "review Bob's diff", {
          windowsShell: true,
        }),
    ).toBe("pi --tools read,grep,find,ls 'review Bob''s diff'");
  });

  it("resolves agent definitions from ids, labels, and binaries", () => {
    expect(piLocalAgentByName("pi")?.id).toBe("pi");
    expect(piLocalAgentByName("Pi")?.id).toBe("pi");
    expect(piLocalAgentByName("cursor-agent")?.id).toBe("cursor");
    expect(piLocalAgentByName("Cursor Agent")?.id).toBe("cursor");
    expect(piLocalAgentByName("gemini")?.id).toBe("gemini");
    expect(piLocalAgentByName("Gemini CLI")?.id).toBe("gemini");
    expect(piLocalAgentByName("agy")?.id).toBe("antigravity");
    expect(piLocalAgentByName("Antigravity")?.id).toBe("antigravity");
    expect(piLocalAgentByName("unknown")).toBeUndefined();
  });

  it("merges binary detection with catalog order", () => {
    const statuses = buildPiLocalAgentStatuses([
      { binary: "cursor-agent", path: "/Users/me/bin/cursor-agent" },
      { binary: "claude", path: null },
    ]);

    expect(statuses.map((status) => status.id)).toEqual([
      "claude",
      "codex",
      "cursor",
      "opencode",
      "pi",
      "gemini",
      "antigravity",
    ]);
    expect(statuses[0]).toMatchObject({ binary: "claude", installed: false });
    expect(statuses[2]).toMatchObject({
      binary: "cursor-agent",
      installed: true,
      path: "/Users/me/bin/cursor-agent",
    });
    expect(piLocalAgentInstallSummary(statuses)).toEqual({
      installed: 1,
      total: 7,
    });
  });
});
