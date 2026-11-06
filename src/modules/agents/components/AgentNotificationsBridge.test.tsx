import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { AgentSignal } from "../lib/types";
import { useAgentStore } from "../store/agentStore";
import { useWorkbench } from "@/modules/workbench/store";
import { EMPTY_WORKBENCH } from "@/modules/workbench/model/workbench";
import { card, split } from "@/modules/workbench/model/layout";

const mocks = vi.hoisted(() => ({
  signal: null as ((signal: AgentSignal) => void) | null,
  route: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => void) => effect(),
}));
vi.mock("@/modules/terminal", () => ({
  leafIdForPty: (id: number) => id,
  subscribeAgentSignals: (listener: (signal: AgentSignal) => void) => {
    mocks.signal = listener;
    return () => {};
  },
}));
vi.mock("../lib/route", () => ({ routeAgentNotification: mocks.route }));
vi.mock("../lib/review", () => ({ maybeTriggerManagedReview: vi.fn() }));
vi.mock("../lib/useWindowFocus", () => ({ useWindowFocus: () => true }));
import { AgentNotificationsBridge } from "./AgentNotificationsBridge";

it.each(["visible", "stacked", "maximized", "background"])(
  "routes agent attention using shown cards: %s",
  (mode) => {
    mocks.route.mockClear();
    useWorkbench.setState({
      ...EMPTY_WORKBENCH,
      activeProjectId: mode === "background" ? "other" : "p",
      activeTaskByProject: { p: 10 },
      tabs: [1, 2, 3].map((id) => ({
        id,
        kind: "terminal",
        spaceId: "p",
        title: "shell",
      })),
      tasks: [
        {
          id: 10,
          kind: "main",
          projectId: "p",
          createdAt: 0,
          layout: split(11, "row", [card(12, [1]), card(13, [2, 3], 2)]),
          focusedCardId: 12,
          maximizedCardId: mode === "maximized" ? 12 : null,
        },
      ],
    });
    const id = mode === "stacked" ? 3 : 2;
    useAgentStore.getState().start(id, id, "agent");
    renderToString(
      createElement(AgentNotificationsBridge, {
        getTabs: () => useWorkbench.getState().tabs,
        onActivate: vi.fn(),
      }),
    );
    mocks.signal?.({ id, kind: "attention", agent: "agent" });
    expect(mocks.route).toHaveBeenCalledWith(
      expect.objectContaining({ focused: true, visible: mode === "visible" }),
    );
  },
);
