import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createModelCompareRun } from "./modelCompare";
import { modelCompareHistoryNative } from "./native";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("modelCompareHistoryNative", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("loads validated native compare history, saves, and clears", async () => {
    const run = createModelCompareRun({
      id: "cmp_native",
      prompt: "Compare persistence.",
      candidates: [
        { id: "model-a", label: "Model A", provider: "Lab" },
        { id: "model-b", label: "Model B", provider: "Lab" },
      ],
      blind: true,
      now: 1,
    });
    const validEntry = { id: run.id, savedAt: 2, run };
    vi.mocked(invoke)
      .mockResolvedValueOnce([validEntry, { id: "bad", savedAt: "nope" }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(modelCompareHistoryNative.load()).resolves.toEqual([
      validEntry,
    ]);
    await modelCompareHistoryNative.save([]);
    await modelCompareHistoryNative.clear();

    expect(invoke).toHaveBeenNthCalledWith(1, "model_compare_history_get");
    expect(invoke).toHaveBeenNthCalledWith(2, "model_compare_history_put", {
      entries: [],
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "model_compare_history_clear");
  });
});
