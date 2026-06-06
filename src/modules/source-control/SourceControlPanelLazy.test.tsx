import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceControlPanel } from "./index";
import type { SourceControlSummary } from "./useSourceControl";

const sourceControl: SourceControlSummary = {
  repo: null,
  status: null,
  changedCount: 0,
  upstream: null,
  ahead: 0,
  behind: 0,
  hasRepo: false,
  isLoading: false,
  localError: null,
  busyAction: null,
  lastRemoteError: null,
  applyStatus: vi.fn(),
  refresh: vi.fn(async () => {}),
  runRemoteAction: vi.fn(async () => ({ ok: true, action: null })),
};

describe("SourceControlPanel lazy export", () => {
  it("renders a stable fallback through the public module export", () => {
    const html = renderToStaticMarkup(
      <SourceControlPanel
        open
        sourceControl={sourceControl}
        onOpenDiff={() => {}}
      />,
    );

    expect(html).toContain("Loading source control…");
  });
});
