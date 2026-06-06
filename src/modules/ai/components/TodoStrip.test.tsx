/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/todos", () => ({
  deleteTodos: vi.fn(async () => undefined),
  loadTodos: vi.fn(async () => []),
  saveTodos: vi.fn(async () => undefined),
}));

import { useTodosStore } from "../store/todoStore";
import { TodoStrip } from "./TodoStrip";

describe("TodoStrip", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useTodosStore.setState({
      bySession: {},
      hydrated: new Set(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders when todos arrive after an initially empty session", async () => {
    await act(async () => {
      root.render(<TodoStrip sessionId="session-1" />);
    });

    await act(async () => {
      useTodosStore.getState().setTodos("session-1", [
        { id: "todo-1", status: "completed", title: "Review imports" },
        { id: "todo-2", status: "pending", title: "Run build" },
      ]);
    });

    expect(container.textContent).toContain("Review imports");
    expect(container.textContent).toContain("1/2");
  });
});
