/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelCompareRun } from "./lib/modelCompare";
import {
  appendModelComparePaneDeltaForRun,
  ModelComparePanel,
  modelCompareErrorMessage,
  modelCompareRunCanJudge,
  modelCompareRunCanTie,
  modelCompareRunCanVote,
  patchModelComparePaneForRun,
  shouldClearModelCompareHistory,
} from "./ModelComparePanel";

vi.hoisted(() => {
  if (typeof HTMLCanvasElement !== "undefined") {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => null,
    });
  }
});

const modelCompareHistoryNativeMock = vi.hoisted(() => ({
  clear: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("./lib/native", () => ({
  modelCompareHistoryNative: modelCompareHistoryNativeMock,
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

describe("ModelComparePanel", () => {
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
    modelCompareHistoryNativeMock.clear.mockReset();
    modelCompareHistoryNativeMock.load.mockReset();
    modelCompareHistoryNativeMock.save.mockReset();
    modelCompareHistoryNativeMock.clear.mockResolvedValue(undefined);
    modelCompareHistoryNativeMock.load.mockResolvedValue([]);
    modelCompareHistoryNativeMock.save.mockResolvedValue(undefined);
    toastMock.error.mockReset();
    toastMock.success.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  it("renders a compact Terax-native compare cockpit", () => {
    const html = renderToStaticMarkup(<ModelComparePanel />);

    expect(html).toContain("Model Compare");
    expect(html).toContain("Blind");
    expect(html).toContain("2-4 models");
    expect(html).toContain("Probe");
    expect(html).toContain("Mode");
    expect(html).toContain("Judge");
    expect(html).toContain("Agent Compare uses explicit read-only tools");
    expect(html).toContain("Probe sends exactly OK");
    expect(html).toContain("Judge uses only saved compare responses");
    expect(html).toContain("Copy prompt");
    expect(html).toContain("Copy all");
    expect(html).toContain("Copy winner");
    expect(html).toContain("Clear");
    expect(html).toContain("History");
    expect(html).toContain("Save artifact");
    expect(html).toContain('aria-label="Model compare"');
    expect(html).toContain(
      "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card/80",
    );
    expect(html).toContain('aria-label="Comparison prompt"');
  });

  it("surfaces native history load failures", async () => {
    modelCompareHistoryNativeMock.load.mockRejectedValueOnce(
      new Error("native history down"),
    );

    await act(async () => {
      root.render(<ModelComparePanel />);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Model compare history load failed",
        { description: "native history down" },
      ),
    );
  });

  it("asks for explicit confirmation before clearing saved history", () => {
    const confirm = vi.fn().mockReturnValue(true);

    expect(shouldClearModelCompareHistory(confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Clear all saved model compare history"),
    );

    confirm.mockReturnValue(false);
    expect(shouldClearModelCompareHistory(confirm)).toBe(false);
  });

  it("formats native artifact errors without object-object toasts", () => {
    expect(
      modelCompareErrorMessage({
        code: "ARTIFACT_UNAUTHORIZED",
        message: "artifact conversation does not reference a known Pi session",
      }),
    ).toBe(
      "artifact conversation does not reference a known Pi session (ARTIFACT_UNAUTHORIZED)",
    );
    expect(modelCompareErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("only enables voting after all panes settle", () => {
    const run = createModelCompareRun({
      id: "run_vote",
      prompt: "Say hi",
      blind: true,
      now: 1,
      candidates: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    });

    expect(modelCompareRunCanVote(run, false)).toBe(false);
    const completed = {
      ...run,
      panes: run.panes.map((pane) => ({
        ...pane,
        status: "completed" as const,
      })),
    };
    expect(modelCompareRunCanVote(completed, true)).toBe(false);
    expect(modelCompareRunCanTie(completed, true)).toBe(false);
    expect(modelCompareRunCanJudge(completed, true)).toBe(false);
    expect(modelCompareRunCanVote(completed, false)).toBe(true);
    expect(modelCompareRunCanTie(completed, false)).toBe(true);
    expect(modelCompareRunCanJudge(completed, false)).toBe(true);

    const partiallyFailed = {
      ...run,
      panes: run.panes.map((pane, index) => ({
        ...pane,
        status: index === 0 ? ("completed" as const) : ("failed" as const),
      })),
    };
    expect(modelCompareRunCanVote(partiallyFailed, false)).toBe(true);
    expect(modelCompareRunCanTie(partiallyFailed, false)).toBe(false);
    expect(modelCompareRunCanJudge(partiallyFailed, false)).toBe(false);
  });

  it("ignores stale pane updates from aborted prior runs", () => {
    const run = createModelCompareRun({
      id: "run_current",
      prompt: "Say hi",
      blind: true,
      now: 1,
      candidates: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    });

    expect(
      patchModelComparePaneForRun(run, "run_old", "pane_1", {
        status: "stopped",
        error: "Stopped",
      }),
    ).toBe(run);
    expect(
      appendModelComparePaneDeltaForRun(run, "run_old", "pane_1", "late"),
    ).toBe(run);

    const updated = appendModelComparePaneDeltaForRun(
      run,
      "run_current",
      "pane_1",
      "hello",
    );
    expect(updated.panes[0]?.response).toBe("hello");
    expect(updated.publicSnapshot.panes[0]?.response).toBe("hello");
  });
});

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < 30; i += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
  throw lastError;
}
