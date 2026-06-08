import type { GitChangedFile } from "@/modules/ai/lib/native";
import { describe, expect, it } from "vitest";
import {
  buildSourceControlEntryModel,
  entrySelectionKey,
  resolveSectionBatchEntries,
} from "./sourceControlEntries";

describe("buildSourceControlEntryModel", () => {
  it("keeps staged and unstaged entries separate for the same file", () => {
    const file: GitChangedFile = {
      path: "src/example.ts",
      originalPath: null,
      indexStatus: "M",
      worktreeStatus: "M",
      staged: true,
      unstaged: true,
      untracked: false,
      statusLabel: "Modified",
    };

    const model = buildSourceControlEntryModel([file]);

    expect(model.stagedEntries).toEqual([
      expect.objectContaining({
        key: "+:src/example.ts",
        path: "src/example.ts",
        mode: "+",
        statusCode: "M",
      }),
    ]);
    expect(model.unstagedEntries).toEqual([
      expect.objectContaining({
        key: "-:src/example.ts",
        path: "src/example.ts",
        mode: "-",
        statusCode: "M",
      }),
    ]);
    expect(model.fileEntries).toEqual([
      expect.objectContaining({
        key: "src/example.ts",
        checkState: "indeterminate",
        staged: true,
        unstaged: true,
      }),
    ]);
    expect(model.headerCheckState).toBe("indeterminate");
  });

  it("uses marked entries for section batch actions when present", () => {
    const files: GitChangedFile[] = [
      {
        path: "src/one.ts",
        originalPath: null,
        indexStatus: " ",
        worktreeStatus: "M",
        staged: false,
        unstaged: true,
        untracked: false,
        statusLabel: "Modified",
      },
      {
        path: "src/two.ts",
        originalPath: null,
        indexStatus: " ",
        worktreeStatus: "M",
        staged: false,
        unstaged: true,
        untracked: false,
        statusLabel: "Modified",
      },
    ];
    const model = buildSourceControlEntryModel(files);
    expect(model.unstagedEntries).toHaveLength(2);
    const second = model.unstagedEntries[1];
    if (!second) throw new Error("Expected second unstaged entry");
    const marked = new Set([entrySelectionKey(second)]);

    expect(resolveSectionBatchEntries(model.unstagedEntries, marked)).toEqual([
      second,
    ]);
    expect(resolveSectionBatchEntries(model.unstagedEntries, new Set())).toEqual(
      model.unstagedEntries,
    );
  });
});
