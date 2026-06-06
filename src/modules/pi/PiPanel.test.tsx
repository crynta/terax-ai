/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (typeof HTMLCanvasElement !== "undefined") {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => null,
    });
  }
});

const piNativeMock = vi.hoisted(() => ({
  appCapabilityAudit: vi.fn(),
  diagnostics: vi.fn(),
  localAgentsStatus: vi.fn(),
  mcpConnectSavedStdio: vi.fn(),
  mcpDisconnect: vi.fn(),
  mcpEnvSecretRemove: vi.fn(),
  mcpEnvSecretSet: vi.fn(),
  mcpEnvSecretStatuses: vi.fn(),
  mcpOAuthComplete: vi.fn(),
  mcpOAuthStart: vi.fn(),
  mcpOAuthWaitForCallback: vi.fn(),
  mcpServerConfigRemove: vi.fn(),
  mcpServerConfigSave: vi.fn(),
  mcpServerConfigsList: vi.fn(),
  mcpServerStatuses: vi.fn(),
  mcpToolPolicySet: vi.fn(),
  mcpTools: vi.fn(),
  sessionCreate: vi.fn(),
  sessionDelete: vi.fn(),
  sessionResume: vi.fn(),
  sessionRename: vi.fn(),
  sessionSend: vi.fn(),
  sessionStop: vi.fn(),
  sessionToolRespond: vi.fn(),
  sessionsHistory: vi.fn(),
  sessionsList: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  stop: vi.fn(),
  workflowCapabilityAudit: vi.fn(),
}));

const openerMock = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock("@/modules/pi/lib/native", () => ({ piNative: piNativeMock }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));
vi.mock("@tauri-apps/plugin-opener", () => openerMock);
vi.mock("@/modules/ai/lib/keyring", () => ({
  EMPTY_PROVIDER_KEYS: {},
  getCustomEndpointKey: vi.fn(async () => null),
  getKey: vi.fn(async () => null),
}));

import { PiPanel } from "@/modules/pi/PiPanel";
import { PiControllerProvider } from "@/modules/pi/lib/PiControllerProvider";
import type { PiDiagnostics } from "@/modules/pi/lib/status";

const httpConfig = {
  id: "remote",
  name: "Remote",
  transport: "http" as const,
  command: "",
  args: [],
  cwd: null,
  url: "https://mcp.example.com/mcp",
  oauthTokenEnv: "REMOTE_TOKEN",
  env: [{ name: "REMOTE_TOKEN" }],
};

const remoteStatus = {
  serverId: "remote",
  serverName: "Remote",
  transport: "http" as const,
  status: "connected",
  toolCount: 1,
  stderrTail: "",
};

const remoteTool = {
  serverId: "remote",
  serverName: "Remote",
  name: "search",
  qualifiedName: "mcp__remote__search",
  description: "Search remote docs",
  inputSchema: {},
  modelVisible: true,
  approvalPolicy: "ask" as const,
  riskLevel: "medium" as const,
  riskReasons: ["remote HTTP MCP server"],
};

function diagnostics(): PiDiagnostics {
  return {
    hostVersion: "test",
    piSdkLoaded: true,
    piPackages: [],
    node: {
      version: "v22",
      execPath: "/node",
      platform: "darwin",
      arch: "arm64",
      pid: 1,
      cwd: "/tmp",
    },
    config: {
      toolMode: "default",
      sessionStorage: "/tmp/pi",
      apiKeys: [],
    },
    capabilityAudit: [],
    sessions: [],
  };
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function resetPiNativeMocks() {
  for (const value of Object.values(piNativeMock)) {
    value.mockReset();
  }
  openerMock.openUrl.mockReset();
  piNativeMock.localAgentsStatus.mockResolvedValue({ agents: [] });
  piNativeMock.mcpServerConfigsList.mockResolvedValue([httpConfig]);
  piNativeMock.mcpTools.mockResolvedValue([remoteTool]);
  piNativeMock.mcpServerStatuses.mockResolvedValue([remoteStatus]);
  piNativeMock.mcpEnvSecretStatuses.mockResolvedValue([
    { serverId: "remote", name: "REMOTE_TOKEN", configured: true },
  ]);
  piNativeMock.status.mockResolvedValue({ phase: "ready", detail: null });
  piNativeMock.start.mockResolvedValue({ phase: "ready", detail: null });
  piNativeMock.stop.mockResolvedValue({ phase: "disconnected", detail: null });
  piNativeMock.diagnostics.mockResolvedValue(diagnostics());
  piNativeMock.sessionsList.mockResolvedValue({ sessions: [], events: [] });
  piNativeMock.sessionsHistory.mockResolvedValue({ sessions: [], events: [] });
  piNativeMock.workflowCapabilityAudit.mockResolvedValue([
    {
      sequence: 1,
      sessionId: "wf",
      toolCallId: "flow-1",
      toolName: "workflow.agent_prompt",
      approved: true,
      allowed: true,
      outcome: "succeeded",
      message: "workflow audit detail",
    },
  ]);
  piNativeMock.appCapabilityAudit.mockResolvedValue([
    {
      sequence: 1,
      sessionId: "app",
      toolCallId: "app-1",
      toolName: "app.file_read",
      approved: true,
      allowed: true,
      outcome: "succeeded",
      message: "app audit detail",
    },
  ]);
  piNativeMock.mcpOAuthStart.mockResolvedValue({
    serverId: "remote",
    authorizationUrl: "https://auth.example.com/start",
    state: "state-1",
    codeVerifier: "verifier-1",
    redirectUri: "http://127.0.0.1:38573/mcp/oauth/callback",
    clientId: "terax",
    tokenEnv: "REMOTE_TOKEN",
    scopes: ["mcp"],
  });
  piNativeMock.mcpOAuthWaitForCallback.mockReturnValue(new Promise(() => {}));
  piNativeMock.mcpOAuthComplete.mockResolvedValue({
    serverId: "remote",
    tokenEnv: "REMOTE_TOKEN",
    accessTokenStored: true,
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < 30; i += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
  throw lastError;
}

async function clickButton(label: string | RegExp) {
  const buttons = Array.from(document.querySelectorAll("button"));
  const button = buttons.find((candidate) => {
    const text = candidate.textContent ?? "";
    return typeof label === "string" ? text.includes(label) : label.test(text);
  });
  if (!button) throw new Error(`Missing button ${String(label)}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function changeTextArea(label: string, value: string) {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${label}"]`,
  );
  if (!textarea) throw new Error(`Missing textarea ${label}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("PiPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => null),
    });
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverStub,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverStub,
    });
    resetPiNativeMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("keeps all secondary sections collapsed by default", () => {
    const html = renderToStaticMarkup(<PiPanel />);

    expect(html).toContain("Local CLI agents");
    expect(html).toContain("Diagnostics");
    expect(html).toContain("MCP servers");
    expect(html).toContain("Capability audit");
    expect(html).toContain("Context");
    expect(html).toContain("Sessions");
    expect(html).not.toContain("No hidden spawns");
  });

  it("offers a header control for showing only the active chat", () => {
    const html = renderToStaticMarkup(<PiPanel />);

    expect(html).toContain('aria-label="Show only Code chat"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("retains MCP and audit state across PiPanel remounts", async () => {
    function Harness({ show }: { show: boolean }) {
      return (
        <PiControllerProvider>{show ? <PiPanel /> : null}</PiControllerProvider>
      );
    }

    await act(async () => {
      root.render(<Harness show />);
    });
    await waitFor(() => expect(document.body.textContent).toContain("1/1"));
    await waitFor(() =>
      expect(document.body.textContent).toContain("2 events"),
    );
    await clickButton("Capability audit");
    await clickButton("Flow");
    await waitFor(() =>
      expect(document.body.textContent).toContain("workflow.agent_prompt"),
    );
    await clickButton("workflow.agent_prompt");
    await waitFor(() =>
      expect(document.body.textContent).toContain("workflow audit detail"),
    );

    piNativeMock.mcpServerConfigsList.mockReturnValue(new Promise(() => {}));
    piNativeMock.workflowCapabilityAudit.mockReturnValue(new Promise(() => {}));
    piNativeMock.appCapabilityAudit.mockReturnValue(new Promise(() => {}));

    await act(async () => {
      root.render(<Harness show={false} />);
    });
    await act(async () => {
      root.render(<Harness show />);
    });

    expect(document.body.textContent).toContain("1/1");
    expect(document.body.textContent).toContain("2 events");
    expect(document.body.textContent).toContain("workflow.agent_prompt");
    expect(document.body.textContent).toContain("workflow audit detail");
    expect(document.body.textContent).not.toContain("app.file_read");
  });

  it("completes MCP OAuth with an inline dialog instead of window.prompt", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => {
      throw new Error("window.prompt should not be used");
    });

    await act(async () => {
      root.render(
        <PiControllerProvider>
          <PiPanel />
        </PiControllerProvider>,
      );
    });
    await waitFor(() => expect(document.body.textContent).toContain("1/1"));

    await clickButton("MCP servers");
    await waitFor(() => expect(document.body.textContent).toContain("OAuth"));
    await clickButton("OAuth");
    await waitFor(() =>
      expect(document.body.textContent).toContain("Complete MCP OAuth"),
    );

    expect(openerMock.openUrl).toHaveBeenCalledWith(
      "https://auth.example.com/start",
    );
    expect(piNativeMock.mcpOAuthWaitForCallback).toHaveBeenCalledWith({
      state: "state-1",
      redirectUri: "http://127.0.0.1:38573/mcp/oauth/callback",
      timeoutMs: 120_000,
    });
    expect(promptSpy).not.toHaveBeenCalled();

    changeTextArea(
      "OAuth redirect URL or code",
      "http://127.0.0.1:38573/mcp/oauth/callback?code=abc&state=state-1",
    );
    await clickButton("Complete OAuth");

    await waitFor(() =>
      expect(piNativeMock.mcpOAuthComplete).toHaveBeenCalled(),
    );
    expect(piNativeMock.mcpOAuthComplete).toHaveBeenCalledWith({
      serverId: "remote",
      codeOrRedirectUrl:
        "http://127.0.0.1:38573/mcp/oauth/callback?code=abc&state=state-1",
      state: "state-1",
      codeVerifier: "verifier-1",
      redirectUri: "http://127.0.0.1:38573/mcp/oauth/callback",
      clientId: "terax",
      tokenEnv: "REMOTE_TOKEN",
    });
  });

  it("auto-completes MCP OAuth when the loopback callback arrives", async () => {
    piNativeMock.mcpOAuthWaitForCallback.mockResolvedValueOnce({
      codeOrRedirectUrl:
        "http://127.0.0.1:38573/mcp/oauth/callback?code=auto&state=state-1",
    });

    await act(async () => {
      root.render(
        <PiControllerProvider>
          <PiPanel />
        </PiControllerProvider>,
      );
    });
    await waitFor(() => expect(document.body.textContent).toContain("1/1"));

    await clickButton("MCP servers");
    await waitFor(() => expect(document.body.textContent).toContain("OAuth"));
    await clickButton("OAuth");

    await waitFor(() =>
      expect(piNativeMock.mcpOAuthComplete).toHaveBeenCalledWith({
        serverId: "remote",
        codeOrRedirectUrl:
          "http://127.0.0.1:38573/mcp/oauth/callback?code=auto&state=state-1",
        state: "state-1",
        codeVerifier: "verifier-1",
        redirectUri: "http://127.0.0.1:38573/mcp/oauth/callback",
        clientId: "terax",
        tokenEnv: "REMOTE_TOKEN",
      }),
    );
  });
});
