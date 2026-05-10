import { describe, expect, it } from "vitest";
import { validateTodos } from "@/modules/ai/lib/todos";
import type { Todo } from "@/modules/ai/lib/todos";

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "t-1",
    title: "Do something",
    status: "pending",
    ...overrides,
  };
}

describe("validateTodos", () => {
  it("accepts a valid todo list", () => {
    const todos = [
      makeTodo({ id: "t-1", title: "Step 1", status: "in_progress" }),
      makeTodo({ id: "t-2", title: "Step 2", status: "pending" }),
      makeTodo({ id: "t-3", title: "Step 3", status: "completed" }),
    ];
    expect(validateTodos(todos)).toBeNull();
  });

  it("accepts empty list", () => {
    expect(validateTodos([])).toBeNull();
  });

  it("rejects empty title", () => {
    const todos = [makeTodo({ title: "  " })];
    expect(validateTodos(todos)).toBe("todo title cannot be empty");
  });

  it("rejects multiple in_progress items", () => {
    const todos = [
      makeTodo({ id: "t-1", status: "in_progress" }),
      makeTodo({ id: "t-2", status: "in_progress" }),
    ];
    expect(validateTodos(todos)).toContain("only one todo may be in_progress");
  });

  it("allows single in_progress item", () => {
    const todos = [makeTodo({ status: "in_progress" })];
    expect(validateTodos(todos)).toBeNull();
  });

  it("allows multiple pending items", () => {
    const todos = [
      makeTodo({ id: "t-1", status: "pending" }),
      makeTodo({ id: "t-2", status: "pending" }),
    ];
    expect(validateTodos(todos)).toBeNull();
  });
});
