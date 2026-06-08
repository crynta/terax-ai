import { describe, expect, it } from "vitest";
import {
  commitPrimaryLabel,
  shouldResetCommitSuccess,
} from "./sourceControlCommitAction";

describe("source control commit action", () => {
  it("shows committed only after a successful commit with an empty message", () => {
    expect(
      commitPrimaryLabel({
        committed: true,
        message: "",
        actionBusy: null,
      }),
    ).toBe("Committed");

    expect(
      commitPrimaryLabel({
        committed: true,
        message: "feat: next commit",
        actionBusy: null,
      }),
    ).toBe("Commit");
  });

  it("shows a busy label while commit and sync is running", () => {
    expect(
      commitPrimaryLabel({
        committed: false,
        message: "feat: sync changes",
        actionBusy: "commit-sync",
      }),
    ).toBe("Committing...");
  });

  it("resets the committed state when the user starts a new message", () => {
    expect(shouldResetCommitSuccess("", "feat: next commit")).toBe(true);
    expect(shouldResetCommitSuccess("feat: old", "feat: next")).toBe(false);
    expect(shouldResetCommitSuccess("", "   ")).toBe(false);
  });
});
