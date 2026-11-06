import { isValidElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  hint: vi.fn(),
  restart: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../lib/useLspHint", () => ({ useLspHint: state.hint }));
vi.mock("../lib/sessionManager", () => ({
  restartPresetSessions: state.restart,
}));
vi.mock("sonner", () => ({ toast: { error: state.error } }));
vi.mock("react/compiler-runtime", () => ({
  c: (n: number) => Array(n).fill(Symbol.for("react.memo_cache_sentinel")),
}));

import { LspStatusPill } from "./LspStatusPill";

function restartButton(node: ReactNode): (() => void) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = restartButton(child);
      if (found) return found;
    }
  } else if (
    isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)
  ) {
    if (
      node.type === "button" &&
      Array.isArray(node.props.children) &&
      node.props.children.includes("Restart")
    )
      return node.props.onClick;
    return restartButton(node.props.children);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  state.restart.mockRejectedValue(new Error("termination denied"));
});

it.each(["active", "error"])(
  "reports a failed restart from the %s pill",
  async (kind) => {
    state.hint.mockReturnValue({
      kind,
      status: "running",
      reason: "stopped",
      preset: { id: "ts", name: "TypeScript", command: "tsserver" },
    });
    const pill = LspStatusPill({ filePath: "/repo/file.ts" });
    expect(pill).not.toBeNull();
    if (!pill || typeof pill.type !== "function")
      throw new Error("missing pill");
    const click = restartButton(pill.type(pill.props));
    expect(click).toBeDefined();
    click?.();
    await Promise.resolve();
    expect(state.restart).toHaveBeenCalledExactlyOnceWith("ts");
    expect(state.error).toHaveBeenCalledWith(
      "Could not restart language server",
      {
        description: "Error: termination denied",
      },
    );
  },
);
