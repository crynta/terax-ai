import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "../lib/todos";

const todos = vi.hoisted(() => {
  const state = { data: new Map<string, Todo[]>() };
  return {
    state,
    loadTodos: vi.fn(async (sessionId: string) => state.data.get(sessionId) ?? []),
    saveTodos: vi.fn(async (sessionId: string, list: Todo[]) => {
      state.data.set(sessionId, list);
    }),
    deleteTodos: vi.fn(async (sessionId: string) => {
      state.data.delete(sessionId);
    }),
  };
});

vi.mock("../lib/todos", () => ({
  get loadTodos() {
    return todos.loadTodos;
  },
  get saveTodos() {
    return todos.saveTodos;
  },
  get deleteTodos() {
    return todos.deleteTodos;
  },
}));

import { getTodos, useTodosStore } from "./todoStore";

function todo(id: string, status: Todo["status"] = "pending"): Todo {
  return { id, title: `task ${id}`, status };
}

function resetState() {
  useTodosStore.setState({ bySession: {}, hydrated: new Set() });
}

describe("todos store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    todos.state.data.clear();
    resetState();
  });

  it("hydrates a session once and caches the result", async () => {
    todos.state.data.set("s1", [todo("t1")]);

    await useTodosStore.getState().hydrate("s1");
    await useTodosStore.getState().hydrate("s1");

    expect(getTodos("s1")).toEqual([todo("t1")]);
    expect(todos.loadTodos).toHaveBeenCalledTimes(1);
  });

  it("hydrates sessions independently", async () => {
    todos.state.data.set("s1", [todo("t1")]);

    await useTodosStore.getState().hydrate("s2");

    expect(getTodos("s1")).toEqual([]);
    expect(getTodos("s2")).toEqual([]);

    await useTodosStore.getState().hydrate("s1");
    expect(getTodos("s1")).toEqual([todo("t1")]);
  });

  it("setTodos writes the session list and persists", () => {
    const list = [todo("t1", "in_progress"), todo("t2")];

    useTodosStore.getState().setTodos("s1", list);

    expect(getTodos("s1")).toEqual(list);
    expect(todos.saveTodos).toHaveBeenCalledWith("s1", list);
  });

  it("clearSession drops the cache entry, hydration flag, and storage", async () => {
    useTodosStore.getState().setTodos("s1", [todo("t1")]);
    await useTodosStore.getState().hydrate("s1");

    await useTodosStore.getState().clearSession("s1");

    expect(getTodos("s1")).toEqual([]);
    expect(useTodosStore.getState().hydrated.has("s1")).toBe(false);
    expect(todos.deleteTodos).toHaveBeenCalledWith("s1");
  });

  it("getTodos returns an empty list without a session id", () => {
    expect(getTodos(null)).toEqual([]);
  });
});
