import { describe, expect, it } from "vitest";
import { type Todo, validateTodos } from "./todos";

function todo(over: Partial<Todo> = {}): Todo {
  return { id: "t1", title: "task", status: "pending", ...over };
}

describe("validateTodos", () => {
  it("accepts an empty list", () => {
    expect(validateTodos([])).toBeNull();
  });

  it("accepts a list with a single in_progress item", () => {
    expect(
      validateTodos([
        todo({ id: "a", status: "in_progress" }),
        todo({ id: "b", status: "pending" }),
      ]),
    ).toBeNull();
  });

  it("rejects an empty or whitespace title", () => {
    expect(validateTodos([todo({ title: "" })])).toContain("title");
    expect(validateTodos([todo({ title: "   " })])).toContain("title");
  });

  it("rejects more than one in_progress item", () => {
    const err = validateTodos([
      todo({ id: "a", status: "in_progress" }),
      todo({ id: "b", status: "in_progress" }),
    ]);
    expect(err).toContain("in_progress");
    expect(err).toContain("2");
  });
});
